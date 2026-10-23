-- Live dashboard (Mohamed Said, 23 Oct 2026): every table the dashboard tabs
-- read must broadcast changes, or a sale / payment / PO / return / clock-in
-- would not show until someone reloaded. Every signed-in user is staff and
-- these tables are already readable to them under RLS, so broadcasting adds
-- no new exposure. employees, staff_profiles and payroll stay out on purpose.
do $$
declare t text;
begin
  foreach t in array array['counter_sales','counter_sale_items','customer_ar_ledger','purchase_orders',
    'sale_returns','stock_change_requests','stock_batches','supplier_returns','cash_ledger',
    'timeclock_events','dental_order_items']
  loop
    if not exists (select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename=t) then
      execute format('alter publication supabase_realtime add table public.%I', t);
    end if;
  end loop;
end $$;
