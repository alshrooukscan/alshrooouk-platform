create or replace function get_pl_summary()
returns table(source_stream text, direction text, total numeric) as $$
  select source_stream, direction, sum(amount) as total
  from cash_ledger
  group by source_stream, direction;
$$ language sql stable;

grant execute on function get_pl_summary() to authenticated;
