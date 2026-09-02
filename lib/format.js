export function formatMoney(value, options = {}) {
  const num = Number(value);
  if (value === null || value === undefined || isNaN(num)) return "0";
  const decimals = options.decimals ?? 0;
  return num.toLocaleString("en-US", {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
}

// Visit dates are stored as plain YYYY-MM-DD. Rendering them raw made staff
// read an ISO string to answer "when was this scan?", so every visit surface
// now formats them the same readable way. Parsed with an explicit midnight
// suffix - `new Date("2026-08-29")` is treated as UTC and can render as the
// previous day in a negative-offset timezone.
export function formatVisitDate(value) {
  if (!value) return "No date recorded";
  const raw = String(value).slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) return String(value);
  const d = new Date(raw + "T00:00:00");
  if (isNaN(d)) return String(value);
  return d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
}

// "10 Dec 2023 · 4:28 PM" when a time was recorded, and the date alone when it
// was not. Around 700 migrated visits have no time in the source form, and
// showing those as midnight would read as a real 12:00 AM appointment.
export function formatVisitDateTime(date, time) {
  const d = formatVisitDate(date);
  if (!time) return d;
  const [h, m] = String(time).split(":");
  const hour = Number(h);
  if (Number.isNaN(hour)) return d;
  const suffix = hour >= 12 ? "PM" : "AM";
  const h12 = hour % 12 === 0 ? 12 : hour % 12;
  return `${d} \u00B7 ${h12}:${m} ${suffix}`;
}

// Doctor names in this data are inconsistent: 103 of 166 already carry a title
// ("Dr. Kotb", "Dr Akaad", "Dr . Yousry") and others use the Arabic-style
// "D/ Mansour". Prefixing "Dr." unconditionally produced "Dr. Dr . Hazem
// Yousry" on screen, so only add a title when the name does not already have one.
export function doctorLabel(name) {
  const n = String(name || "").trim();
  if (!n) return "";
  if (/^d\s*[./]?\s*r?\b/i.test(n)) return n;
  return `Dr. ${n}`;
}
