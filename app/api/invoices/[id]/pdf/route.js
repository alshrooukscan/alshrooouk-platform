import { NextResponse } from "next/server";
import { PDFDocument, rgb, StandardFonts } from "pdf-lib";
import { createCanvas, registerFont } from "canvas";
import fs from "fs";
import path from "path";
import { supabaseAdmin } from "../../../../../lib/supabaseAdmin";

const BLACK = rgb(0.05, 0.05, 0.05);
const RED = rgb(0.8, 0.05, 0.05);

let fontRegistered = false;
function ensureFontRegistered() {
  if (fontRegistered) return;
  const fontPath = path.join(process.cwd(), "public", "fonts", "NotoSansArabic.ttf");
  registerFont(fontPath, { family: "NotoArabic" });
  fontRegistered = true;
}

function renderArabicToPng(text, { size = 24, color = "#0d0d0d", widthPx = 900, heightPx = 60, align = "right", bold = false } = {}) {
  ensureFontRegistered();
  const canvas = createCanvas(widthPx, heightPx);
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = color;
  ctx.font = `${bold ? "bold " : ""}${size}px NotoArabic`;
  ctx.textAlign = align;
  ctx.textBaseline = "middle";
  const x = align === "right" ? widthPx - 4 : align === "center" ? widthPx / 2 : 4;
  ctx.fillText(text, x, heightPx / 2);
  return canvas.toBuffer("image/png");
}

const assetCache = {};
async function loadAsset(req, relativePath) {
  if (assetCache[relativePath]) return assetCache[relativePath];
  const filePath = path.join(process.cwd(), "public", relativePath);
  try {
    assetCache[relativePath] = fs.readFileSync(filePath);
  } catch (e) {
    const origin = new URL(req.url).origin;
    const res = await fetch(`${origin}/${relativePath}`);
    assetCache[relativePath] = Buffer.from(await res.arrayBuffer());
  }
  return assetCache[relativePath];
}

export async function GET(req, { params }) {
  try {
    return await generateInvoicePdf(req, params);
  } catch (e) {
    return NextResponse.json({ error: "Could not generate invoice PDF" }, { status: 500 });
  }
}

async function generateInvoicePdf(req, params) {
  const { data: invoice, error } = await supabaseAdmin.from("invoices").select("*").eq("id", params.id).single();
  if (error || !invoice) {
    return NextResponse.json({ error: "Invoice not found" }, { status: 404 });
  }

  const pdf = await PDFDocument.create();
  const page = pdf.addPage([565, 420]); // landscape, matches the real paper receipt's proportions
  const courierBold = await pdf.embedFont(StandardFonts.CourierBold);
  const helvBold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const { width, height } = page.getSize();

  const logoImage = await pdf.embedPng(await loadAsset(req, "invoice-logo.png"));
  const stampImage = await pdf.embedPng(await loadAsset(req, "stamp.png"));

  async function drawArabicImage(text, opts) {
    return pdf.embedPng(renderArabicToPng(text, opts));
  }

  // Thick black border, matching the real receipt's frame
  page.drawRectangle({ x: 6, y: 6, width: width - 12, height: height - 12, borderColor: BLACK, borderWidth: 2.2 });

  // Logo, top-left, real source asset
  const logoW = 82, logoH = (logoImage.height / logoImage.width) * logoW;
  page.drawImage(logoImage, { x: 30, y: height - 26 - logoH, width: logoW, height: logoH });

  // Title, bold, matching the real 14pt bold spec
  const titleImg = await drawArabicImage("إيصال استلام نقدية", { size: 34, widthPx: 700, heightPx: 60, align: "right", bold: true });
  const titleDrawW = 210, titleDrawH = (titleImg.height / titleImg.width) * titleDrawW;
  page.drawImage(titleImg, { x: width - 40 - titleDrawW, y: height - 52 - titleDrawH / 2, width: titleDrawW, height: titleDrawH });

  // Receipt number, red, Courier New (matching the real template's exact font choice)
  const seqMatch = invoice.invoice_number.match(/(\d+)$/);
  const receiptStr = seqMatch ? seqMatch[1] : invoice.invoice_number;
  const numSize = 19;
  const numW = courierBold.widthOfTextAtSize(receiptStr, numSize);
  page.drawText(receiptStr, { x: width - 40 - numW, y: height - 92, size: numSize, font: courierBold, color: RED });

  page.drawLine({ start: { x: 30, y: height - 108 }, end: { x: width - 30, y: height - 108 }, thickness: 1.5, color: BLACK });

  // Fields: المبلغ / الاسم / الفحص / تاريخ الفحص — labels are regular weight (not bold) per the real template
  let y = height - 148;
  const fieldLabels = { amount: "المبلغ", name: "الاسم", exam: "الفحص", date: "تاريخ الفحص", unit: "جم" };

  async function field(labelKey, value, showUnit) {
    const img = await drawArabicImage(`${fieldLabels[labelKey]} :`, { size: 30, widthPx: 280, heightPx: 48, align: "right", bold: false });
    const drawH = 16;
    const realDrawW = (img.width / img.height) * drawH;
    page.drawImage(img, { x: width - 40 - realDrawW, y: y - 4, width: realDrawW, height: drawH });

    if (showUnit) {
      const unitImg = await drawArabicImage(fieldLabels.unit, { size: 24, widthPx: 100, heightPx: 36, align: "right", bold: false });
      const unitH = 12, unitW = (unitImg.width / unitImg.height) * unitH;
      page.drawImage(unitImg, { x: width - 40 - realDrawW - 140, y: y - 3, width: unitW, height: unitH });
    }
    if (value) {
      page.drawText(String(value), { x: 40, y, size: 13, font: helvBold, color: BLACK });
    }
    y -= 40;
  }

  await field("amount", `${Number(invoice.amount).toLocaleString("en-US")}`, true);
  await field("name", invoice.patient_name, false);
  await field("exam", invoice.exam, false);
  await field("date", invoice.exam_date, false);

  y -= 10;
  const dividerY = y;
  page.drawLine({ start: { x: 30, y: dividerY }, end: { x: width - 30, y: dividerY }, thickness: 1.5, color: BLACK });

  // Real stamp, footer zone, bottom-right, sized to fit fully within the page
  const stampW = 78, stampH = (stampImage.height / stampImage.width) * stampW;
  page.drawImage(stampImage, { x: width - 40 - stampW, y: dividerY - stampH - 14, width: stampW, height: stampH });

  // Footer: real address + phone, bold per the real template
  let fy = dividerY - 26;
  const addrImg = await drawArabicImage(
    "عيادة 353 - المركز الطبي 3 - شارع ابو داوود الظاهرى - المنطقة الحادية عشر - مدينة نصر",
    { size: 14, widthPx: 900, heightPx: 26, align: "right", bold: true }
  );
  const addrDrawH = 8, addrDrawW = (addrImg.width / addrImg.height) * addrDrawH;
  page.drawImage(addrImg, { x: 30, y: fy, width: addrDrawW, height: addrDrawH });
  fy -= 16;

  const phoneImg = await drawArabicImage("ت : 15184 - 0128887187", { size: 14, widthPx: 400, heightPx: 26, align: "right", bold: true });
  const phoneDrawH = 8, phoneDrawW = (phoneImg.width / phoneImg.height) * phoneDrawH;
  page.drawImage(phoneImg, { x: 30, y: fy, width: phoneDrawW, height: phoneDrawH });

  const bytes = await pdf.save();
  return new NextResponse(bytes, {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="${invoice.invoice_number}.pdf"`,
    },
  });
}
