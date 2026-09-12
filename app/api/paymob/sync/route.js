import { NextResponse } from "next/server";
import { requireStaff } from "../../../../lib/requireStaff";
import { supabaseAdmin } from "../../../../lib/supabaseAdmin";
import {
  listTransactions,
  normalise,
  withinWindow,
  SCAN_TERMINAL_ID,
  PAYMOB_TZ_OFFSET_HOURS,
} from "../../../../lib/paymob";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// Payments made before the platform went live were classified in one pass
// against the whole Paymob history. Anything on or after this date is live
// traffic and is verified against the scan terminal only.
const LAUNCH_DATE = "2026-08-29";

// How close the card charge and the logged payment have to be. Reception
// usually records the payment within a couple of minutes of the tap; 30
// minutes covers a busy counter without reaching into an unrelated patient.
const MATCH_WINDOW_MINUTES = 30;

// A card charge that never gets claimed by a payment stops being worth
// chasing after a while, and a payment logged today may still be waiting for
// Paymob to catch up. Both sides only look back this far.
const LOOKBACK_DAYS = 10;

function isoDaysAgo(days) {
  const d = new Date(Date.now() - days * 86400000);
  return d.toISOString().slice(0, 10);
}

/**
 * Pulls recent Paymob transactions into the mirror table, then tries to
 * verify unverified Visa and Wallet payments against them.
 *
 * Runs on a schedule because Paymob publishes a charge slightly after the
 * customer taps - a payment saved at the counter often cannot be verified
 * for another minute or two, so it stays unverified and is picked up on a
 * later tick. Verification only ever adds proof; it never changes an amount,
 * never moves money, and never rewrites a method the staff chose.
 */
async function run() {
  const report = { fetched: 0, stored: 0, verified: 0, stillUnverified: 0, errors: [] };

  // 1. Mirror the newest transactions. Three pages of 100 is about ten days
  //    of clinic traffic, comfortably more than the lookback window.
  const raw = await listTransactions({ pageSize: 100, maxPages: 3 });
  report.fetched = raw.length;

  const rows = raw.map(normalise).filter((r) => r.created_at_paymob);
  if (rows.length) {
    // onConflict keeps the settlement and refund flags fresh on charges we
    // already stored - those change after the fact, at the bank's pace.
    const { error } = await supabaseAdmin
      .from("paymob_transactions")
      .upsert(rows, { onConflict: "id" });
    if (error) report.errors.push(`store: ${error.message}`);
    else report.stored = rows.length;
  }

  // 2. Candidate payments: card-style methods, still without proof, recent,
  //    and after launch. Pre-launch rows were settled in the one-off pass and
  //    must not be touched again.
  const since = isoDaysAgo(LOOKBACK_DAYS);
  const { data: payments, error: payErr } = await supabaseAdmin
    .from("visit_payments")
    .select("id, visit_id, amount, payment_method, paid_at")
    .in("payment_method", ["Visa", "Wallet"])
    .is("payment_verification", null)
    .gte("paid_at", `${since}T00:00:00Z`)
    .order("paid_at", { ascending: false })
    .limit(300);
  if (payErr) {
    report.errors.push(`payments: ${payErr.message}`);
    return report;
  }

  const live = (payments || []).filter((p) => (p.paid_at || "") >= `${LAUNCH_DATE}T00:00:00`);
  if (!live.length) return report;

  // 3. Unclaimed successful charges on the scan terminal, in the same window.
  //    A charge already linked to another payment is excluded, so one tap can
  //    never be counted as two collections.
  const { data: charges, error: txErr } = await supabaseAdmin
    .from("paymob_transactions")
    .select("id, amount, fees, terminal_id, card_brand, card_last4, created_at_paymob")
    .eq("terminal_id", SCAN_TERMINAL_ID)
    .eq("success", true)
    .eq("is_voided", false)
    .is("matched_payment_id", null)
    .gte("created_at_paymob", `${since}T00:00:00`)
    .order("created_at_paymob", { ascending: false });
  if (txErr) {
    report.errors.push(`charges: ${txErr.message}`);
    return report;
  }

  // 4. Closest-in-time wins, and each side can only be used once. Sorting all
  //    candidate pairs by gap before assigning any of them stops an early
  //    loose match from stealing the charge that belonged to a tighter one.
  const pairs = [];
  for (const p of live) {
    for (const c of charges || []) {
      if (Math.abs(Number(c.amount) - Number(p.amount)) > 0.009) continue;
      const { ok, gapMinutes } = withinWindow(p.paid_at, c.created_at_paymob, MATCH_WINDOW_MINUTES);
      if (ok) pairs.push({ gapMinutes, p, c });
    }
  }
  pairs.sort((a, b) => a.gapMinutes - b.gapMinutes);

  const usedPayments = new Set();
  const usedCharges = new Set();
  for (const { gapMinutes, p, c } of pairs) {
    if (usedPayments.has(p.id) || usedCharges.has(c.id)) continue;

    const { error: upErr } = await supabaseAdmin
      .from("visit_payments")
      .update({
        payment_verification: "verified_paymob",
        paymob_transaction_id: c.id,
        paymob_terminal_id: c.terminal_id,
        paymob_card_brand: c.card_brand,
        paymob_card_last4: c.card_last4,
        paymob_fees: c.fees,
        paymob_match_gap_minutes: gapMinutes,
        paymob_matched_at: new Date().toISOString(),
      })
      .eq("id", p.id)
      .is("payment_verification", null); // never overwrite an existing verdict
    if (upErr) {
      report.errors.push(`verify ${p.id}: ${upErr.message}`);
      continue;
    }

    await supabaseAdmin
      .from("paymob_transactions")
      .update({
        matched_payment_id: p.id,
        matched_at: new Date().toISOString(),
        review_status: "matched",
      })
      .eq("id", c.id);

    usedPayments.add(p.id);
    usedCharges.add(c.id);
    report.verified++;
  }

  report.stillUnverified = live.length - report.verified;
  report.window = { since, launch: LAUNCH_DATE, terminal: SCAN_TERMINAL_ID, offsetHours: PAYMOB_TZ_OFFSET_HOURS };
  return report;
}

export async function GET(req) {
  // Vercel signs its own cron calls with CRON_SECRET. Staff can also run it by
  // hand, which is how it gets tested. With no secret configured the job fails
  // closed to staff-only rather than sitting open on a public path.
  const secret = process.env.CRON_SECRET;
  const auth = req.headers.get("authorization") || "";
  const fromCron = !!secret && auth === `Bearer ${secret}`;
  if (!fromCron) {
    const staff = await requireStaff(req);
    if (!staff) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const report = await run();
    return NextResponse.json({ ok: true, ...report });
  } catch (e) {
    return NextResponse.json({ ok: false, error: e.message }, { status: 500 });
  }
}

export async function POST(req) {
  return GET(req);
}
