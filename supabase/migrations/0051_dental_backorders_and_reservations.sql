-- Doctors could only order what was on the shelf, and the shelf was debited the
-- instant they clicked - before anyone had reviewed the order, let alone
-- delivered it. Three consequences: a doctor could not order something that had
-- run out, cancelling an order put the stock back but left the money on the
-- books as revenue that never happened, and stock on hand meant "not yet
-- ordered" rather than "physically here".
--
-- Stock is now RESERVED when an order is placed and only DEDUCTED when it is
-- actually delivered. Reserved stock is still on the shelf and still counted,
-- but no second doctor can claim it.

alter table stock_items add column if not exists qty_reserved numeric not null default 0;
comment on column stock_items.qty_reserved is
  'Units promised to placed-but-undelivered dental orders. Still physically present and still counted in qty_remaining; subtracted from it to get what a doctor can order.';

-- Splits one basket into the part that can go now and the part that follows.
alter table dental_orders add column if not exists fulfillment text not null default 'in_stock';
comment on column dental_orders.fulfillment is
  'in_stock: every line was available when ordered. backorder: none were, and the order waits for a delivery. A mixed basket becomes two orders so the available half is not held up by the half that is not.';

-- Orders placed before this migration already debited the shelf on placement.
-- Without this they would be debited a second time on delivery.
alter table dental_orders add column if not exists stock_deducted boolean not null default false;
update dental_orders set stock_deducted = true where stock_deducted = false;

create table if not exists stock_item_requests (
  id uuid primary key default gen_random_uuid(),
  doctor_id uuid references doctors(id),
  item_name text not null,
  quantity numeric,
  note text,
  status text not null default 'pending',
  reviewed_by_id uuid,
  reviewed_by_name text,
  reviewed_at timestamptz,
  created_at timestamptz not null default now()
);
comment on table stock_item_requests is
  'Doctors asking for something the catalogue does not carry at all. Deliberately not an order: there is no item, no price and nothing to reserve until someone decides to stock it.';
alter table stock_item_requests enable row level security;
drop policy if exists staff_all on stock_item_requests;
create policy staff_all on stock_item_requests for all to authenticated using (true) with check (true);

-- What a doctor may actually order: on the shelf, minus what is already
-- promised to someone else.
create or replace view stock_available as
select s.*, greatest(s.qty_remaining - s.qty_reserved, 0) as qty_available
from stock_items s;

create or replace function public.place_dental_order(
  p_doctor_id uuid, p_payment_method text, p_pay_later boolean, p_items jsonb
) returns uuid language plpgsql security definer as $$
declare
  v_item jsonb; v_id uuid; v_qty numeric; v_price numeric; v_name text; v_avail numeric;
  v_in jsonb := '[]'::jsonb; v_back jsonb := '[]'::jsonb;
  v_in_order uuid; v_back_order uuid; v_total numeric;
begin
  if jsonb_array_length(p_items) = 0 then
    raise exception 'Cart is empty.';
  end if;

  -- Sort every line into what can go now and what has to wait. Availability is
  -- read fresh here, never trusted from the browser.
  for v_item in select * from jsonb_array_elements(p_items) loop
    v_id := (v_item->>'stock_item_id')::uuid;
    v_qty := (v_item->>'quantity')::numeric;
    select name, sale_price, greatest(qty_remaining - qty_reserved, 0)
      into v_name, v_price, v_avail
      from stock_items where id = v_id and category = 'dental';
    if v_name is null then
      raise exception 'One of the items in this order no longer exists.';
    end if;
    if v_qty <= 0 then
      raise exception 'Quantity must be greater than zero for %.', v_name;
    end if;
    if v_qty <= v_avail then
      v_in := v_in || jsonb_build_object('id', v_id, 'qty', v_qty, 'price', v_price, 'name', v_name);
    else
      -- Ordered in full as a backorder rather than part-filled: splitting a
      -- single line would leave the doctor guessing how many are coming when.
      v_back := v_back || jsonb_build_object('id', v_id, 'qty', v_qty, 'price', v_price, 'name', v_name);
    end if;
  end loop;

  if jsonb_array_length(v_in) > 0 then
    select coalesce(sum((e->>'qty')::numeric * (e->>'price')::numeric), 0)
      into v_total from jsonb_array_elements(v_in) e;
    insert into dental_orders (doctor_id, payment_method, total_amount, pay_later, fulfillment)
    values (p_doctor_id, p_payment_method, v_total, coalesce(p_pay_later, false), 'in_stock')
    returning id into v_in_order;
    for v_item in select * from jsonb_array_elements(v_in) loop
      insert into dental_order_items (order_id, stock_item_id, item_name, quantity, unit_price, line_total)
      values (v_in_order, (v_item->>'id')::uuid, v_item->>'name',
              (v_item->>'qty')::numeric, (v_item->>'price')::numeric,
              (v_item->>'qty')::numeric * (v_item->>'price')::numeric);
      -- Held, not taken. The shelf count is unchanged until delivery.
      update stock_items set qty_reserved = qty_reserved + (v_item->>'qty')::numeric
       where id = (v_item->>'id')::uuid;
    end loop;
  end if;

  if jsonb_array_length(v_back) > 0 then
    select coalesce(sum((e->>'qty')::numeric * (e->>'price')::numeric), 0)
      into v_total from jsonb_array_elements(v_back) e;
    insert into dental_orders (doctor_id, payment_method, total_amount, pay_later, fulfillment)
    values (p_doctor_id, p_payment_method, v_total, coalesce(p_pay_later, false), 'backorder')
    returning id into v_back_order;
    for v_item in select * from jsonb_array_elements(v_back) loop
      insert into dental_order_items (order_id, stock_item_id, item_name, quantity, unit_price, line_total)
      values (v_back_order, (v_item->>'id')::uuid, v_item->>'name',
              (v_item->>'qty')::numeric, (v_item->>'price')::numeric,
              (v_item->>'qty')::numeric * (v_item->>'price')::numeric);
      -- Nothing to reserve: there is no stock to hold.
    end loop;
  end if;

  return coalesce(v_in_order, v_back_order);
end;
$$;

-- Delivery is the point the goods physically leave, so it is the point the
-- shelf changes and the sale is recognised. Guarded by stock_deducted so a
-- repeated call, or an order placed under the old behaviour, cannot debit twice.
create or replace function public.fulfill_dental_order(p_order_id uuid)
returns void language plpgsql security definer as $$
declare
  o dental_orders; it record;
begin
  select * into o from dental_orders where id = p_order_id;
  if o.id is null then raise exception 'Order not found.'; end if;
  if o.stock_deducted then return; end if;

  for it in select * from dental_order_items where order_id = p_order_id loop
    update stock_items
       set qty_reserved = greatest(qty_reserved - case when o.fulfillment = 'in_stock' then it.quantity else 0 end, 0)
     where id = it.stock_item_id;
    perform record_stock_transaction(
      it.stock_item_id, 'sale', it.quantity, it.unit_price, it.line_total,
      case when o.payment_status = 'paid' then 'paid' else 'unpaid' end, o.payment_method);
  end loop;

  update dental_orders set stock_deducted = true where id = p_order_id;
end;
$$;

-- Cancelling used to hand the stock back but leave the sale standing, so a
-- cancelled order still read as revenue. Nothing is now recognised until
-- delivery, so cancelling only has to release the hold - and for an order
-- placed under the old behaviour, reverse what it already recorded.
create or replace function public.cancel_dental_order(p_order_id uuid, p_note text default null)
returns void language plpgsql security definer as $$
declare
  o dental_orders; it record;
begin
  select * into o from dental_orders where id = p_order_id;
  if o.id is null then raise exception 'Order not found.'; end if;
  if o.status = 'cancelled' then return; end if;
  if o.status = 'delivered' or coalesce(o.amount_paid, 0) > 0 then
    raise exception 'A delivered or part-paid order cannot be cancelled. Handle it as a return instead.';
  end if;

  for it in select * from dental_order_items where order_id = p_order_id loop
    if o.stock_deducted then
      -- Placed before delivery-time deduction existed: the shelf and the
      -- ledger both moved at placement and both have to be put back.
      update stock_items set qty_remaining = qty_remaining + it.quantity where id = it.stock_item_id;
      delete from cash_ledger where reference_type = 'stock_transaction' and reference_id in (
        select st.id from stock_transactions st
        where st.item_id = it.stock_item_id and st.type = 'sale'
          and st.qty = it.quantity and st.total = it.line_total
          and st.created_at >= o.created_at - interval '1 minute'
          and st.created_at <= o.created_at + interval '1 minute');
      delete from stock_transactions st
       where st.item_id = it.stock_item_id and st.type = 'sale'
         and st.qty = it.quantity and st.total = it.line_total
         and st.created_at >= o.created_at - interval '1 minute'
         and st.created_at <= o.created_at + interval '1 minute';
    elsif o.fulfillment = 'in_stock' then
      update stock_items set qty_reserved = greatest(qty_reserved - it.quantity, 0) where id = it.stock_item_id;
    end if;
  end loop;

  update dental_orders
     set status = 'cancelled', stock_deducted = false, note = coalesce(p_note, note)
   where id = p_order_id;
end;
$$;
