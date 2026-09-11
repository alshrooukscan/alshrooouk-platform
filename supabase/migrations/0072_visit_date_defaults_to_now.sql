-- 0072: a visit saved without a date takes the moment it was created.
--
-- Leaving the date and time blank on Add Scan sent an explicit null, which
-- overrides the column's own CURRENT_DATE default - a default only applies
-- when the column is left out entirely. The visit saved as "No date recorded".
--
-- The form is fixed to send the current date and time in the clinic's own
-- clock. This is the guard behind it: the database refuses to hold a visit
-- with no date at all, whichever path writes it, and falls back to the moment
-- of creation rather than rejecting the save. Losing a scan at the counter
-- because a field was blank would be the worse outcome.
--
-- One visit is repaired: Yomna Mosa's 3D CBCT Quadrant, created 10 September
-- 17:35 UTC, which is 20:35 in Cairo.

create or replace function visit_date_defaults_to_now() returns trigger
language plpgsql as $$
begin
  if new.exam_date is null then
    new.exam_date := (coalesce(new.created_at, now()) at time zone 'Africa/Cairo')::date;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_visit_date_defaults_to_now on visits;
create trigger trg_visit_date_defaults_to_now
  before insert or update of exam_date on visits
  for each row execute function visit_date_defaults_to_now();

update visits
   set exam_date = (created_at at time zone 'Africa/Cairo')::date,
       exam_time = (created_at at time zone 'Africa/Cairo')::time
 where exam_date is null;
