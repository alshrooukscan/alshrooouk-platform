-- Phase 3: Stock Management — RLS policies + atomic transaction/count functions

do $$
declare t text;
begin
  for t in select unnest(array['stock_items','stock_transactions','stock_counts'])
  loop
    execute format('drop policy if exists staff_all on public.%I;', t);
    execute format('create policy staff_all on public.%I for all to authenticated using (true) with check (true);', t);
  end loop;
end $$;

create or replace function record_stock_transaction(p_item_id uuid, p_type text, p_qty numeric, p_unit_price numeric)
returns stock_items as $$
declare
  result stock_items;
begin
  insert into stock_transactions (item_id, type, qty, unit_price, total)
  values (p_item_id, p_type, p_qty, p_unit_price, p_qty * p_unit_price);

  if p_type = 'purchase' then
    update stock_items set qty_remaining = coalesce(qty_remaining,0) + p_qty, purchase_price = p_unit_price
    where id = p_item_id;
  elsif p_type = 'sale' then
    update stock_items set qty_remaining = coalesce(qty_remaining,0) - p_qty, sale_price = p_unit_price
    where id = p_item_id;
  end if;

  select * into result from stock_items where id = p_item_id;
  return result;
end;
$$ language plpgsql security definer;

grant execute on function record_stock_transaction(uuid, text, numeric, numeric) to authenticated;

create or replace function record_stock_count(p_item_id uuid, p_physical_qty numeric)
returns stock_counts as $$
declare
  result stock_counts;
  expected numeric;
begin
  select qty_remaining into expected from stock_items where id = p_item_id;
  insert into stock_counts (item_id, physical_qty, expected_qty, variance)
  values (p_item_id, p_physical_qty, expected, p_physical_qty - expected)
  returning * into result;
  return result;
end;
$$ language plpgsql security definer;

grant execute on function record_stock_count(uuid, numeric) to authenticated;
