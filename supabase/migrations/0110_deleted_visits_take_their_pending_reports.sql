-- 0110: a deleted visit takes its unfinished report with it.
--
-- Deleting a visit unlinked every report it had, so a finished radiology
-- report with a real file is never lost. But a report still pending with
-- nothing uploaded is only a to-do the visit created, and kept it stayed on
-- the Reports page as work owed for a scan that no longer exists. Deleting a
-- test visit twice left two of them beside the real one.
--
-- The visit-delete route was fixed in code. Deleting a whole patient goes
-- through delete_patient_cascade, which had the same gap, and would also
-- fail outright for any patient whose visit reached the scanner: the DICOM
-- gateway's log and unmatched-study tables point at the visit with no
-- ON DELETE rule. Those links now clear themselves, and the log rows stay.

alter table gateway_sync_log drop constraint if exists gateway_sync_log_visit_id_fkey;
alter table gateway_sync_log add constraint gateway_sync_log_visit_id_fkey
  foreign key (visit_id) references visits(id) on delete set null;
alter table unmatched_studies drop constraint if exists unmatched_studies_resolved_visit_id_fkey;
alter table unmatched_studies add constraint unmatched_studies_resolved_visit_id_fkey
  foreign key (resolved_visit_id) references visits(id) on delete set null;

create or replace function delete_patient_cascade(p_patient_id uuid) returns void
language plpgsql security definer as $$
declare v_visit uuid;
begin
  for v_visit in select id from visits where patient_id = p_patient_id loop
    delete from invoices where visit_id = v_visit;
    delete from whatsapp_log where visit_id = v_visit;
    -- An unfinished report with nothing uploaded goes with its visit; one
    -- with a file, or completed, is kept and unlinked so it is never lost.
    delete from reports
     where visit_id = v_visit and status <> 'completed'
       and report_file_url is null and client_uploaded_file_url is null;
    update reports set visit_id = null where visit_id = v_visit;
    delete from visits where id = v_visit;
  end loop;
  update reports set patient_id = null where patient_id = p_patient_id;
  delete from patients where id = p_patient_id;
end $$;

-- The reports left behind by visits already deleted: internal, pending,
-- nothing uploaded, no visit. Checked to be exactly the two test rows on
-- 28 Sep 2026 before removing anything.
do $$
declare n int;
begin
  select count(*) into n from reports
   where source_type = 'internal' and visit_id is null and status <> 'completed'
     and report_file_url is null and client_uploaded_file_url is null;
  if n <> 2 then raise exception 'Expected 2 orphaned pending reports, found %; nothing applied.', n; end if;
  delete from reports
   where source_type = 'internal' and visit_id is null and status <> 'completed'
     and report_file_url is null and client_uploaded_file_url is null;
end $$;

select 'APPLIED' as result,
  (select count(*) from reports where patient_id = '906b3dc3-85ed-4108-8194-6dffb4d56139') as moamen_reports_left;
