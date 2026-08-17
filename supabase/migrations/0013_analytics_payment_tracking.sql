-- Stock: track paid vs pending on both sales (customer credit) and purchases (supplier credit)
alter table stock_transactions add column if not exists amount_paid numeric(10,2) default 0;
alter table stock_transactions add column if not exists payment_status text default 'paid' check (payment_status in ('paid','partial','pending'));

create or replace function record_stock_transaction(
  p_item_id uuid, p_type text, p_qty numeric, p_unit_price numeric,
  p_amount_paid numeric default null, p_payment_status text default 'paid'
)
returns stock_items as $$
declare
  result stock_items;
  v_total numeric;
  v_paid numeric;
begin
  v_total := p_qty * p_unit_price;
  v_paid := coalesce(p_amount_paid, v_total);

  insert into stock_transactions (item_id, type, qty, unit_price, total, amount_paid, payment_status)
  values (p_item_id, p_type, p_qty, p_unit_price, v_total, v_paid, p_payment_status);

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

grant execute on function record_stock_transaction(uuid, text, numeric, numeric, numeric, text) to authenticated;
