import ArabicReshaper from "arabic-reshaper";

function isArabicChar(c) {
  const code = c.codePointAt(0);
  return (code >= 0x0600 && code <= 0x06ff) || (code >= 0xfb50 && code <= 0xfdff) || (code >= 0xfe70 && code <= 0xfeff);
}

// Splits text into runs in correct RTL visual order. Each run is tagged so the
// caller can render Arabic runs with an Arabic-capable font and non-Arabic runs
// (numbers, Latin) with a regular font, drawn separately, this avoids a rendering
// quirk where mixing digits into the same drawText call as reshaped Arabic glyphs
// causes the digits themselves to render in reversed order.
export function arabicVisualRuns(text) {
  const reshaped = ArabicReshaper.convertArabic(text);
  const runs = [];
  let current = "";
  let currentIsArabic = null;
  for (const ch of reshaped) {
    const arabic = isArabicChar(ch);
    if (currentIsArabic === null || arabic === currentIsArabic) {
      current += ch;
      currentIsArabic = arabic;
    } else {
      runs.push({ text: current, arabic: currentIsArabic });
      current = ch;
      currentIsArabic = arabic;
    }
  }
  if (current) runs.push({ text: current, arabic: currentIsArabic });
  return runs.reverse().map((r) => ({
    text: r.arabic ? r.text.split("").reverse().join("") : r.text,
    arabic: r.arabic,
  }));
}

// Convenience for pure-Arabic strings (no digits/Latin mixed in) where a single
// drawText call is safe.
export function toArabicVisual(text) {
  return arabicVisualRuns(text)
    .map((r) => r.text)
    .join("");
}
