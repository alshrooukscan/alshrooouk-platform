-- 0066: raise the reports that were never created, and retire the ones that
-- should never have been.
--
-- MISSING (backfilled here). 11 visits entered in the platform need a report
-- and have no report row, so they are absent from the queue and nobody knows
-- they are outstanding. Nine were saved without a branch and were dropped by
-- the silent skip fixed in 0065; the rest predate the auto-create trigger.
-- Each is dated to its own exam_date, so the queue shows how long it has
-- really been waiting rather than pretending it arrived today.
--
-- Deliberately NOT backfilled: 2,140 visits that came across in the 29 August
-- import also have no report row. Their reports were written years ago, on
-- paper and outside this system. Raising them would put 2,140 false items in
-- front of the radiologists and bury the eleven that are real. The import
-- boundary is the visit's created_at, not its exam_date - imported visits
-- carry exam dates going back years but were all written in one run.
--
-- SPURIOUS (cleared here). Pending reports for scans that do not require one -
-- Panoramic Child Full Arch and Ceph Image. Both had requires_report switched
-- on until early September, and the rows raised under that setting stayed
-- behind after it was turned off. A report naming several scans is kept if any
-- one of them requires a report.
--
-- Completed reports are left exactly as they are. They represent work a
-- radiologist actually did, whatever the flag said at the time.

create table if not exists reports_removed_backup_0066 as
  select r.*, now() as removed_at from reports r where false;

with spurious as (
  select r.id from reports r
  where r.status = 'pending'
    and not exists (
      select 1 from exam_types et
      where et.requires_report = true
        -- scan_name may list several scans, comma separated
        and (r.scan_name = et.name or r.scan_name like et.name || ',%'
             or r.scan_name like '%, ' || et.name or r.scan_name like '%, ' || et.name || ',%')
    )
)
insert into reports_removed_backup_0066
select r.*, now() from reports r join spurious s on s.id = r.id;

delete from reports r using reports_removed_backup_0066 b where r.id = b.id;

insert into reports (source_type, client_id, patient_id, visit_id, scan_name, date_required, status)
select 'internal',
       coalesce(
         (select c.id from clients c where c.branch_id = v.branch_id and c.is_pseudo limit 1),
         (select c.id from clients c where c.name = 'Unassigned Branch' and c.is_pseudo limit 1)),
       v.patient_id, v.id,
       (select string_agg(distinct et.name, ', ')
          from exam_types et
         where et.name = any(v.scan_types) and et.requires_report = true),
       coalesce(v.exam_date, current_date),
       'pending'
from visits v
where v.created_at > timestamptz '2026-08-29 10:23:18+00'
  and exists (select 1 from exam_types et where et.name = any(v.scan_types) and et.requires_report = true)
  and not exists (select 1 from reports r where r.visit_id = v.id);
