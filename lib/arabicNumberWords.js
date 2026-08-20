const ONES = ["", "واحد", "اثنان", "ثلاثة", "أربعة", "خمسة", "ستة", "سبعة", "ثمانية", "تسعة"];
const ONES_TEEN = ["عشرة", "أحد عشر", "اثنا عشر", "ثلاثة عشر", "أربعة عشر", "خمسة عشر", "ستة عشر", "سبعة عشر", "ثمانية عشر", "تسعة عشر"];
const TENS = ["", "", "عشرون", "ثلاثون", "أربعون", "خمسون", "ستون", "سبعون", "ثمانون", "تسعون"];
const HUNDREDS = ["", "مائة", "مئتان", "ثلاثمائة", "أربعمائة", "خمسمائة", "ستمائة", "سبعمائة", "ثمانمائة", "تسعمائة"];

function threeDigits(n) {
  const parts = [];
  const h = Math.floor(n / 100);
  const rem = n % 100;
  if (h > 0) parts.push(HUNDREDS[h]);
  if (rem >= 10 && rem < 20) {
    parts.push(ONES_TEEN[rem - 10]);
  } else {
    const o = rem % 10;
    const t = Math.floor(rem / 10);
    if (o > 0 && t > 0) parts.push(`${ONES[o]} و${TENS[t]}`);
    else if (t > 0) parts.push(TENS[t]);
    else if (o > 0) parts.push(ONES[o]);
  }
  return parts.join(" و");
}

export function numberToArabicWords(num) {
  num = Math.round(Number(num) || 0);
  if (num === 0) return "صفر جنيه مصري فقط لا غير";

  const thousands = Math.floor(num / 1000);
  const remainder = num % 1000;

  const parts = [];
  if (thousands > 0) {
    if (thousands === 1) parts.push("ألف");
    else if (thousands === 2) parts.push("ألفان");
    else if (thousands >= 3 && thousands <= 10) parts.push(`${threeDigits(thousands)} آلاف`);
    else parts.push(`${threeDigits(thousands)} ألف`);
  }
  if (remainder > 0) {
    parts.push(threeDigits(remainder));
  }

  return `${parts.join(" و")} جنيه مصري فقط لا غير`;
}
