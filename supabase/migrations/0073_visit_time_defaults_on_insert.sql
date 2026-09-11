-- 0073: the same guard for the time, on insert only.
--
-- 0072 caught the date but left the time null, so a new visit still read as
-- date-only. A new visit always happens at a known moment, so it gets one.
--
-- Insert only, deliberately. Around 759 migrated visits have no time because
-- the paper form never carried one, and formatVisitDateTime shows those as a
-- date alone rather than inventing a midnight appointment. Backfilling them
-- from created_at would stamp every one with the minute of the import.

create or replace function visit_date_defaults_to_now() returns trigger
language plpgsql as $$
begin
  if new.exam_date is null then
    new.exam_date := (coalesce(new.created_at, now()) at time zone 'Africa/Cairo')::date;
  end if;

  if TG_OP = 'INSERT' and new.exam_time is null then
    new.exam_time := (coalesce(new.created_at, now()) at time zone 'Africa/Cairo')::time;
  end if;

  return new;
end;
$$;

drop trigger if exists trg_visit_date_defaults_to_now on visits;
create trigger trg_visit_date_defaults_to_now
  before insert or update of exam_date on visits
  for each row execute function visit_date_defaults_to_now();
