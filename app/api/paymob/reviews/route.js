import { NextResponse } from "next/server";
import { requireStaff } from "../../../../lib/requireStaff";
import { supabaseAdmin } from "../../../../lib/supabaseAdmin";

export const dynamic = "force-dynamic";

/**
 * Card payments the Paymob check could not account for.
 *
 * These are questions for a person. The platform has already said what it
 * knows - there is no charge on the scan terminal matching this payment - and
 * an admin decides what that means: the money really did arrive (a card on
 * another machine, a charge Paymob never published) or the method was recorded
 * wrongly and the visit needs correcting.
 *
 * Approving does NOT invent a Paymob charge. It records that an admin vouched
 * for the payment, with their name against it, which is a different and weaker
 * claim than a gateway-verified one - and is stored as such.
 */
export async function GET(req) {
  const staff = await requireStaff(req);
  if (!staff) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { searchParams } = new URL(req.url);
  const status = searchParams.get("status") || "pending";

  const { data, error } = await supabaseAdmin
    .from("paymob_verification_reviews")
    .select("*")
    .eq("status", status)
    .order("paid_at", { ascending: false })
    .limit(100);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ reviews: data || [] });
}

export async function POST(req) {
  const staff = await requireStaff(req);
  if (!staff) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (staff.role !== "admin" && staff.role !== "owner") {
    return NextResponse.json({ error: "Admins only" }, { status: 403 });
  }

  const { reviewId, action, note } = await req.json().catch(() => ({}));
  if (!reviewId || !["approve", "reject"].includes(action)) {
    return NextResponse.json({ error: "reviewId and action (approve|reject) required" }, { status: 400 });
  }

  const { data: review, error: findErr } = await supabaseAdmin
    .from("paymob_verification_reviews")
    .select("*")
    .eq("id", reviewId)
    .eq("status", "pending")
    .maybeSingle();
  if (findErr) return NextResponse.json({ error: findErr.message }, { status: 500 });
  if (!review) return NextResponse.json({ error: "Not found, or already decided" }, { status: 404 });

  const decision = {
    status: action === "approve" ? "approved" : "rejected",
    decided_by_id: staff.id,
    decided_by_name: staff.name || staff.email,
    decided_at: new Date().toISOString(),
    decision_note: note || null,
  };

  const { error: updErr } = await supabaseAdmin
    .from("paymob_verification_reviews")
    .update(decision)
    .eq("id", reviewId);
  if (updErr) return NextResponse.json({ error: updErr.message }, { status: 500 });

  if (action === "approve") {
    // Marked as vouched for by a person, not proven by the gateway. The two
    // are kept apart everywhere so a hand-approved payment is never counted as
    // gateway-verified money.
    await supabaseAdmin
      .from("visit_payments")
      .update({
        payment_verification: "approved_by_admin",
        paymob_matched_at: new Date().toISOString(),
      })
      .eq("id", review.payment_id)
      .is("payment_verification", null);
  }
  // A rejection deliberately changes nothing about the payment. Correcting a
  // method moves money between a person's cash and the card total, so it goes
  // through the existing Correct method flow on the visit, which records who
  // changed it and why.

  return NextResponse.json({ ok: true, status: decision.status });
}
