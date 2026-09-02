import { NextResponse } from "next/server";
import { PDFDocument, rgb, StandardFonts } from "pdf-lib";
import { createCanvas, registerFont } from "canvas";
import fs from "fs";
import path from "path";
import { supabaseAdmin } from "../../../../../lib/supabaseAdmin";
import { amountInArabicWords } from "../../../../../lib/arabicAmount";

const BLACK = rgb(0.05, 0.05, 0.05);
const RED = rgb(0.8, 0.05, 0.05);

let fontRegistered = false;
function ensureFontRegistered() {
  if (fontRegistered) return;
  const dir = path.join(process.cwd(), "public", "fonts");
  registerFont(path.join(dir, "NotoSansArabic.ttf"), { family: "NotoArabic" });
  // Times New Roman does not exist on Linux and has no Arabic anyway. Noto
  // Naskh Arabic is the serif Arabic face that pairs with it - same upright
  // serif feel, proper Arabic shaping - so the Arabic reads as Times does.
  registerFont(path.join(dir, "NotoNaskhArabic.ttf"), { family: "NaskhArabic" });
  registerFont(path.join(dir, "NotoNaskhArabic-Bold.ttf"), { family: "NaskhArabic", weight: "bold" });
  fontRegistered = true;
}

// The canvas is sized to the MEASURED text rather than a fixed box. A fixed
// box left the short lines swimming in empty pixels, so when the image was
// scaled to a target height on the page the text inside came out far smaller
// than its neighbours - the amount line was the worst of it.
function renderArabicToPng(text, { size = 24, color = "#0d0d0d", bold = false, family = "NaskhArabic" } = {}) {
  ensureFontRegistered();
  const font = `${bold ? "bold " : ""}${size}px ${family}`;
  const probe = createCanvas(8, 8).getContext("2d");
  probe.font = font;
  const m = probe.measureText(text);
  const pad = Math.ceil(size * 0.25);
  const widthPx = Math.ceil(m.width) + pad * 2;
  const heightPx = Math.ceil(size * 1.6);

  const canvas = createCanvas(widthPx, heightPx);
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = color;
  ctx.font = font;
  ctx.textAlign = "right";
  ctx.textBaseline = "middle";
  ctx.fillText(text, widthPx - pad, heightPx / 2);
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
  // A5 landscape: 595.28 x 419.53 pt.
  const page = pdf.addPage([595.28, 419.53]);
  const courierBold = await pdf.embedFont(StandardFonts.CourierBold);
  const courier = await pdf.embedFont(StandardFonts.Courier);
  const { width, height } = page.getSize();

  const logoImage = await pdf.embedPng(await loadAsset(req, "invoice-logo.png"));
  const stampImage = stamped ? await pdf.embedPng(await loadAsset(req, "stamp.png")) : null;

  async function drawArabicImage(text, opts) {
    return pdf.embedPng(renderArabicToPng(text, opts));
  }

  // A5 landscape. Frame, logo left, title and number centred, values
  // right-aligned in a middle column with the Arabic labels on the far right.
  page.drawRectangle({ x: 8, y: 8, width: width - 16, height: height - 16, borderColor: BLACK, borderWidth: 1 });

  // Logo, top-left. The asset is square (400x400) so it is drawn square.
  const logoW = 74;
  page.drawImage(logoImage, { x: 30, y: height - 26 - logoW, width: logoW, height: logoW });

  // Title in the serif Arabic face, centred.
  const titleImg = await drawArabicImage("إيصال استلام نقدية", { size: 44 });
  const titleW = 168, titleH = (titleImg.height / titleImg.width) * titleW;
  page.drawImage(titleImg, { x: (width - titleW) / 2, y: height - 40 - titleH / 2, width: titleW, height: titleH });

  // Receipt number: Courier New, red, centred beneath the title.
  const seqMatch = invoice.invoice_number.match(/(\d+)$/);
  const receiptStr = seqMatch ? seqMatch[1] : invoice.invoice_number;
  const numSize = 19;
  const numW = courierBold.widthOfTextAtSize(receiptStr, numSize);
  page.drawText(receiptStr, { x: (width - numW) / 2, y: height - 80, size: numSize, font: courierBold, color: RED });

  page.drawLine({ start: { x: 46, y: height - 100 }, end: { x: width - 46, y: height - 100 }, thickness: 1, color: BLACK });

  let y = height - 142;
  const LABEL_RIGHT = width - 40;
  const VALUE_RIGHT = width - 128;
  const LABELS = { amount: "المبلغ:", name: "الاسم :", exam: "الفحص :", date: "تاريخ الفحص:" };

  async function label(key) {
    const img = await drawArabicImage(LABELS[key], { size: 30 });
    const h = 17, w = (img.width / img.height) * h;
    page.drawImage(img, { x: LABEL_RIGHT - w, y: y - 4, width: w, height: h });
  }

  // Latin values in Courier New, right-aligned to the value column.
  function valueRight(text, size = 11) {
    const w = courierBold.widthOfTextAtSize(String(text), size);
    page.drawText(String(text), { x: VALUE_RIGHT - w, y, size, font: courierBold, color: BLACK });
  }

  // Amount row: the figure, then جم, then the sum written out in Arabic words.
  // The payment method used to sit here; the client asked for the written
  // amount instead, which is what makes a receipt legally legible.
  await label("amount");
  {
    const figure = Number(invoice.amount).toLocaleString("en-US");
    const words = amountInArabicWords(invoice.amount);
    // Rendered as one right-to-left string so the figure, the unit and the
    // words sit in the correct order without positioning each piece by hand.
    const line = `${figure} جم ${words}`;
    const img = await drawArabicImage(line, { size: 26 });
    const h = 19, w = (img.width / img.height) * h;
    // Long amounts must not run under the label, so the line shrinks to fit.
    const maxW = VALUE_RIGHT - 30;
    const drawW = Math.min(w, maxW);
    const drawH = drawW === w ? h : (img.height / img.width) * drawW;
    page.drawImage(img, { x: VALUE_RIGHT - drawW, y: y - (drawH - h) / 2 - 3, width: drawW, height: drawH });
  }
  y -= 44;

  const examDate = invoice.exam_date
    ? new Date(`${invoice.exam_date}T00:00:00`).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })
    : "";
  for (const [key, val] of [["name", invoice.patient_name], ["exam", invoice.exam], ["date", examDate]]) {
    await label(key);
    if (val) valueRight(val);
    y -= 44;
  }

  y -= 4;
  const dividerY = y;
  page.drawLine({ start: { x: 46, y: dividerY }, end: { x: width - 46, y: dividerY }, thickness: 1, color: BLACK });

  // Address in the serif Arabic face; the phone line in Courier New.
  let fy = dividerY - 30;
  const addrImg = await drawArabicImage(
    "عيادة 353 - المركز الطبي 3 - شارع ابو داوود الظاهرى - المنطقة الحادية عشر - مدينة نصر",
    { size: 22 }
  );
  const addrH = 15, addrW = (addrImg.width / addrImg.height) * addrH;
  page.drawImage(addrImg, { x: (width - addrW) / 2, y: fy, width: addrW, height: addrH });
  fy -= 26;

  {
    const digits = "15184 - 0128887187";
    const taImg = await drawArabicImage("ت :", { size: 22 });
    const taH = 15, taW = (taImg.width / taImg.height) * taH;
    const digitsW = courier.widthOfTextAtSize(digits, 10.5);
    // "ت :" sits to the RIGHT of the digits, as the line reads right to left.
    const blockW = taW + 5 + digitsW;
    const startX = (width - blockW) / 2;
    page.drawText(digits, { x: startX, y: fy, size: 10.5, font: courier, color: BLACK });
    page.drawImage(taImg, { x: startX + digitsW + 5, y: fy - 1, width: taW, height: taH });
  }

  // Seal, only on the stamped copy. Asset is 139x138, drawn to that ratio.
  if (stamped) {
    const stampW = 58, stampH = stampW * (138 / 139);
    page.drawImage(stampImage, { x: width - 34 - stampW, y: 18, width: stampW, height: stampH, opacity: 0.9 });
  }

  const bytes = await pdf.save();
  return new NextResponse(bytes, {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="${invoice.invoice_number}${stamped ? "-stamped" : ""}.pdf"`,
    },
  });
}
