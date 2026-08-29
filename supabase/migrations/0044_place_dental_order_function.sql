-- Places a doctor's entire cart as one atomic operation - either every line
-- item succeeds (stock deducted, cash wired via the existing, proven
-- record_stock_transaction) or none of it does. Prices and stock levels are
-- always read fresh from stock_items here, never trusted from the caller -
-- a doctor's browser sending a manipulated price should have no effect.
create or replace function place_dental_order(p_doctor_id uuid, p_payment_method text, p_items jsonb)
returns uuid
language plpgsql
as $$
declare
  v_order_id uuid;
  v_total numeric := 0;
  v_item jsonb;
  v_stock_item_id uuid;
  v_qty numeric;
  v_real_price numeric;
  v_real_qty_remaining numeric;
  v_real_name text;
  v_line_total numeric;
begin
  if jsonb_array_length(p_items) = 0 then
    raise exception 'Cart is empty.';
  end if;

  -- Validate every line first, before touching anything - an order with one
  -- bad line should reject cleanly, not partially apply.
  for v_item in select * from jsonb_array_elements(p_items)
  loop
    v_stock_item_id := (v_item->>'stock_item_id')::uuid;
    v_qty := (v_item->>'quantity')::numeric;

    select sale_price, qty_remaining, name into v_real_price, v_real_qty_remaining, v_real_name
    from stock_items where id = v_stock_item_id and category = 'dental';

    if v_real_name is null then
      raise exception 'One of the items in this order no longer exists.';
    end if;
    if v_qty <= 0 then
      raise exception 'Quantity must be greater than zero for %.', v_real_name;
    end if;
    if v_qty > v_real_qty_remaining then
      raise exception 'Not enough stock for % - only % left.', v_real_name, v_real_qty_remaining;
    end if;
  end loop;

  -- Second pass: everything validated, now actually total it up and apply.
  for v_item in select * from jsonb_array_elements(p_items)
  loop
    v_stock_item_id := (v_item->>'stock_item_id')::uuid;
    v_qty := (v_item->>'quantity')::numeric;
    select sale_price into v_real_price from stock_items where id = v_stock_item_id;
    v_total := v_total + (v_qty * v_real_price);
  end loop;

  insert into dental_orders (doctor_id, payment_method, total_amount)
  values (p_doctor_id, p_payment_method, v_total)
  returning id into v_order_id;

  for v_item in select * from jsonb_array_elements(p_items)
  loop
    v_stock_item_id := (v_item->>'stock_item_id')::uuid;
    v_qty := (v_item->>'quantity')::numeric;
    select sale_price, name into v_real_price, v_real_name from stock_items where id = v_stock_item_id;
    v_line_total := v_qty * v_real_price;

    insert into dental_order_items (order_id, stock_item_id, item_name, quantity, unit_price, line_total)
    values (v_order_id, v_stock_item_id, v_real_name, v_qty, v_real_price, v_line_total);

    perform record_stock_transaction(v_stock_item_id, 'sale', v_qty, v_real_price, v_line_total, 'paid', p_payment_method);
  end loop;

  return v_order_id;
end;
$$;
