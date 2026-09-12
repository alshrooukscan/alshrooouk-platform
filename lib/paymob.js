// Paymob (Accept) read-only client.
//
// The clinic's card terminal reports into Paymob, not into this platform, so
// the only way to prove a visit was really paid by card is to go and read the
// transaction back out of Paymob. Everything here is read-only on purpose: we
// never create, refund or void a payment from the platform.
//
// Two things about this API are worth knowing before changing anything here:
//
//  1. Paymob returns timestamps in CAIRO LOCAL TIME with no offset on them,
//     while this platform stores everything in UTC. Comparing the two raw
//     puts an evening payment on the wrong day. PAYMOB_TZ_OFFSET_HOURS below
//     is the conversion, and it must be applied on every comparison.
//  2. The transaction list lags. A card charge shows up in the API a little
//     after the customer taps, so verification cannot be a one-shot check at
//     save time - it has to be retried. That is why the verify route runs on
//     a schedule instead of inside the payment form.

const BASE = "https://accept.paymob.com";

// Cairo is UTC+3 year round (Egypt reintroduced DST in 2023, but Paymob's
// own timestamps track the clinic's wall clock, which is what we match on).
export const PAYMOB_TZ_OFFSET_HOURS = 3;

// The clinic runs several terminals on one Paymob merchant account. Only this
// one is the scan centre's; the others belong to the dental supply store and
// must never be used to verify a visit payment, or a store charge of the same
// amount could be claimed as a patient's scan payment.
export const SCAN_TERMINAL_ID = process.env.PAYMOB_TERMINAL_ID || "1002156";

let cached = { token: null, at: 0 };

// Paymob auth tokens last an hour. Re-using one across calls inside the same
// warm serverless instance keeps a sync run down to a single login.
async function authToken() {
  const apiKey = process.env.PAYMOB_API_KEY;
  if (!apiKey) throw new Error("PAYMOB_API_KEY missing");
  if (cached.token && Date.now() - cached.at < 45 * 60 * 1000) return cached.token;

  const res = await fetch(`${BASE}/api/auth/tokens`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ api_key: apiKey }),
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`Paymob auth failed (${res.status})`);
  const json = await res.json();
  if (!json?.token) throw new Error("Paymob auth returned no token");
  cached = { token: json.token, at: Date.now() };
  return json.token;
}

// Newest-first pages of transactions. maxPages is a guard: without it a bad
// cursor could walk the whole account history on every cron tick.
export async function listTransactions({ pageSize = 100, maxPages = 3 } = {}) {
  const token = await authToken();
  let url = `${BASE}/api/acceptance/transactions?page_size=${pageSize}&page=1`;
  const out = [];
  for (let i = 0; i < maxPages && url; i++) {
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${token}` },
      cache: "no-store",
    });
    if (!res.ok) throw new Error(`Paymob list failed (${res.status})`);
    const json = await res.json();
    out.push(...(json.results || []));
    url = json.next || null;
  }
  return out;
}

export async function getTransaction(transactionId) {
  const token = await authToken();
  const res = await fetch(`${BASE}/api/acceptance/transactions/${transactionId}`, {
    headers: { Authorization: `Bearer ${token}` },
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`Paymob fetch failed (${res.status})`);
  return res.json();
}

// Flattens a Paymob transaction into the shape of our mirror table. Card
// payments carry a fee, so gross and net are both kept: the patient paid the
// gross, the clinic banks the net, and reconciliation needs to see both.
export function normalise(t) {
  const sd = t.source_data || {};
  const amount = Number(t.amount_cents || 0) / 100;
  const fees = Number(t.accept_fees || 0) / 100;
  return {
    id: t.id,
    order_id: t.order?.id ?? null,
    terminal_id: t.terminal_id != null ? String(t.terminal_id) : null,
    integration_id: t.integration_id ?? null,
    amount,
    fees,
    net_amount: Number((amount - fees).toFixed(2)),
    success: !!t.success,
    is_voided: !!t.is_voided,
    is_refunded: !!t.is_refunded,
    is_settled: !!t.is_settled,
    source_type: sd.type ?? null,
    card_brand: sd.sub_type ?? null,
    card_last4: sd.pan ?? null,
    api_source: t.api_source ?? null,
    created_at_paymob: String(t.created_at || "").slice(0, 19),
  };
}

// A payment and a charge are the same money only if the amounts agree to the
// piastre and they happened close together on the same day. The window is
// deliberately generous (reception often logs the payment a few minutes after
// the card clears) but not unlimited, because two patients paying the same
// amount hours apart are not the same transaction.
export function withinWindow(paymentUtcIso, paymobLocalIso, minutes) {
  const paymentLocal = new Date(new Date(paymentUtcIso).getTime() + PAYMOB_TZ_OFFSET_HOURS * 3600 * 1000);
  const charge = new Date(`${paymobLocalIso}Z`);
  const gapMinutes = Math.abs(charge - paymentLocal) / 60000;
  return { ok: gapMinutes <= minutes, gapMinutes: Math.round(gapMinutes) };
}
