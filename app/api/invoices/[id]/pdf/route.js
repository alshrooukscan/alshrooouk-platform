import { NextResponse } from "next/server";
import { PDFDocument, rgb, StandardFonts } from "pdf-lib";
import fontkit from "@pdf-lib/fontkit";
import ArabicReshaper from "arabic-reshaper";
import fs from "fs";
import path from "path";
import { supabaseAdmin } from "../../../../../lib/supabaseAdmin";
import { numberToArabicWords } from "../../../../../lib/arabicNumberWords";

const NAVY = rgb(0x27 / 255, 0x21 / 255, 0x4d / 255);
const GOLD = rgb(0xa9 / 255, 0x8b / 255, 0x4d / 255);
const GRAY = rgb(0.4, 0.4, 0.4);

function toArabicVisual(text) {
  const reshaped = ArabicReshaper.convertArabic(text);
  return reshaped.split("").reverse().join("");
}

export async function GET(req, { params }) {
  const { data: invoice, error } = await supabaseAdmin.from("invoices").select("*").eq("id", params.id).single();
  if (error || !invoice) {
    return NextResponse.json({ error: "Invoice not found" }, { status: 404 });
  }

  const pdf = await PDFDocument.create();
  pdf.registerFontkit(fontkit);
  const page = pdf.addPage([396, 600]); // receipt-shaped, extended for stamp + Arabic line
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const fontPath = path.join(process.cwd(), "public", "fonts", "NotoSansArabic.ttf");
  const arabicFont = await pdf.embedFont(fs.readFileSync(fontPath));
  const { width, height } = page.getSize();

  // Navy header block
  page.drawRectangle({ x: 0, y: height - 110, width, height: 110, color: NAVY });
  page.drawText("Al Shrooouk Scan & Lab", { x: 24, y: height - 46, size: 17, font: bold, color: rgb(1, 1, 1) });
  page.drawText("Medical Center 3 - Nasr City", { x: 24, y: height - 66, size: 10, font, color: rgb(0.85, 0.85, 0.9) });
  page.drawText("353 - MC3 - Abo Dawoud Al Daherey St.", { x: 24, y: height - 80, size: 9, font, color: rgb(0.75, 0.75, 0.85) });

  const receiptLabel = "RECEIPT NUMBER";
  const rlWidth = font.widthOfTextAtSize(receiptLabel, 8);
  page.drawText(receiptLabel, { x: width - 24 - rlWidth, y: height - 40, size: 8, font, color: rgb(0.8, 0.8, 0.85) });
  const numWidth = bold.widthOfTextAtSize(invoice.invoice_number, 14);
  page.drawText(invoice.invoice_number, { x: width - 24 - numWidth, y: height - 58, size: 14, font: bold, color: rgb(1, 1, 1) });

  // Watermark
  page.drawText("SH", { x: width / 2 - 60, y: height / 2 - 40, size: 140, font: bold, color: rgb(0.27, 0.21, 0.48), opacity: 0.04 });

  let y = height - 150;
  function row(label, value, big) {
    page.drawText(label, { x: 24, y, size: 8, font, color: GRAY });
    page.drawText(String(value), { x: 24, y: y - (big ? 26 : 18), size: big ? 24 : 13, font: bold, color: NAVY });
    y -= big ? 60 : 46;
  }

  const formattedAmount = Number(invoice.amount).toLocaleString("en-US");
  row("TOTAL AMOUNT DUE", `${formattedAmount} EGP`, true);
  row("PATIENT NAME", invoice.patient_name);
  row("EXAM / SCAN TYPE", invoice.exam);
  row("EXAM DATE", invoice.exam_date);

  // Arabic amount-in-words transcript
  const arabicPhrase = numberToArabicWords(invoice.amount);
  const arabicVisual = toArabicVisual(arabicPhrase);
  page.drawText("AMOUNT IN WORDS (ARABIC)", { x: 24, y, size: 8, font, color: GRAY });
  page.drawText(arabicVisual, { x: 24, y: y - 20, size: 13, font: arabicFont, color: NAVY });
  y -= 56;

  page.drawLine({ start: { x: 24, y }, end: { x: width - 24, y }, thickness: 0.5, color: rgb(0.85, 0.85, 0.85) });
  y -= 20;

  // Official stamp: a simple circular seal, drawn as vector shapes (no external image dependency)
  const stampX = width - 90;
  const stampY = y - 40;
  page.drawCircle({ x: stampX, y: stampY, size: 42, borderColor: GOLD, borderWidth: 1.5 });
  page.drawCircle({ x: stampX, y: stampY, size: 36, borderColor: GOLD, borderWidth: 0.75 });
  const stampLine1 = "AL SHROOOUK";
  const stampLine2 = "SCAN & LAB";
  const stampLine3 = "OFFICIAL RECEIPT";
  page.drawText(stampLine1, { x: stampX - bold.widthOfTextAtSize(stampLine1, 7) / 2, y: stampY + 12, size: 7, font: bold, color: GOLD });
  page.drawText(stampLine2, { x: stampX - bold.widthOfTextAtSize(stampLine2, 7) / 2, y: stampY + 2, size: 7, font: bold, color: GOLD });
  page.drawText(stampLine3, { x: stampX - font.widthOfTextAtSize(stampLine3, 5.5) / 2, y: stampY - 12, size: 5.5, font, color: GOLD });

  page.drawText("Thank you for choosing Al Shrooouk Scan & Lab", { x: 24, y: y - 60, size: 8, font, color: GRAY });

  const bytes = await pdf.save();
  return new NextResponse(bytes, {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="${invoice.invoice_number}.pdf"`,
    },
  });
}
