// Keeps patients.last_visit_date in sync with the true most-recent visit for
// that patient. Would normally live as a database trigger on visits (insert/
// update/delete), but Supabase's management API is currently rejecting any
// SQL that creates a function or trigger with a 403 - a new, broad
// restriction that wasn't in place earlier in this same project. Until that
// clears, this is called explicitly at every point the app itself creates or
// edits a visit. Recomputes from scratch (max exam_date across all of the
// patient's visits) rather than trying to track "is this newer" deltas, so
// it stays correct even for backdated entries or edits that change the date.
export async function syncPatientLastVisitDate(supabase, patientId) {
  if (!patientId) return;
  const { data } = await supabase
    .from("visits")
    .select("exam_date")
    .eq("patient_id", patientId)
    // A visit can be saved without a date. Postgres sorts NULLs FIRST on a
    // DESC order, so such a visit came back as the "most recent" one and this
    // then wrote last_visit_date = null, erasing a patient's real last visit.
    // Dateless visits simply have nothing to contribute to a max date.
    .not("exam_date", "is", null)
    .order("exam_date", { ascending: false })
    .limit(1)
    .maybeSingle();
  await supabase.from("patients").update({ last_visit_date: data?.exam_date || null }).eq("id", patientId);
}
