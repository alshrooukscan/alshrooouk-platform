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

  const { data: visit } = await supabaseAdmin
    .from("visits")
    .select("id, patient_id, dicom_study_uid, dicom_worklist_status")
    .eq("id", id)
    .single();
  if (!visit) {
    return NextResponse.json({ error: "Visit not found." }, { status: 404 });
  }

  const { data: payments } = await supabaseAdmin
    .from("visit_payments")
    .select("amount, payment_method, paid_at, created_by_id")
    .eq("visit_id", id);

  // The cash entry for each payment is removed by a database trigger when the
  // payment itself is deleted, which happens automatically when the visit goes.
  //
  // This used to be done here by guessing - matching on amount, method, date
  // and who logged it - and doing nothing when more than one row matched. A
  // patient logged twice produced two identical entries, so the guess found
  // both, gave up, and the money stayed on the books after the duplicate visit
  // was removed. That is what left 480 EGP on the Scan cash screen.
  //
  // Payments now carry source_payment_id, so the reversal is exact rather than
  // inferred, and it applies to every path that removes a payment - including
  // deleting a whole patient - instead of only this one.
  // Any generated invoice is deleted along with the visit, per the same
  // instruction - it's part of the same mistake being cleaned up, not a
  // separate record left dangling.
  await supabaseAdmin.from("invoices").delete().eq("visit_id", id);

  // Unlink (not delete) any report tied to this visit, so a real report -
  // pending or completed, with a real uploaded file - survives independently
  // rather than being destroyed as a side effect of removing the visit.
  //
  // A report still pending with nothing uploaded is only a to-do created for
  // this visit. Kept and unlinked, it stayed on the Reports page as work
  // owed for a scan that no longer exists: two test deletions left two such
  // rows beside the real one. Those go with the visit; anything with a file,
  // or already completed, is still kept.
  const { error: repDelErr } = await supabaseAdmin
    .from("reports")
    .delete()
    .eq("visit_id", id)
    .neq("status", "completed")
    .is("report_file_url", null)
    .is("client_uploaded_file_url", null);
  if (repDelErr) return NextResponse.json({ error: `Could not remove the pending report: ${repDelErr.message}` }, { status: 500 });
  await supabaseAdmin.from("reports").update({ visit_id: null }).eq("visit_id", id);

  // The WhatsApp log is just a record of messages sent about this visit;
  // once the visit itself is gone, the log entries are meaningless on their
  // own and safe to remove.
  await supabaseAdmin.from("whatsapp_log").delete().eq("visit_id", id);

  // The DICOM gateway logs every visit it sends to the scanner's worklist, and
  // an unmatched study can be resolved onto a visit. Both point at the visit
  // with no ON DELETE rule, so since the gateway went live every visit that
  // reached the worklist refused to delete ("violates foreign key constraint
  // gateway_sync_log_visit_id_fkey"). The log rows are kept as history of what
  // the gateway did; they just stop pointing at a visit that no longer exists.
  const { error: gwErr } = await supabaseAdmin
    .from("gateway_sync_log")
    .update({ visit_id: null, detail: `Visit ${id} was deleted from the platform` })
    .eq("visit_id", id);
  if (gwErr) return NextResponse.json({ error: `Could not unlink the scanner log: ${gwErr.message}` }, { status: 500 });
  const { error: umErr } = await supabaseAdmin
    .from("unmatched_studies")
    .update({ resolved_visit_id: null })
    .eq("resolved_visit_id", id);
  if (umErr) return NextResponse.json({ error: `Could not unlink the unmatched scan: ${umErr.message}` }, { status: 500 });

  // If a worklist entry may already exist in Orthanc for this visit (pushed,
  // pending a resync, or awaiting the fix after a name/DOB edit), a deleted
  // visit used to leave it behind indefinitely - nothing told the gateway the
  // booking was gone, so the client's machine kept showing it until Orthanc's
  // own DeleteWorklistsOnStableStudy or DeleteWorklistsDelay eventually swept
  // it, up to 48h later. Logging a delete request here (matched by
  // dicom_study_uid, which every push already carries - no schema change
  // needed) lets worklist-deletions/route.js hand it to the gateway on its
  // next poll, same pull model as every other gateway queue.
  if (visit.dicom_study_uid && visit.dicom_worklist_status && visit.dicom_worklist_status !== "unmatched") {
    await supabaseAdmin.from("gateway_sync_log").insert({
      event_type: "worklist_delete_requested",
      dicom_study_uid: visit.dicom_study_uid,
      detail: `Visit ${id} was deleted from the platform`,
    });
  }

  // patient_files.visit_id is ON DELETE SET NULL and visit_edit_requests is
  // ON DELETE CASCADE at the database level already, so both are handled
  // automatically by this final delete, along with visit_payments cascading.
  const { error: delErr } = await supabaseAdmin.from("visits").delete().eq("id", id);
  if (delErr) {
    return NextResponse.json({ error: delErr.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
