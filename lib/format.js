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
