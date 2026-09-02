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

// Arabic letters that JOIN to the following letter. Only after one of these
// can a tatweel be inserted without breaking the word.
const JOINS_FORWARD_EXTRA = new Set(["ب","ت","ث","ج","ح","خ","س","ش","ص","ض","ط","ظ","ع","غ","ف","ق","ك","ل","م","ن","ه","ي","ئ","ب","ة"]);

// The target receipt was set in a monospaced face, which stretches the joining
// strokes so every glyph fills the same advance - the "الـمبلغ" look. That is
// kashida elongation, and the tatweel character (U+0640) is what Arabic
// typography uses for it. Inserting it after a forward-joining letter keeps the
// word correctly shaped; inserting it anywhere else would break the joins, so
// the check is deliberate rather than a blanket insert.
function kashida(text, every = 3) {
  const out = [];
  let sinceLast = 0;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    const next = text[i + 1];
    out.push(ch);
    sinceLast++;
    // Lam followed by alef forms a single ligature; a tatweel between them
    // splits it into two broken shapes, so that pair is left alone.
    const lamAlef = ch === "\u0644" && "\u0627\u0623\u0625\u0622".includes(next);
    const canStretch =
      JOINS_FORWARD_EXTRA.has(ch) && next && /[\u0600-\u06FF]/.test(next) && next !== "\u0640" && !lamAlef;
    if (canStretch && sinceLast >= every) {
      out.push("\u0640");
      sinceLast = 0;
    }
  }
  return out.join("");
}

// The canvas is sized to the MEASURED text rather than a fixed box. A fixed
// box left the short lines swimming in empty pixels, so when the image was
// scaled to a target height on the page the text inside came out far smaller
// than its neighbours - the amount line was the worst of it.
function renderArabicToPng(text, { size = 26, color = "#0d0d0d", bold = false, family = "NaskhArabic" } = {}) {
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


// "Tue Sep 01 2026" - the date only. The clinic's older receipts carried the
// full timestamp with a timezone name, which took two lines and told the
// patient nothing useful.
function receiptDate(dateOnly) {
  const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const [y, m, d] = dateOnly.split("-").map(Number);
  const dow = DAYS[new Date(Date.UTC(y, m - 1, d)).getUTCDay()];
  return `${dow} ${MONTHS[m - 1]} ${String(d).padStart(2, "0")} ${y}`;
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

  // Every position below is measured from the receipt the clinic issues, scaled
  // to A5 (the source image is 1462x1032, so 1px = 0.407pt). Guessing at these
  // is what kept producing something that looked close but read differently.
  const FRAME_X = 49.6, FRAME_W = 507.6;
  const FRAME_TOP = 378.8, FRAME_BOTTOM = 45.8;
  const FRAME_R = FRAME_X + FRAME_W;
  page.drawRectangle({
    x: FRAME_X, y: FRAME_BOTTOM, width: FRAME_W, height: FRAME_TOP - FRAME_BOTTOM,
    borderColor: BLACK, borderWidth: 1.2,
  });

  // Both rules run the full width of the frame, not inset.
  const DIV_TOP = 289.4, DIV_BOTTOM = 134.5;
  for (const dy of [DIV_TOP, DIV_BOTTOM]) {
    page.drawLine({ start: { x: FRAME_X, y: dy }, end: { x: FRAME_R, y: dy }, thickness: 1.2, color: BLACK });
  }

  // Title: 139.3pt wide, centred on x=299.7. An earlier measurement put it at
  // 232pt on x=253, which was wrong - the scan had picked up the logo's navy
  // wordmark as if it were title text, and the oversized title then ran under
  // the logo. Measured again against near-black pixels only.
  const titleImg = await drawArabicImage(kashida("إيصال استلام نقدية", 3), { size: 40, bold: true });
  const titleW = 139.3, titleH = (titleImg.height / titleImg.width) * titleW;
  page.drawImage(titleImg, { x: 299.7 - titleW / 2, y: 345.5 - titleH / 2, width: titleW, height: titleH });

  // Logo. The asset is a 400x400 square whose visible mark occupies only the
  // middle 76.5% horizontally, so drawing it at the measured 72.1pt would have
  // rendered the mark far too small - and at the width I had guessed it ran
  // over the title. The draw box is scaled up from the ink, then centred on the
  // ink rather than on the asset.
  const LOGO_INK_W = 72.1;
  const logoW = LOGO_INK_W / 0.765;
  const logoH = logoW;
  page.drawImage(logoImage, {
    x: 145.6 - logoW * 0.519,
    y: 334.4 - logoH * (1 - 0.520),
    width: logoW, height: logoH,
  });

  // Receipt number: Courier, red, centred on x=300 - right of the title's centre.
  const seqMatch = invoice.invoice_number.match(/(\d+)$/);
  const receiptStr = seqMatch ? seqMatch[1] : invoice.invoice_number;
  const numSize = 13;
  const numW = courier.widthOfTextAtSize(receiptStr, numSize);
  page.drawText(receiptStr, { x: 300 - numW / 2, y: 315, size: numSize, font: courier, color: RED });

  // Field rows. Labels right-align at 502.7; values right-align at 397.2.
  const LABEL_RIGHT = 502.7;
  const VALUE_RIGHT = 397.2;
  const INNER_L = 91.2;
  const VALUE_SIZE = 12;
  const ROWS_Y = [246, 220.7, 195.4, 170.1];
  const LABELS = { amount: ":المبلغ", name: ": الاسم", exam: ": الفحص", date: ":تاريخ الفحص" };

  async function label(key, yy) {
    const img = await drawArabicImage(kashida(LABELS[key], 3), { size: 26, bold: true });
    const h = 12, w = (img.width / img.height) * h;
    page.drawImage(img, { x: LABEL_RIGHT - w, y: yy - 3, width: w, height: h });
  }
  function valueRight(text, yy) {
    const w = courier.widthOfTextAtSize(String(text), VALUE_SIZE);
    page.drawText(String(text), { x: VALUE_RIGHT - w, y: yy, size: VALUE_SIZE, font: courier, color: BLACK });
  }

  // Amount row. The canvas has no bidirectional layout, so the figure, the unit
  // and the written sum are placed by hand, right to left, in reading order.
  await label("amount", ROWS_Y[0]);
  {
    const y0 = ROWS_Y[0];
    const figure = Number(invoice.amount).toLocaleString("en-US");
    const figW = courier.widthOfTextAtSize(figure, VALUE_SIZE);
    const unitImg = await drawArabicImage("جم");
    const unitH = 12, unitW = (unitImg.width / unitImg.height) * unitH;
    const wordsImg = await drawArabicImage(kashida(amountInArabicWords(invoice.amount), 3));
    let wordsH = 12, wordsW = (wordsImg.width / wordsImg.height) * wordsH;

    const GAP = 1;
    const available = VALUE_RIGHT - INNER_L - figW - unitW - GAP * 2;
    if (wordsW > available) {
      wordsW = available;
      wordsH = (wordsImg.height / wordsImg.width) * wordsW;
    }
    let x = VALUE_RIGHT - figW;
    page.drawText(figure, { x, y: y0, size: VALUE_SIZE, font: courier, color: BLACK });
    x -= GAP + unitW;
    page.drawImage(unitImg, { x, y: y0 - 2.5, width: unitW, height: unitH });
    x -= GAP + wordsW;
    page.drawImage(wordsImg, { x, y: y0 - 2.5 - (wordsH - 12) / 2, width: wordsW, height: wordsH });
  }

  await label("name", ROWS_Y[1]);
  if (invoice.patient_name) valueRight(invoice.patient_name, ROWS_Y[1]);

  await label("exam", ROWS_Y[2]);
  if (invoice.exam) valueRight(invoice.exam, ROWS_Y[2]);

  await label("date", ROWS_Y[3]);
  if (invoice.exam_date) valueRight(receiptDate(invoice.exam_date), ROWS_Y[3]);

  // Address. Each line is placed by its measured left edge and width rather
  // than centred, because on the issued receipt the two lines do NOT share a
  // centre - the first sits well left of the second. Setting the width also
  // fixes the type size, which measuring by height alone had got too small.
  const addrLines = [
    { text: "عيادة 353 - المركز الطبي 3 - شارع ابو داوود الظاهرى - المنطقة", x: 97.3, w: 320.1, y: 104 },
    { text: "الحادية عشر - مدينة نصر", x: 224.0, w: 150.3, y: 93.8 },
  ];
  for (const ln of addrLines) {
    const img = await drawArabicImage(kashida(ln.text, 3), { size: 24, bold: true });
    const h = (img.height / img.width) * ln.w;
    page.drawImage(img, { x: ln.x, y: ln.y, width: ln.w, height: h });
  }

  // Phone line sits lower and is centred on x=300, not on the address centre.
  {
    const digits = "15184 - 0128887187";
    const taImg = await drawArabicImage(": ت", { size: 24, bold: true });
    const taH = 10, taW = (taImg.width / taImg.height) * taH;
    const digitsW = courier.widthOfTextAtSize(digits, VALUE_SIZE);
    const blockW = taW + 6 + digitsW;
    const startX = 300 - blockW / 2;
    page.drawText(digits, { x: startX, y: 77.2, size: VALUE_SIZE, font: courier, color: BLACK });
    page.drawImage(taImg, { x: startX + digitsW + 6, y: 76.2, width: taW, height: taH });
  }

  // Seal. Drawn last so it sits over everything, and shifted left and down so
  // it lands ON the address and the phone line and runs past the bottom of the
  // frame - a stamp pressed onto a finished receipt, not placed in a gap left
  // for it.
  //
  // The asset is a proper cut-out - transparent paper, ink only - so it
  // composites over the words rather than covering them. Opacity is full,
  // because the cut-out already carries the ink's own density.
  if (stamped) {
    // Measured off the original: 92.8pt across, centred at (468.2, 75.8). I had
    // moved it 44pt further left to force an overlap, but the original already
    // catches the right end of the address and runs past the frame from here -
    // so it is put back where it actually sits.
    const stampW = 92.8, stampH = stampW * (138 / 139);
    page.drawImage(stampImage, {
      x: 468.2 - stampW / 2, y: 75.8 - stampH / 2,
      width: stampW, height: stampH,
    });
  }

  const bytes = await pdf.save();
  return new NextResponse(bytes, {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="${invoice.invoice_number}${stamped ? "-stamped" : ""}.pdf"`,
    },
  });
}
