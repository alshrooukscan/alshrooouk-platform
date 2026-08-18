alter table purchase_orders add column if not exists po_number integer;

create sequence if not exists po_number_seq start 1;

create or replace function next_po_number() returns integer as $$
  select nextval('po_number_seq')::integer;
$$ language sql volatile;

grant execute on function next_po_number() to authenticated;
grant usage, select on sequence po_number_seq to authenticated;
