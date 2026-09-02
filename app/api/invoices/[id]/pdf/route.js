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


// "Thu Nov 09 2023 00:00:00 GMT+0200 (Eastern European Standard Time)" - the
// timestamp exactly as the clinic's own receipt prints it. Built for Cairo
// rather than the server's clock, which is UTC and would print GMT+0000.
function cairoTimestamp(dateOnly) {
  const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const [y, m, d] = dateOnly.split("-").map(Number);
  const noon = new Date(Date.UTC(y, m - 1, d, 12));

  // Egypt observes summer time, so the offset is read from the zone itself
  // rather than hard-coded to +2.
  const tzName = new Intl.DateTimeFormat("en-GB", { timeZone: "Africa/Cairo", timeZoneName: "long" })
    .formatToParts(noon).find((p) => p.type === "timeZoneName")?.value || "Eastern European Standard Time";
  const shortOffset = new Intl.DateTimeFormat("en-GB", { timeZone: "Africa/Cairo", timeZoneName: "longOffset" })
    .formatToParts(noon).find((p) => p.type === "timeZoneName")?.value || "GMT+02:00";
  const offset = shortOffset.replace(":", "");

  const dow = DAYS[new Date(Date.UTC(y, m - 1, d)).getUTCDay()];
  const dd = String(d).padStart(2, "0");
  return `${dow} ${MONTHS[m - 1]} ${dd} ${y} 00:00:00 ${offset} (${tzName})`;
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

  // Geometry taken from the receipt the clinic actually issues: an inset frame
  // with generous margins, the logo tucked beside a centred title, tightly
  // spaced rows, a wrapped address and a large seal sitting over the corner.
  const FRAME_X = 44, FRAME_W = width - 88;
  const FRAME_TOP = height - 34, FRAME_BOTTOM = 30;
  page.drawRectangle({
    x: FRAME_X, y: FRAME_BOTTOM, width: FRAME_W, height: FRAME_TOP - FRAME_BOTTOM,
    borderColor: BLACK, borderWidth: 1.2,
  });

  const INNER_L = FRAME_X + 22;
  const INNER_R = FRAME_X + FRAME_W - 22;

  // Title, centred in the frame.
  const titleImg = await drawArabicImage(kashida("إيصال استلام نقدية", 3), { size: 40, bold: true });
  const titleW = 150, titleH = (titleImg.height / titleImg.width) * titleW;
  const titleCx = FRAME_X + FRAME_W * 0.56;
  page.drawImage(titleImg, { x: titleCx - titleW / 2, y: height - 78, width: titleW, height: titleH });

  // Logo sits to the LEFT of the title, not out at the margin.
  const logoW = 78;
  page.drawImage(logoImage, { x: FRAME_X + FRAME_W * 0.13, y: height - 92 - logoW / 2, width: logoW, height: logoW });

  // Receipt number: Courier, red, centred beneath the title.
  const seqMatch = invoice.invoice_number.match(/(\d+)$/);
  const receiptStr = seqMatch ? seqMatch[1] : invoice.invoice_number;
  const numSize = 15;
  const numW = courier.widthOfTextAtSize(receiptStr, numSize);
  page.drawText(receiptStr, { x: titleCx - numW / 2, y: height - 100, size: numSize, font: courier, color: RED });

  page.drawLine({ start: { x: INNER_L, y: height - 126 }, end: { x: INNER_R, y: height - 126 }, thickness: 1.2, color: BLACK });

  // Rows sit close together, as on the issued receipt - not spread down the page.
  let y = height - 165;
  const ROW_GAP = 27;
  const LABEL_RIGHT = INNER_R;
  const VALUE_RIGHT = INNER_R - 108;
  const LABELS = { amount: "المبلغ:", name: "الاسم :", exam: "الفحص :", date: "تاريخ الفحص:" };

  async function label(key) {
    const img = await drawArabicImage(kashida(LABELS[key], 3), { size: 26, bold: true });
    const h = 13, w = (img.width / img.height) * h;
    page.drawImage(img, { x: LABEL_RIGHT - w, y: y - 3, width: w, height: h });
  }

  // Values are regular-weight Courier, right-aligned to the value column.
  function valueRight(text, size = 10.5, yy = y) {
    const w = courier.widthOfTextAtSize(String(text), size);
    page.drawText(String(text), { x: VALUE_RIGHT - w, y: yy, size, font: courier, color: BLACK });
  }

  await label("amount");
  {
    const figure = Number(invoice.amount).toLocaleString("en-US");
    const line = kashida(`${figure} جم ${amountInArabicWords(invoice.amount)}`, 3);
    const img = await drawArabicImage(line, { size: 26 });
    const h = 16, w = (img.width / img.height) * h;
    const maxW = VALUE_RIGHT - INNER_L;
    const drawW = Math.min(w, maxW);
    const drawH = drawW === w ? h : (img.height / img.width) * drawW;
    page.drawImage(img, { x: VALUE_RIGHT - drawW, y: y - (drawH - h) / 2 - 3, width: drawW, height: drawH });
  }
  y -= ROW_GAP;

  await label("name");
  if (invoice.patient_name) valueRight(invoice.patient_name);
  y -= ROW_GAP;

  await label("exam");
  if (invoice.exam) valueRight(invoice.exam);
  y -= ROW_GAP;

  // The issued receipt carries the full timestamp, wrapped when it runs long.
  await label("date");
  {
    const full = invoice.exam_date ? cairoTimestamp(invoice.exam_date) : "";
    const size = 10.5;
    const maxW = VALUE_RIGHT - INNER_L;
    const words = full.split(" ");
    const lines = [];
    let cur = "";
    for (const w of words) {
      const test = cur ? `${cur} ${w}` : w;
      if (courier.widthOfTextAtSize(test, size) > maxW && cur) {
        lines.push(cur);
        cur = w;
      } else cur = test;
    }
    if (cur) lines.push(cur);
    lines.forEach((ln, i) => valueRight(ln, size, y - i * 13));
    y -= (lines.length - 1) * 13;
  }
  y -= ROW_GAP + 6;

  const dividerY = y;
  page.drawLine({ start: { x: INNER_L, y: dividerY }, end: { x: INNER_R, y: dividerY }, thickness: 1.2, color: BLACK });

  // Address, bold, centred, wrapped across two lines as on the issued receipt.
  const addrParts = [
    "عيادة 353 - المركز الطبي 3 - شارع ابو داوود الظاهرى - المنطقة",
    "الحادية عشر - مدينة نصر",
  ];
  let fy = dividerY - 22;
  for (const part of addrParts) {
    const img = await drawArabicImage(kashida(part, 3), { size: 24, bold: true });
    const h = 11.5, w = (img.width / img.height) * h;
    page.drawImage(img, { x: FRAME_X + (FRAME_W - w) / 2, y: fy, width: w, height: h });
    fy -= 15;
  }

  fy -= 10;
  {
    const digits = "15184 - 0128887187";
    const taImg = await drawArabicImage("ت :", { size: 24, bold: true });
    const taH = 11.5, taW = (taImg.width / taImg.height) * taH;
    const size = 10.5;
    const digitsW = courier.widthOfTextAtSize(digits, size);
    const blockW = taW + 6 + digitsW;
    const startX = FRAME_X + (FRAME_W - blockW) / 2;
    page.drawText(digits, { x: startX, y: fy, size, font: courier, color: BLACK });
    page.drawImage(taImg, { x: startX + digitsW + 6, y: fy - 1, width: taW, height: taH });
  }

  // The seal is large and sits over the bottom-right corner, overlapping the
  // footer the way a hand-applied stamp does.
  if (stamped) {
    const stampW = 96, stampH = stampW * (138 / 139);
    page.drawImage(stampImage, { x: INNER_R - stampW + 14, y: FRAME_BOTTOM + 6, width: stampW, height: stampH, opacity: 0.88 });
  }

  const bytes = await pdf.save();
  return new NextResponse(bytes, {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="${invoice.invoice_number}${stamped ? "-stamped" : ""}.pdf"`,
    },
  });
}
