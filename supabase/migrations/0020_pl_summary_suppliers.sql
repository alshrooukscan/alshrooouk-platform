-- Include real supplier payments (actual cash leaving the business) in the P&L summary.
-- Purchase entries in purchase_orders represent debt/payable (goods received on credit),
-- not cash movement, so only payment entries belong in a cash-basis Cash Out figure.

create or replace function get_pl_summary()
returns table(source_stream text, direction text, total numeric) as $$
  select source_stream, direction, sum(amount) as total
  from cash_ledger
  group by source_stream, direction
  union all
  select 'suppliers', 'out', abs(sum(amount))
  from purchase_orders
  where entry_type = 'payment';
$$ language sql stable;

grant execute on function get_pl_summary() to authenticated;
