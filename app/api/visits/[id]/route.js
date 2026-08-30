import { NextResponse } from "next/server";
import { supabaseAdmin } from "../../../../lib/supabaseAdmin";

// Deleting a visit is admin-only and blocked outright if the visit has any
// logged payment or a generated invoice. This isn't overcaution: cash
// payments already get auto-wired into the expense ledger the moment
// they're logged (sync_visit_payment_to_expenses), and that ledger entry
// has no column linking it back to the visit or payment that created it -
// there is no safe way to find and reverse it if the visit disappears out
// from under it. An employee would keep showing as holding cash for a scan
// that no longer exists in the system, with nothing left to reconcile it
// against. A visit with real money already collected against it needs a
// different resolution than deletion.
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

  const [{ data: payments }, { data: invoice }] = await Promise.all([
    supabaseAdmin.from("visit_payments").select("id").eq("visit_id", id).limit(1),
    supabaseAdmin.from("invoices").select("id").eq("visit_id", id).limit(1).maybeSingle(),
  ]);
  if (payments && payments.length > 0) {
    return NextResponse.json({ error: "This visit has a logged payment and can't be deleted, since that payment is already reflected in the cash ledger. Use the visit edit request flow instead if it needs correcting." }, { status: 409 });
  }
  if (invoice) {
    return NextResponse.json({ error: "This visit has a generated invoice and can't be deleted." }, { status: 409 });
  }

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
  // automatically by this final delete.
  const { error: delErr } = await supabaseAdmin.from("visits").delete().eq("id", id);
  if (delErr) {
    return NextResponse.json({ error: delErr.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
