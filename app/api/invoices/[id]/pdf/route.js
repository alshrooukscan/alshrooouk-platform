import { NextResponse } from "next/server";
import { PDFDocument, rgb, StandardFonts } from "pdf-lib";
import fontkit from "@pdf-lib/fontkit";
import fs from "fs";
import path from "path";
import { supabaseAdmin } from "../../../../../lib/supabaseAdmin";
import { numberToArabicWords } from "../../../../../lib/arabicNumberWords";
import { arabicVisualRuns, toArabicVisual } from "../../../../../lib/arabicText";

const NAVY = rgb(0x27 / 255, 0x21 / 255, 0x4d / 255);
const GOLD = rgb(0xa9 / 255, 0x8b / 255, 0x4d / 255);
const RED = rgb(0.75, 0.1, 0.1);
const GRAY = rgb(0.35, 0.35, 0.35);
const BLACK = rgb(0.1, 0.1, 0.1);

const arabicFontCache = { value: null };
const logoCache = { value: null };

async function loadPublicAsset(req, relativePath, cacheRef) {
  if (cacheRef.value) return cacheRef.value;
  const filePath = path.join(process.cwd(), "public", relativePath);
  try {
    cacheRef.value = fs.readFileSync(filePath);
    return cacheRef.value;
  } catch (e) {
    const origin = new URL(req.url).origin;
    const res = await fetch(`${origin}/${relativePath}`);
    const buf = Buffer.from(await res.arrayBuffer());
    cacheRef.value = buf;
    return buf;
  }
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
  pdf.registerFontkit(fontkit);
  const page = pdf.addPage([420, 400]);
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);

  const arabicFontBytes = await loadPublicAsset(req, "fonts/NotoSansArabic.ttf", arabicFontCache);
  const arabicFont = await pdf.embedFont(arabicFontBytes);

  let logoImage = null;
  try {
    const logoBytes = await loadPublicAsset(req, "logo-full.png", logoCache);
    logoImage = await pdf.embedPng(logoBytes);
  } catch (e) {
    // logo optional
  }

  const { width, height } = page.getSize();
  const margin = 24;

  // Draws mixed Arabic+Latin text right-aligned at `rightX`, rendering each run
  // with the correct font so digits never get reversed by the Arabic font.
  function drawMixedRight(text, rightX, y, size, color) {
    const runs = arabicVisualRuns(text);
    let totalW = 0;
    const widths = runs.map((r) => {
      const f = r.arabic ? arabicFont : font;
      const w = f.widthOfTextAtSize(r.text, size);
      totalW += w;
      return w;
    });
    let x = rightX - totalW;
    runs.forEach((r, i) => {
      const f = r.arabic ? arabicFont : font;
      page.drawText(r.text, { x, y, size, font: f, color });
      x += widths[i];
    });
    return totalW;
  }

  function drawMixedCentered(text, centerX, y, size, color) {
    const runs = arabicVisualRuns(text);
    let totalW = 0;
    const widths = runs.map((r) => {
      const f = r.arabic ? arabicFont : font;
      const w = f.widthOfTextAtSize(r.text, size);
      totalW += w;
      return w;
    });
    let x = centerX - totalW / 2;
    runs.forEach((r, i) => {
      const f = r.arabic ? arabicFont : font;
      page.drawText(r.text, { x, y, size, font: f, color });
      x += widths[i];
    });
  }

  // Border
  page.drawRectangle({ x: 8, y: 8, width: width - 16, height: height - 16, borderColor: rgb(0.7, 0.7, 0.7), borderWidth: 1 });

  // Logo, top-left
  if (logoImage) {
    const logoW = 60;
    const logoH = (logoImage.height / logoImage.width) * logoW;
    page.drawImage(logoImage, { x: margin, y: height - 30 - logoH, width: logoW, height: logoH });
  }

  // Title, top-right (pure Arabic, safe as a single run)
  const titleVisual = toArabicVisual("إيصال استلام نقدية");
  const titleW = arabicFont.widthOfTextAtSize(titleVisual, 16);
  page.drawText(titleVisual, { x: width - margin - titleW, y: height - 50, size: 16, font: arabicFont, color: BLACK });

  // Receipt number, in red, just the sequential portion (e.g. INV-2026-00015 -> 00015)
  const seqMatch = invoice.invoice_number.match(/(\d+)$/);
  const receiptStr = seqMatch ? seqMatch[1] : invoice.invoice_number;
  const numW = bold.widthOfTextAtSize(receiptStr, 14);
  page.drawText(receiptStr, { x: width - margin - numW, y: height - 78, size: 14, font: bold, color: RED });

  page.drawLine({ start: { x: margin, y: height - 96 }, end: { x: width - margin, y: height - 96 }, thickness: 1, color: rgb(0.15, 0.15, 0.15) });

  let y = height - 130;
  function field(labelAr, value, showUnit) {
    drawMixedRight(labelAr, width - margin, y, 12, BLACK);
    if (showUnit) {
      drawMixedRight("جم", width - margin - 90, y, 11, GRAY);
    }
    if (value) {
      page.drawText(String(value), { x: margin, y, size: 12, font: bold, color: NAVY });
    } else {
      page.drawLine({ start: { x: margin, y: y - 2 }, end: { x: width - margin - 100, y: y - 2 }, thickness: 0.5, color: rgb(0.85, 0.85, 0.85) });
    }
    y -= 34;
  }

  field("المبلغ", `${Number(invoice.amount).toLocaleString("en-US")}`, true);
  field("الاسم", invoice.patient_name, false);
  field("الفحص", invoice.exam, false);
  field("تاريخ الفحص", invoice.exam_date, false);

  // Amount in words (pure Arabic phrase, safe as single run)
  const arabicWords = numberToArabicWords(invoice.amount);
  const wordsVisual = toArabicVisual(arabicWords);
  const wordsW = arabicFont.widthOfTextAtSize(wordsVisual, 9);
  page.drawText(wordsVisual, { x: width - margin - wordsW, y: y - 4, size: 9, font: arabicFont, color: GRAY });
  y -= 30;

  page.drawLine({ start: { x: margin, y }, end: { x: width - margin, y }, thickness: 1, color: rgb(0.15, 0.15, 0.15) });
  y -= 22;

  // Footer: real clinic address + phone (mixed Arabic/numbers, drawn run-by-run)
  drawMixedCentered("عيادة 353 - المركز الطبي 3 - شارع ابو داوود الظاهرى - المنطقة الحادية عشر - مدينة نصر", width / 2, y, 8, GRAY);
  y -= 14;
  drawMixedCentered("ت : 15184 - 0128887187", width / 2, y, 8, GRAY);

  // Stamp
  const stampX = width - 78;
  const stampY = 48;
  page.drawCircle({ x: stampX, y: stampY, size: 34, borderColor: GOLD, borderWidth: 1.3 });
  page.drawCircle({ x: stampX, y: stampY, size: 29, borderColor: GOLD, borderWidth: 0.6 });
  const s1 = "AL SHROOOUK", s2 = "SCAN & LAB";
  page.drawText(s1, { x: stampX - bold.widthOfTextAtSize(s1, 5.5) / 2, y: stampY + 8, size: 5.5, font: bold, color: GOLD });
  page.drawText(s2, { x: stampX - bold.widthOfTextAtSize(s2, 5.5) / 2, y: stampY - 1, size: 5.5, font: bold, color: GOLD });
  const s3Visual = toArabicVisual("إيصال رسمي");
  const s3w = arabicFont.widthOfTextAtSize(s3Visual, 5.5);
  page.drawText(s3Visual, { x: stampX - s3w / 2, y: stampY - 12, size: 5.5, font: arabicFont, color: GOLD });

  const bytes = await pdf.save();
  return new NextResponse(bytes, {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="${invoice.invoice_number}.pdf"`,
    },
  });
}
