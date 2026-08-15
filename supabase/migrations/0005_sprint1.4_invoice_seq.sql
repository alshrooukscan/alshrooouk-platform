create sequence if not exists invoice_seq start 1;

create or replace function generate_invoice_number() returns text as $$
  select 'INV-' || to_char(current_date, 'YYYY') || '-' || lpad(nextval('invoice_seq')::text, 5, '0');
$$ language sql volatile;

grant usage, select on sequence invoice_seq to authenticated;
grant execute on function generate_invoice_number() to authenticated;
