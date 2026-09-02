// Egyptian pound amounts written out in Arabic, for the receipt line
// "1160 جم الف و مائة وستون جنيه مصري فقط لا غير".
//
// Written out rather than pulled from a library because the receipt is a
// financial document: a wrong word here is a wrong receipt, and this needs to
// be readable and checkable by someone who knows the language.

const ONES = ["", "واحد", "اثنان", "ثلاثة", "أربعة", "خمسة", "ستة", "سبعة", "ثمانية", "تسعة"];
const TEENS = ["عشرة", "أحد عشر", "اثنا عشر", "ثلاثة عشر", "أربعة عشر", "خمسة عشر", "ستة عشر", "سبعة عشر", "ثمانية عشر", "تسعة عشر"];
const TENS = ["", "", "عشرون", "ثلاثون", "أربعون", "خمسون", "ستون", "سبعون", "ثمانون", "تسعون"];
const HUNDREDS = ["", "مائة", "مائتان", "ثلاثمائة", "أربعمائة", "خمسمائة", "ستمائة", "سبعمائة", "ثمانمائة", "تسعمائة"];

// Under 1000. Arabic puts the unit BEFORE the ten - 21 is "one and twenty" -
// so the parts are assembled in that order, not left to right.
function underThousand(n) {
  const parts = [];
  const h = Math.floor(n / 100);
  const rest = n % 100;
  if (h) parts.push(HUNDREDS[h]);
  if (rest >= 10 && rest < 20) {
    parts.push(TEENS[rest - 10]);
  } else {
    const t = Math.floor(rest / 10);
    const u = rest % 10;
    if (u && t >= 2) parts.push(`${ONES[u]} و${TENS[t]}`);
    else if (t >= 2) parts.push(TENS[t]);
    else if (u) parts.push(ONES[u]);
  }
  return parts.join(" و");
}

// Thousands take their own dual and plural forms, and the counted noun changes
// shape with the number - 3,000 is "three thousands", not "three thousand".
function thousandsWord(n) {
  if (n === 1) return "ألف";
  if (n === 2) return "ألفان";
  // ONES stops at nine, so ten needs its own word here.
  if (n >= 3 && n <= 9) return `${ONES[n]} آلاف`;
  if (n === 10) return "عشرة آلاف";
  return `${underThousand(n)} ألف`;
}

function millionsWord(n) {
  if (n === 1) return "مليون";
  if (n === 2) return "مليونان";
  if (n >= 3 && n <= 9) return `${ONES[n]} ملايين`;
  if (n === 10) return "عشرة ملايين";
  return `${underThousand(n)} مليون`;
}

export function amountInArabicWords(amount) {
  const total = Math.round(Number(amount) * 100) / 100;
  const pounds = Math.floor(total);
  const piastres = Math.round((total - pounds) * 100);

  if (pounds === 0 && piastres === 0) return "صفر جنيه مصري فقط لا غير";

  const parts = [];
  const millions = Math.floor(pounds / 1000000);
  const thousands = Math.floor((pounds % 1000000) / 1000);
  const rest = pounds % 1000;

  if (millions) parts.push(millionsWord(millions));
  if (thousands) parts.push(thousandsWord(thousands));
  if (rest) parts.push(underThousand(rest));

  let out = parts.join(" و");
  out += " جنيه مصري";

  if (piastres) {
    out += ` و${underThousand(piastres)} قرشا`;
  }
  return `${out} فقط لا غير`;
}
