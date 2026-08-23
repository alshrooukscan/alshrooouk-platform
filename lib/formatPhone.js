// Formats phone numbers for display with the international country code, defaulting
// to Egypt (+20). Only affects display, never mutates stored data, since real numbers
// in the system come in many raw formats and we don't want to risk corrupting them.
export function formatPhone(raw) {
  if (!raw) return "";
  let digits = String(raw).replace(/\D/g, "");
  if (!digits) return raw;

  // Already has a country code typed in (leading 20 followed by an 11-digit Egyptian
  // mobile, or any number 11+ digits starting with a non-zero country code).
  if (digits.startsWith("20") && digits.length >= 12) {
    return `+${digits}`;
  }
  // Standard Egyptian mobile written locally as 01xxxxxxxxx.
  if (digits.startsWith("0") && digits.length === 11) {
    return `+20${digits.slice(1)}`;
  }
  // Egyptian mobile with the leading 0 already stripped (10xxxxxxxx).
  if (digits.length === 10 && /^1[0-9]/.test(digits)) {
    return `+20${digits}`;
  }
  // Real numbers in this system include other countries (Saudi 966, Sudan 249, Iraq
  // 964, France 33, etc). If it's a plausible full international number (11-15
  // digits) just missing its +, add the + without touching the digits, since
  // guessing a country code here would risk misrepresenting a real number.
  if (digits.length >= 11 && digits.length <= 15) {
    return `+${digits}`;
  }
  // Too short or ambiguous to safely interpret, show as originally stored.
  return raw;
}
