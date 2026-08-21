import { NextResponse } from "next/server";
import { PDFDocument, rgb, StandardFonts } from "pdf-lib";
import { createCanvas, registerFont } from "canvas";
import fs from "fs";
import path from "path";
import { supabaseAdmin } from "../../../../../lib/supabaseAdmin";
import { numberToArabicWords } from "../../../../../lib/arabicNumberWords";

const NAVY = rgb(0x27 / 255, 0x21 / 255, 0x4d / 255);
const GOLD = rgb(0xa9 / 255, 0x8b / 255, 0x4d / 255);
const RED = rgb(0.75, 0.1, 0.1);
const GRAY = rgb(0.35, 0.35, 0.35);
const BLACK = rgb(0.1, 0.1, 0.1);

let fontRegistered = false;
function ensureFontRegistered() {
  if (fontRegistered) return;
  const fontPath = path.join(process.cwd(), "public", "fonts", "NotoSansArabic.ttf");
  registerFont(fontPath, { family: "NotoArabic" });
  fontRegistered = true;
}

// Renders Arabic (or mixed Arabic+number) text to a PNG using node-canvas, which
// uses real OS-level text shaping (Pango/Cairo), correctly handling Arabic letter
// joining and non-connecting letters. This avoids the broken glyph rendering that
// comes from manually reversing/reshaping strings for pdf-lib's raw glyph drawing.
function renderArabicToPng(text, { size = 24, color = "#000", widthPx = 900, heightPx = 60, align = "right" } = {}) {
  ensureFontRegistered();
  const canvas = createCanvas(widthPx, heightPx);
  const ctx = canvas.getContext("2d");
  ctx.clearRect(0, 0, widthPx, heightPx);
  ctx.fillStyle = color;
  ctx.font = `${size}px NotoArabic`;
  ctx.textAlign = align;
  ctx.textBaseline = "middle";
  const x = align === "right" ? widthPx - 4 : align === "center" ? widthPx / 2 : 4;
  ctx.fillText(text, x, heightPx / 2);
  const measured = ctx.measureText(text);
  return { buffer: canvas.toBuffer("image/png"), textWidthPx: measured.width };
}

const logoCache = { value: null };
async function loadLogo(req) {
  if (logoCache.value) return logoCache.value;
  const filePath = path.join(process.cwd(), "public", "logo-full.png");
  try {
    logoCache.value = fs.readFileSync(filePath);
  } catch (e) {
    const origin = new URL(req.url).origin;
    const res = await fetch(`${origin}/logo-full.png`);
    logoCache.value = Buffer.from(await res.arrayBuffer());
  }
  return logoCache.value;
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
  const page = pdf.addPage([420, 400]);
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const { width, height } = page.getSize();
  const margin = 24;
  const PX_TO_PT = 0.75; // canvas rendered at ~96dpi-equivalent px, PDF points are 72dpi

  async function drawArabicImage(text, opts) {
    const { buffer, textWidthPx } = renderArabicToPng(text, opts);
    const img = await pdf.embedPng(buffer);
    return { img, textWidthPt: textWidthPx * PX_TO_PT };
  }

  let logoImage = null;
  try {
    const logoBytes = await loadLogo(req);
    logoImage = await pdf.embedPng(logoBytes);
  } catch (e) {
    // logo optional
  }

  // Border
  page.drawRectangle({ x: 8, y: 8, width: width - 16, height: height - 16, borderColor: rgb(0.7, 0.7, 0.7), borderWidth: 1 });

  // Logo, top-left
  if (logoImage) {
    const logoW = 60;
    const logoH = (logoImage.height / logoImage.width) * logoW;
    page.drawImage(logoImage, { x: margin, y: height - 30 - logoH, width: logoW, height: logoH });
  }

  // Title, top-right
  const titlePng = await drawArabicImage("إيصال استلام نقدية", { size: 30, widthPx: 700, heightPx: 60, align: "right" });
  const titleDrawW = 180;
  const titleDrawH = (titlePng.img.height / titlePng.img.width) * titleDrawW;
  page.drawImage(titlePng.img, { x: width - margin - titleDrawW, y: height - 44 - titleDrawH / 2, width: titleDrawW, height: titleDrawH });

  // Receipt number, red
  const seqMatch = invoice.invoice_number.match(/(\d+)$/);
  const receiptStr = seqMatch ? seqMatch[1] : invoice.invoice_number;
  const numW = bold.widthOfTextAtSize(receiptStr, 14);
  page.drawText(receiptStr, { x: width - margin - numW, y: height - 78, size: 14, font: bold, color: RED });

  page.drawLine({ start: { x: margin, y: height - 96 }, end: { x: width - margin, y: height - 96 }, thickness: 1, color: rgb(0.15, 0.15, 0.15) });

  // Fields
  let y = height - 130;
  const fieldLabels = {
    amount: "المبلغ",
    name: "الاسم",
    exam: "الفحص",
    date: "تاريخ الفحص",
    unit: "جم",
  };

  async function field(labelKey, value, showUnit) {
    const { img, textWidthPt } = await drawArabicImage(fieldLabels[labelKey], { size: 26, widthPx: 260, heightPx: 44, align: "right" });
    const drawH = 15;
    const drawW = (img.width / img.height) * drawH;
    page.drawImage(img, { x: width - margin - drawW, y: y - 4, width: drawW, height: drawH });

    if (showUnit) {
      const unitImg = await drawArabicImage(fieldLabels.unit, { size: 22, widthPx: 100, heightPx: 34, align: "right" });
      const unitH = 12;
      const unitW = (unitImg.img.width / unitImg.img.height) * unitH;
      page.drawImage(unitImg.img, { x: width - margin - drawW - 66, y: y - 3, width: unitW, height: unitH });
    }
    if (value) {
      page.drawText(String(value), { x: margin, y, size: 12, font: bold, color: NAVY });
    } else {
      page.drawLine({ start: { x: margin, y: y - 2 }, end: { x: width - margin - 100, y: y - 2 }, thickness: 0.5, color: rgb(0.85, 0.85, 0.85) });
    }
    y -= 34;
  }

  await field("amount", `${Number(invoice.amount).toLocaleString("en-US")}`, true);
  await field("name", invoice.patient_name, false);
  await field("exam", invoice.exam, false);
  await field("date", invoice.exam_date, false);

  // Amount in words
  const arabicWords = numberToArabicWords(invoice.amount);
  const wordsImg = await drawArabicImage(arabicWords, { size: 22, widthPx: 900, heightPx: 40, align: "right" });
  const wordsDrawH = 12;
  const wordsDrawW = (wordsImg.img.width / wordsImg.img.height) * wordsDrawH;
  page.drawImage(wordsImg.img, { x: width - margin - wordsDrawW, y: y - 8, width: wordsDrawW, height: wordsDrawH });
  y -= 30;

  page.drawLine({ start: { x: margin, y }, end: { x: width - margin, y }, thickness: 1, color: rgb(0.15, 0.15, 0.15) });
  y -= 22;

  // Footer: address + phone, centered
  const addrImg = await drawArabicImage(
    "عيادة 353 - المركز الطبي 3 - شارع ابو داوود الظاهرى - المنطقة الحادية عشر - مدينة نصر",
    { size: 18, widthPx: 900, heightPx: 32, align: "right", color: "#595959" }
  );
  const addrDrawH = 9;
  const addrDrawW = (addrImg.img.width / addrImg.img.height) * addrDrawH;
  page.drawImage(addrImg.img, { x: (width - addrDrawW) / 2, y, width: addrDrawW, height: addrDrawH });
  y -= 14;

  const phoneImg = await drawArabicImage("ت : 15184 - 0128887187", { size: 18, widthPx: 400, heightPx: 32, align: "right", color: "#595959" });
  const phoneDrawH = 9;
  const phoneDrawW = (phoneImg.img.width / phoneImg.img.height) * phoneDrawH;
  page.drawImage(phoneImg.img, { x: (width - phoneDrawW) / 2, y, width: phoneDrawW, height: phoneDrawH });

  // Stamp
  const stampX = width - 78;
  const stampY = 48;
  page.drawCircle({ x: stampX, y: stampY, size: 34, borderColor: GOLD, borderWidth: 1.3 });
  page.drawCircle({ x: stampX, y: stampY, size: 29, borderColor: GOLD, borderWidth: 0.6 });
  const s1 = "AL SHROOOUK", s2 = "SCAN & LAB";
  page.drawText(s1, { x: stampX - bold.widthOfTextAtSize(s1, 5.5) / 2, y: stampY + 8, size: 5.5, font: bold, color: GOLD });
  page.drawText(s2, { x: stampX - bold.widthOfTextAtSize(s2, 5.5) / 2, y: stampY - 1, size: 5.5, font: bold, color: GOLD });
  const stampArabicImg = await drawArabicImage("إيصال رسمي", { size: 20, widthPx: 200, heightPx: 32, align: "center", color: "#A98B4D" });
  const saDrawH = 8;
  const saDrawW = (stampArabicImg.img.width / stampArabicImg.img.height) * saDrawH;
  page.drawImage(stampArabicImg.img, { x: stampX - saDrawW / 2, y: stampY - 15, width: saDrawW, height: saDrawH });

  const bytes = await pdf.save();
  return new NextResponse(bytes, {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="${invoice.invoice_number}.pdf"`,
    },
  });
}
