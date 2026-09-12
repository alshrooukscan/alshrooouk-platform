import { NextResponse } from "next/server";
import { requireStaff } from "../../../../lib/requireStaff";
import { supabaseAdmin } from "../../../../lib/supabaseAdmin";
import { SCAN_TERMINAL_ID } from "../../../../lib/paymob";

export const dynamic = "force-dynamic";

const LAUNCH_DATE = "2026-08-29";

/**
 * Everything the reconciliation screen needs, in one call:
 *
 *  - totals, so the clinic can see how much of its card money is proven
 *  - payments marked as card but with no charge behind them
 *  - charges on the scan terminal that no payment has claimed
 *
 * That second list is the one that matters most day to day: a charge with no
 * payment usually means the money was taken on the card machine but written
 * down as cash, which quietly inflates whoever is holding the cash.
 */
export async function GET(req) {
  const staff = await requireStaff(req);
  if (!staff) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const [totals, unverified, orphans, latest] = await Promise.all([
    supabaseAdmin.rpc("paymob_reconciliation_totals"),

    // Card payments the platform could not prove. They keep the method the
    // staff chose - an unproven Visa payment is not a cash payment, and
    // turning it into one would invent cash that nobody is holding.
    supabaseAdmin
      .from("visit_payments")
      .select("id, visit_id, amount, payment_method, paid_at, created_by_name")
      .in("payment_method", ["Visa", "Wallet"])
      .is("payment_verification", null)
      .gte("paid_at", `${LAUNCH_DATE}T00:00:00Z`)
      .order("paid_at", { ascending: false })
      .limit(100),

    // Unclaimed charges on the scan terminal.
    supabaseAdmin
      .from("paymob_transactions")
      .select("id, amount, fees, net_amount, card_brand, card_last4, created_at_paymob, review_status, is_settled")
      .eq("terminal_id", SCAN_TERMINAL_ID)
      .eq("success", true)
      .eq("is_voided", false)
      .is("matched_payment_id", null)
      .gte("created_at_paymob", `${LAUNCH_DATE}T00:00:00`)
      .order("created_at_paymob", { ascending: false })
      .limit(100),

    supabaseAdmin
      .from("paymob_transactions")
      .select("created_at_paymob, synced_at")
      .order("created_at_paymob", { ascending: false })
      .limit(1)
      .maybeSingle(),
  ]);

  return NextResponse.json({
    terminal: SCAN_TERMINAL_ID,
    launchDate: LAUNCH_DATE,
    totals: totals.data || null,
    totalsError: totals.error?.message || null,
    unverifiedPayments: unverified.data || [],
    unclaimedCharges: orphans.data || [],
    lastCharge: latest.data?.created_at_paymob || null,
    lastSync: latest.data?.synced_at || null,
  });
}

/**
 * Dismisses an unclaimed charge, with a note. Nothing financial moves: the
 * charge stays in the mirror exactly as Paymob reported it. This only records
 * that a human looked at it and decided it needs no action, so tomorrow's
 * queue is the work that is actually left.
 *
 * Attaching a charge to the right visit is deliberately not done here. That
 * changes what the patient is recorded as having paid, and it belongs in the
 * existing "Correct method" flow on the visit, which already writes an audit
 * row and moves the cash ledger properly.
 */
export async function POST(req) {
  const staff = await requireStaff(req);
  if (!staff) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (staff.role !== "admin" && staff.role !== "owner") {
    return NextResponse.json({ error: "Admins only" }, { status: 403 });
  }

  const body = await req.json().catch(() => ({}));
  const { transactionId, note } = body;
  if (!transactionId) return NextResponse.json({ error: "transactionId required" }, { status: 400 });

  const { error } = await supabaseAdmin
    .from("paymob_transactions")
    .update({
      review_status: "dismissed",
      raw: { dismissed_by: staff.name || staff.email, dismissed_at: new Date().toISOString(), note: note || null },
    })
    .eq("id", transactionId)
    .is("matched_payment_id", null);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
