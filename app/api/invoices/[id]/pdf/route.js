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
  // Unstamped is the default, matching the template exactly. The stamped copy
  // is the one that goes to a patient without being printed and sealed by hand.
  const stamped = new URL(req.url).searchParams.get("stamp") === "1";

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
  const stampImage = stamped ? await pdf.embedPng(await loadAsset(req, "stamp.png")) : null;

  async function drawArabicImage(text, opts) {
    return pdf.embedPng(renderArabicToPng(text, opts));
  }

  // Layout mirrors Copy_of_Invoice_Template.docx exactly: thin frame, logo
  // left, title and receipt number CENTRED, values right-aligned in a middle
  // column with the Arabic labels on the far right, and a centred bold footer.
  page.drawRectangle({ x: 8, y: 8, width: width - 16, height: height - 16, borderColor: BLACK, borderWidth: 1 });

  // Logo, top-left
  const logoW = 88, logoH = (logoImage.height / logoImage.width) * logoW;
  page.drawImage(logoImage, { x: 34, y: height - 30 - logoH, width: logoW, height: logoH });

  // Title, CENTRED on the page - not right-aligned
  const titleImg = await drawArabicImage("إيصال استلام نقدية", { size: 40, widthPx: 760, heightPx: 70, align: "center", bold: true });
  const titleDrawW = 210, titleDrawH = (titleImg.height / titleImg.width) * titleDrawW;
  page.drawImage(titleImg, { x: (width - titleDrawW) / 2, y: height - 52 - titleDrawH / 2, width: titleDrawW, height: titleDrawH });

  // Receipt number, red Courier, CENTRED beneath the title
  const seqMatch = invoice.invoice_number.match(/(\d+)$/);
  const receiptStr = seqMatch ? seqMatch[1] : invoice.invoice_number;
  const numSize = 20;
  const numW = courierBold.widthOfTextAtSize(receiptStr, numSize);
  page.drawText(receiptStr, { x: (width - numW) / 2, y: height - 86, size: numSize, font: courierBold, color: RED });

  page.drawLine({ start: { x: 52, y: height - 106 }, end: { x: width - 52, y: height - 106 }, thickness: 1.1, color: BLACK });

  // Fields. Labels sit at the right margin; values are RIGHT-aligned and end at
  // a fixed column short of them, which is what the template does - the old
  // version left-aligned the values against the opposite margin instead.
  let y = height - 146;
  const LABEL_RIGHT = width - 46;   // right edge of the Arabic label
  const VALUE_RIGHT = width - 150;  // right edge of the value column
  const fieldLabels = { amount: "المبلغ:", name: "الاسم :", exam: "الفحص :", date: "تاريخ الفحص:", unit: "جم" };

  async function label(key) {
    const img = await drawArabicImage(fieldLabels[key], { size: 30, widthPx: 300, heightPx: 48, align: "right", bold: false });
    const h = 14, w = (img.width / img.height) * h;
    page.drawImage(img, { x: LABEL_RIGHT - w, y: y - 3, width: w, height: h });
  }
  function valueRight(text, size = 13) {
    const w = helvBold.widthOfTextAtSize(String(text), size);
    page.drawText(String(text), { x: VALUE_RIGHT - w, y, size, font: helvBold, color: BLACK });
    return w;
  }

  // Amount row reads, right to left: المبلغ:  {{total}} جم {{trans}}
  await label("amount");
  {
    const amountStr = Number(invoice.amount).toLocaleString("en-US");
    const amountW = valueRight(amountStr);
    const unitImg = await drawArabicImage(fieldLabels.unit, { size: 26, widthPx: 90, heightPx: 40, align: "right", bold: false });
    const unitH = 12, unitW = (unitImg.width / unitImg.height) * unitH;
    page.drawImage(unitImg, { x: VALUE_RIGHT - amountW - 8 - unitW, y: y - 2, width: unitW, height: unitH });
    if (invoice.trans) {
      const tw = helvBold.widthOfTextAtSize(String(invoice.trans), 13);
      page.drawText(String(invoice.trans), { x: VALUE_RIGHT - amountW - 16 - unitW - tw, y, size: 13, font: helvBold, color: BLACK });
    }
  }
  y -= 38;

  // The template shows a human date, not an ISO string.
  const examDate = invoice.exam_date
    ? new Date(`${invoice.exam_date}T00:00:00`).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })
    : "";
  for (const [key, val] of [["name", invoice.patient_name], ["exam", invoice.exam], ["date", examDate]]) {
    await label(key);
    if (val) valueRight(val);
    y -= 38;
  }

  y -= 4;
  const dividerY = y;
  page.drawLine({ start: { x: 52, y: dividerY }, end: { x: width - 52, y: dividerY }, thickness: 1.1, color: BLACK });

  // Footer: address then phone, both CENTRED and bold, as in the template.
  let fy = dividerY - 26;
  const addrImg = await drawArabicImage(
    "عيادة 353 - المركز الطبي 3 - شارع ابو داوود الظاهرى - المنطقة الحادية عشر - مدينة نصر",
    { size: 20, widthPx: 1100, heightPx: 34, align: "center", bold: true }
  );
  const addrH = 13, addrW = (addrImg.width / addrImg.height) * addrH;
  page.drawImage(addrImg, { x: (width - addrW) / 2, y: fy, width: addrW, height: addrH });
  fy -= 22;

  const phoneImg = await drawArabicImage("ت : 15184 - 0128887187", { size: 20, widthPx: 420, heightPx: 34, align: "center", bold: true });
  const phoneH = 13, phoneW = (phoneImg.width / phoneImg.height) * phoneH;
  page.drawImage(phoneImg, { x: (width - phoneW) / 2, y: fy, width: phoneW, height: phoneH });

  // Two variants of the same receipt. The .docx has no seal because that copy
  // is stamped by hand after printing; ?stamp=1 produces the digitally stamped
  // version instead, using the clinic's real seal.
  if (stamped) {
    const stampW = 62, stampH = (stampImage.height / stampImage.width) * stampW;
    page.drawImage(stampImage, { x: width - 40 - stampW, y: 20, width: stampW, height: stampH, opacity: 0.9 });
  }

  const bytes = await pdf.save();
  return new NextResponse(bytes, {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="${invoice.invoice_number}${stamped ? "-stamped" : ""}.pdf"`,
    },
  });
}
