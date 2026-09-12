import { supabase } from "./supabase";

/**
 * Asks the server to look for the Paymob charge behind a card payment that was
 * just recorded.
 *
 * Paymob publishes a charge a short while after the customer taps, so checking
 * the instant the payment is saved usually finds nothing. This fires a couple
 * of times over the following minute, which covers the normal lag without
 * making reception wait.
 *
 * Deliberately fire-and-forget: verification adds proof to a payment that has
 * already been saved. If every attempt here fails - offline, Paymob down, a
 * closed laptop - the payment is still recorded correctly and the end-of-day
 * sweep picks it up. Nothing the receptionist did is lost, so nothing here
 * should ever surface an error at the counter.
 */
export function verifyPaymentSoon(method) {
  if (!["Visa", "Wallet"].includes(method)) return;

  const attempt = async () => {
    try {
      const { data } = await supabase.auth.getSession();
      const token = data?.session?.access_token;
      if (!token) return;
      await fetch("/api/paymob/sync", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
        keepalive: true,
      });
    } catch {
      // Silent by design - see above.
    }
  };

  setTimeout(attempt, 8000);
  setTimeout(attempt, 45000);
}
