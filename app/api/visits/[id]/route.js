import { NextResponse } from "next/server";
import { supabaseAdmin } from "../../../../lib/supabaseAdmin";

// Deleting a visit is admin-only. Explicitly allowed even when the visit has
// a logged payment or a generated invoice, per direct instruction: a visit
// (payment included) can be a genuine mistake, and admin confirming the
// delete is enough authority to remove all of it, not just the visit row.
//
// The one real risk this creates - a cash-ledger entry (expense_transactions)
// left behind with no link back to the visit or payment that produced it -
// is handled by best-effort matching, not by refusing to delete. Before the
// visit (and its payments, which cascade) are removed, this looks for the
// specific confirmed 'visit_collection' entry that matches a payment's exact
// amount, method, entry date, and the employee who logged it. Only deletes
// it when that match is unique; if more than one candidate fits (e.g. the
// same employee logged two identical-amount payments the same day), none of
// them are touched, since guessing wrong is worse than leaving one behind
// for manual reconciliation.
export async function DELETE(req, { params }) {
  const { id } = params;
  const authHeader = req.headers.get("authorization") || "";
  const token = authHeader.replace("Bearer ", "");
  const { data: userData, error: authErr } = await supabaseAdmin.auth.getUser(token);
  if (authErr || !userData?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { data: profile } = await supabaseAdmin.from("staff_profiles").select("role, is_active").eq("id", userData.user.id).single();
  if (!profile || profile.role !== "admin" || !profile.is_active) {
    return NextResponse.json({ error: "Only admins can delete a visit." }, { status: 403 });
  }

  const { data: visit } = await supabaseAdmin.from("visits").select("id, patient_id").eq("id", id).single();
  if (!visit) {
    return NextResponse.json({ error: "Visit not found." }, { status: 404 });
  }

  const { data: payments } = await supabaseAdmin
    .from("visit_payments")
    .select("amount, payment_method, paid_at, created_by_id")
    .eq("visit_id", id);

  let expenseEntriesRemoved = 0;
  let expenseEntriesLeftForReview = 0;
  for (const payment of payments || []) {
    let method = (payment.payment_method || "").toLowerCase().replace(/\s+/g, "_");
    // "wallet" is canonical; vodafone_cash is the retired name for the same
    // method and is folded in so older rows still match.
    if (method === "vodafone_cash") method = "wallet";
    if (!["cash", "visa", "instapay", "wallet"].includes(method)) method = "cash";
    const entryDate = payment.paid_at ? new Date(payment.paid_at).toISOString().slice(0, 10) : null;

    let q = supabaseAdmin
      .from("expense_transactions")
      .select("id")
      .eq("type", "visit_collection")
      .eq("brand", "scan")
      .eq("amount", payment.amount)
      .eq("payment_method", method)
      .eq("note", "Auto-logged from a visit payment");
    if (entryDate) q = q.eq("entry_date", entryDate);
    if (payment.created_by_id) q = q.eq("created_by_id", payment.created_by_id);
    const { data: candidates } = await q;

    if (candidates && candidates.length === 1) {
      await supabaseAdmin.from("expense_transactions").delete().eq("id", candidates[0].id);
      expenseEntriesRemoved++;
    } else if (candidates && candidates.length > 1) {
      expenseEntriesLeftForReview++;
    }
  }

  // Any generated invoice is deleted along with the visit, per the same
  // instruction - it's part of the same mistake being cleaned up, not a
  // separate record left dangling.
  await supabaseAdmin.from("invoices").delete().eq("visit_id", id);

  // Unlink (not delete) any report tied to this visit, so a real report -
  // pending or completed, with a real uploaded file - survives independently
  // rather than being destroyed as a side effect of removing the visit.
  await supabaseAdmin.from("reports").update({ visit_id: null }).eq("visit_id", id);

  // The WhatsApp log is just a record of messages sent about this visit;
  // once the visit itself is gone, the log entries are meaningless on their
  // own and safe to remove.
  await supabaseAdmin.from("whatsapp_log").delete().eq("visit_id", id);

  // patient_files.visit_id is ON DELETE SET NULL and visit_edit_requests is
  // ON DELETE CASCADE at the database level already, so both are handled
  // automatically by this final delete, along with visit_payments cascading.
  const { error: delErr } = await supabaseAdmin.from("visits").delete().eq("id", id);
  if (delErr) {
    return NextResponse.json({ error: delErr.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true, expenseEntriesRemoved, expenseEntriesLeftForReview });
}
