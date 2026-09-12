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

// One swipe often pays for several visits at once - a parent bringing two
// children, a doctor settling three scans together. Those payments are logged
// as separate rows in the same minute and no single row will ever equal the
// charge, so they are matched as a set whose total is exact.
const GROUP_WINDOW_MINUTES = 30;
const GROUP_MAX_PAYMENTS = 4;

// A payment is sometimes written up the next day, long after the card cleared.
// Those are still real, but a wide window makes coincidences likely, so a late
// match is only accepted when the amount is UNIQUE among the unclaimed charges
// in range - if two charges could explain it, neither is chosen.
const LATE_ENTRY_HOURS = 36;

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

// Smallest set of payments from `group` whose amounts total `target` exactly.
// Kept small on purpose: beyond four payments the number of combinations that
// happen to add up makes a coincidence more likely than a real shared swipe.
function exactSubset(group, target) {
  const n = Math.min(group.length, GROUP_MAX_PAYMENTS);
  for (let size = 2; size <= n; size++) {
    const found = combinations(group, size).find(
      (set) => Math.abs(set.reduce((t, p) => t + Number(p.amount), 0) - target) < 0.009
    );
    if (found) return found;
  }
  return null;
}

function combinations(items, size, start = 0, current = [], out = []) {
  if (current.length === size) { out.push([...current]); return out; }
  for (let i = start; i < items.length; i++) {
    current.push(items[i]);
    combinations(items, size, i + 1, current, out);
    current.pop();
  }
  return out;
}


// Writes the proof onto a payment and claims the charge. Guarded on
// payment_verification still being null so a second run, or two passes racing
// over the same payment, can never overwrite an existing verdict.
async function applyMatch(payment, charge, gapMinutes, verification, shareOf) {
  const { error } = await supabaseAdmin
    .from("visit_payments")
    .update({
      payment_verification: verification,
      paymob_transaction_id: shareOf ? null : charge.id, // a shared charge cannot be the unique key on several rows
      paymob_shared_charge_id: shareOf ? charge.id : null,
      paymob_terminal_id: charge.terminal_id,
      paymob_card_brand: charge.card_brand,
      paymob_card_last4: charge.card_last4,
      paymob_fees: shareOf ? null : charge.fees,
      paymob_match_gap_minutes: gapMinutes,
      paymob_matched_at: new Date().toISOString(),
    })
    .eq("id", payment.id)
    .is("payment_verification", null);
  if (error) return false;

  await supabaseAdmin
    .from("paymob_transactions")
    .update({ matched_payment_id: shareOf ? null : payment.id, matched_at: new Date().toISOString(), review_status: "matched" })
    .eq("id", charge.id);
  return true;
}

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

  // Pass 2 and 3 run after the clean one-to-one matches below have taken what
  // they are entitled to, so a looser rule can never steal a charge from an
  // exact match. Both are collected here and applied in the same loop.
  const extraPairs = [];

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

  // ---- Pass 2: one swipe, several visits ----------------------------------
  // Payments logged together whose total is exactly one charge. This is the
  // only rule that adds amounts rather than matching one-to-one, so the
  // payments are tagged as a shared swipe and are never mistaken later for a
  // clean single match.
  const leftoverPayments = live.filter((p) => !usedPayments.has(p.id));
  const leftoverCharges = (charges || []).filter((c) => !usedCharges.has(c.id));

  const byMinute = new Map();
  for (const p of leftoverPayments) {
    const key = String(p.paid_at).slice(0, 16); // same minute at the counter
    if (!byMinute.has(key)) byMinute.set(key, []);
    byMinute.get(key).push(p);
  }

  for (const group of byMinute.values()) {
    if (group.length < 2) continue;
    for (const c of leftoverCharges) {
      if (usedCharges.has(c.id)) continue;
      const { ok, gapMinutes } = withinWindow(group[0].paid_at, c.created_at_paymob, GROUP_WINDOW_MINUTES);
      if (!ok) continue;

      const subset = exactSubset(group.filter((p) => !usedPayments.has(p.id)), Number(c.amount));
      if (!subset) continue;

      for (const p of subset) {
        extraPairs.push({ p, c, gapMinutes, kind: "group", shareOf: subset.length });
        usedPayments.add(p.id);
      }
      usedCharges.add(c.id);
      break;
    }
  }

  // ---- Pass 3: written up late --------------------------------------------
  // Accepted only when exactly one unclaimed charge in range carries that
  // amount. Two candidates means we cannot tell which one the patient paid,
  // and a wrong link is worse than an unverified payment.
  for (const p of live) {
    if (usedPayments.has(p.id)) continue;
    const candidates = (charges || []).filter((c) => {
      if (usedCharges.has(c.id)) return false;
      if (Math.abs(Number(c.amount) - Number(p.amount)) > 0.009) return false;
      return withinWindow(p.paid_at, c.created_at_paymob, LATE_ENTRY_HOURS * 60).ok;
    });
    if (candidates.length !== 1) continue;
    const c = candidates[0];
    const { gapMinutes } = withinWindow(p.paid_at, c.created_at_paymob, LATE_ENTRY_HOURS * 60);
    extraPairs.push({ p, c, gapMinutes, kind: "late" });
    usedPayments.add(p.id);
    usedCharges.add(c.id);
  }

  for (const { p, c, gapMinutes, kind, shareOf } of extraPairs) {
    const ok = await applyMatch(p, c, gapMinutes, kind === "group" ? "verified_paymob_group" : "verified_paymob_late", shareOf);
    if (ok) {
      report.verified++;
      report[kind === "group" ? "groupMatches" : "lateMatches"] = (report[kind === "group" ? "groupMatches" : "lateMatches"] || 0) + 1;
    } else {
      report.errors.push(`verify ${p.id}: apply failed`);
    }
  }

  // ---- Anything still unproven goes to the admin -------------------------
  // A card payment the gateway cannot account for is a question for a person,
  // not something to decide automatically. It keeps its method and waits in
  // the Action Center. Payments taken in the last few minutes are skipped -
  // Paymob simply has not published them yet, and raising those would bury
  // the real cases in noise.
  const stillOpen = live.filter((p) => !usedPayments.has(p.id));
  const settleMinutes = 60;
  const ripe = stillOpen.filter(
    (p) => Date.now() - new Date(p.paid_at).getTime() > settleMinutes * 60 * 1000
  );

  if (ripe.length) {
    const { error: revErr } = await supabaseAdmin.from("paymob_verification_reviews").upsert(
      ripe.map((p) => ({
        payment_id: p.id,
        visit_id: p.visit_id,
        amount: p.amount,
        payment_method: p.payment_method,
        paid_at: p.paid_at,
        reason: "No matching Paymob charge found on the scan terminal",
        status: "pending",
      })),
      { onConflict: "payment_id", ignoreDuplicates: true } // never reopen one an admin already decided
    );
    if (revErr) report.errors.push(`review queue: ${revErr.message}`);
    else report.sentToActionCenter = ripe.length;
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
