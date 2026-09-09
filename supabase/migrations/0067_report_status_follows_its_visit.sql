-- 0067: a report must never sit in the queue for work that is already done.
--
-- My own backfill in 0066 caused this. It raised every missing report as
-- 'pending' without reading the visit it belonged to, so seven visits already
-- marked Report Done - with the report file uploaded and visible on the
-- patient page - reappeared in the radiologists' queue as outstanding work.
-- sync_report_from_visit only fires when report_done CHANGES on a visit, so
-- it could not correct a report row inserted afterwards.
--
-- Three parts:
--
-- 1. The seven are completed, timed from the visit's own report_done_at rather
--    than now, so the record shows when the work was really finished.
--
-- 2. Two pending reports point at a visit that no longer exists.
--    delete_patient_cascade nulls reports.visit_id rather than removing the
--    row, which preserves history but leaves a queue item nobody can action:
--    there is no visit to report on. They are retired to the same backup table
--    as the spurious rows.
--
-- 3. A report row now takes its status from its visit at the moment it is
--    inserted. This is the part that matters: any future backfill, import or
--    new code path inherits the visit's true state instead of assuming
--    pending, so this cannot happen again by the same route.

create or replace function report_inherits_visit_state() returns trigger
language plpgsql as $$
declare
  v_done boolean;
  v_done_at timestamptz;
begin
  if new.visit_id is null then return new; end if;

  select report_done, report_done_at into v_done, v_done_at
  from visits where id = new.visit_id;

  if coalesce(v_done, false) then
    new.status := 'completed';
    new.completed_at := coalesce(new.completed_at, v_done_at, now());
  end if;

  return new;
end;
$$;

drop trigger if exists trg_report_inherits_visit_state on reports;
create trigger trg_report_inherits_visit_state
  before insert on reports
  for each row execute function report_inherits_visit_state();

-- 1. already done, wrongly queued
update reports r
   set status = 'completed',
       completed_at = coalesce(r.completed_at, v.report_done_at, now())
  from visits v
 where v.id = r.visit_id
   and r.status = 'pending'
   and v.report_done = true;

-- 2. queued against a visit that no longer exists
insert into reports_removed_backup_0066
select r.*, now() from reports r
where r.status = 'pending' and r.visit_id is null;

delete from reports r
 where r.status = 'pending' and r.visit_id is null;
