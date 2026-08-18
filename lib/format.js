export function formatMoney(value, options = {}) {
  const num = Number(value);
  if (value === null || value === undefined || isNaN(num)) return "0";
  const decimals = options.decimals ?? 0;
  return num.toLocaleString("en-US", {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
}
