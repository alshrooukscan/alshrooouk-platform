-- Staff save a visit, the screen sits on "Saving..." for up to two minutes,
-- they assume it failed and press again - and the patient ends up with the
-- same scan recorded twice. Three of those happened in the last ten days, two
-- of them roughly two and a half minutes apart, one after only seven seconds.
--
-- The button is already disabled while saving, so this is not a double-click
-- in the same instant: the first save had returned, or the page was stuck
-- waiting on something that never came back. Guarding in the form only helps
-- the form. This sits on the table, so it protects every route in and does not
-- depend on the browser behaving.
--
-- Deliberately time-boxed rather than a unique constraint. A patient really can
-- have the same scan twice - a retake after a bad image - just not within two
-- minutes of the first one. A hard constraint would block legitimate work; this
-- only blocks the window in which a resubmit is an accident.
create or replace function public.block_duplicate_visit_submit()
returns trigger language plpgsql as $$
declare
  v_recent record;
begin
  select v.id, v.created_at into v_recent
  from visits v
  where v.patient_id = new.patient_id
    and v.exam_date is not distinct from new.exam_date
    and v.scan_types is not distinct from new.scan_types
    and coalesce(v.amount_due, -1) = coalesce(new.amount_due, -1)
    and v.created_at > now() - interval '2 minutes'
  limit 1;

  if v_recent.id is not null then
    raise exception
      'This exact visit was already saved % second(s) ago and is on the patient''s record. Refresh the page before adding it again - if the scan really is being repeated, wait a moment and retry.',
      greatest(round(extract(epoch from (now() - v_recent.created_at)))::int, 1)
      using errcode = 'unique_violation';
  end if;

  return new;
end;
$$;

drop trigger if exists trg_block_duplicate_visit_submit on visits;
create trigger trg_block_duplicate_visit_submit
  before insert on visits
  for each row execute function block_duplicate_visit_submit();
