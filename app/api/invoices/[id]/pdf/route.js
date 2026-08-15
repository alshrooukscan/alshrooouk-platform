import { NextResponse } from "next/server";
import { PDFDocument, rgb, StandardFonts } from "pdf-lib";
import { supabaseAdmin } from "../../../../../lib/supabaseAdmin";

const NAVY = rgb(0x27 / 255, 0x21 / 255, 0x4d / 255);
const GOLD = rgb(0xa9 / 255, 0x8b / 255, 0x4d / 255);
const GRAY = rgb(0.4, 0.4, 0.4);

export async function GET(req, { params }) {
  const { data: invoice, error } = await supabaseAdmin.from("invoices").select("*").eq("id", params.id).single();
  if (error || !invoice) {
    return NextResponse.json({ error: "Invoice not found" }, { status: 404 });
  }

  const pdf = await PDFDocument.create();
  const page = pdf.addPage([396, 560]); // receipt-shaped, ~4.1 x 5.8in
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
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
  page.drawText("SH", { x: width / 2 - 60, y: height / 2 - 20, size: 140, font: bold, color: rgb(0.27, 0.21, 0.48), opacity: 0.04 });

  let y = height - 150;
  function row(label, value, big) {
    page.drawText(label, { x: 24, y, size: 8, font, color: GRAY });
    page.drawText(String(value), { x: 24, y: y - (big ? 26 : 18), size: big ? 24 : 13, font: bold, color: NAVY });
    y -= big ? 60 : 46;
  }

  row("TOTAL AMOUNT DUE", `${invoice.amount} EGP`, true);
  row("PATIENT NAME", invoice.patient_name);
  row("EXAM / SCAN TYPE", invoice.exam);
  row("EXAM DATE", invoice.exam_date);

  page.drawLine({ start: { x: 24, y: 70 }, end: { x: width - 24, y: 70 }, thickness: 0.5, color: rgb(0.85, 0.85, 0.85) });
  page.drawText("Thank you for choosing Al Shrooouk Scan & Lab", { x: 24, y: 50, size: 8, font, color: GRAY });

  const bytes = await pdf.save();
  return new NextResponse(bytes, {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="${invoice.invoice_number}.pdf"`,
    },
  });
}
