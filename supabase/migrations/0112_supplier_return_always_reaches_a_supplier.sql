-- 0112: a return to a supplier always comes off that supplier's balance.
--
-- On 10 Oct Doaa returned eight lots (wires, power chain, Metal Crow, 1,954.50
-- EGP). The stock came off, but no supplier's balance moved: the deliveries
-- they came from were pre-launch stock and a quantity correction, which have
-- no supplier on record, and the function skipped the money side when it
-- could not tell whose goods they were. It now asks: the supplier can be
-- passed in, and when it cannot be worked out and is not given, the return is
-- refused with a message instead of half-recorded.

drop function if exists return_to_supplier(uuid, numeric, text, date, text);

create or replace function return_to_supplier(
  p_batch_id uuid, p_qty numeric, p_reason text, p_date date default null, p_date_reason text default null,
  p_supplier_id uuid default null
) returns json
language plpgsql security definer set search_path = public, pg_temp as $$
declare me record; b stock_batches; v_item stock_items; v_line purchase_order_lines; v_po purchase_orders;
        v_supplier uuid; v_supplier_name text; v_ret uuid; v_value numeric; v_date date := coalesce(p_date, cairo_today());
begin
  me := require_staff();
  perform check_entry_date(v_date, p_date_reason);
  select * into b from stock_batches where id = p_batch_id for update;
  if b.id is null then raise exception 'That delivery was not found.'; end if;
  if p_qty is null or p_qty <= 0 then raise exception 'Enter how many units are going back.'; end if;
  if p_qty > b.qty_remaining then raise exception 'Only % left from this delivery. You cannot return more than that.', b.qty_remaining; end if;
  select * into v_item from stock_items where id = b.stock_item_id for update;
  if v_item.qty_remaining - p_qty < coalesce(v_item.qty_reserved, 0) then
    raise exception '% unit(s) of % are reserved for orders, so only % can go back.', v_item.qty_reserved, v_item.name, v_item.qty_remaining - v_item.qty_reserved;
  end if;

  -- Whose goods: the purchase order they came on, else the supplier chosen on
  -- screen, else the supplier named on the delivery.
  select * into v_line from purchase_order_lines where batch_id = b.id;
  if v_line.id is not null then
    select * into v_po from purchase_orders where id = v_line.po_id;
    if v_po.status = 'void' then raise exception 'That purchase order was cancelled.'; end if;
    v_supplier := v_po.supplier_id;
  end if;
  v_supplier := coalesce(v_supplier, p_supplier_id, (select id from suppliers where name = b.supplier_name));
  if v_supplier is null then
    raise exception 'Choose which supplier these are going back to. This delivery has no supplier on record.';
  end if;
  select name into v_supplier_name from suppliers where id = v_supplier;
  if v_supplier_name is null then raise exception 'That supplier no longer exists.'; end if;

  v_value := round(p_qty * b.purchase_price, 2);

  insert into supplier_returns (supplier_name, stock_item_id, batch_id, po_line_id, qty, unit_cost, total_value, reason, entry_date, created_by_id, created_by_name)
  values (v_supplier_name, b.stock_item_id, b.id, v_line.id, p_qty, b.purchase_price, v_value, p_reason, v_date, me.id, me.name)
  returning id into v_ret;

  perform _ledger_take(b.stock_item_id, p_qty, b.id, 'supplier_return', v_ret, coalesce(p_reason, 'Returned to supplier'));
  perform set_config('app.batch_handled', 'on', true);
  update stock_items set qty_remaining = qty_remaining - p_qty where id = b.stock_item_id;
  perform set_config('app.batch_handled', '', true);

  if v_line.id is not null then
    update purchase_order_lines set qty_returned = qty_returned + p_qty where id = v_line.id;
  end if;
  insert into purchase_orders (supplier_id, amount, entry_type, description, entry_date, status, created_by_id, created_by_name,
                               related_po_id, date_reason)
  values (v_supplier, -v_value, 'return', 'Returned ' || trim(to_char(p_qty, 'FM999999990.##')) || ' x ' || v_item.name ||
          coalesce(' from PO-' || v_po.po_number, '') || coalesce(': ' || nullif(btrim(p_reason), ''), ''),
          v_date, 'active', me.id, me.name, v_po.id, nullif(btrim(p_date_reason), ''));
  return json_build_object('return_id', v_ret, 'value', v_value, 'supplier', v_supplier_name);
end $$;

grant execute on function return_to_supplier(uuid, numeric, text, date, text, uuid) to authenticated;
