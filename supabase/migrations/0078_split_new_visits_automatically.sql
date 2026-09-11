-- 0078: a visit created with several scans splits itself.
--
-- Both places that create a visit - registration and Add Scan - are fixed at
-- the source rather than in each form, so anything that writes a visit in
-- future inherits the rule instead of having to remember it.
--
-- It runs after the row is in, because split_visit reads the visit's payments
-- to divide them, and at BEFORE INSERT there are none yet. The statement-level
-- trigger sees the finished row with its payment attached.

create or replace function split_multi_scan_visit() returns trigger
language plpgsql as $$
begin
  if coalesce(array_length(new.scan_types, 1), 0) > 1 then
    perform split_visit(new.id, null, 'Split automatically on creation');
  end if;
  return null;
end;
$$;

drop trigger if exists trg_split_multi_scan_visit on visits;
create trigger trg_split_multi_scan_visit
  after insert on visits
  for each row
  when (coalesce(array_length(new.scan_types, 1), 0) > 1)
  execute function split_multi_scan_visit();
