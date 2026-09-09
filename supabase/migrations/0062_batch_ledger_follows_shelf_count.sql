-- 0062: keep the batch ledger in step with the shelf count, whatever moves it.
--
-- stock_items.qty_remaining and the stock_batches ledger stopped agreeing on
-- migration day. Every sale path updates the item; none of them touches the
-- ledger. All 2,725 consumption rows carry source_type 'import' - not one live
-- sale has ever written one - and the two drift further apart every day.
--
-- Three separate places move qty_remaining today (record_stock_transaction in
-- both its overloads, record_counter_sale, and cancel_dental_order), so fixing
-- them one by one leaves the next one written free to drift again. This works
-- at the item instead: whenever qty_remaining moves, the ledger follows.
--
-- Going down consumes batches oldest-first. Going up opens a new batch.
--
-- A sale is never blocked because the ledger is short. Where history does not
-- cover what is being sold, the shortfall is booked to a batch marked
-- UNRECORDED at the item's own purchase price, so the count still reconciles
-- and the gap is visible rather than silently absorbed.

create or replace function sync_batches_to_item_qty() returns trigger
language plpgsql security definer as $$
declare
  v_delta numeric;
  v_left numeric;
  v_take numeric;
  v_batch record;
  v_new_batch uuid;
  v_cost numeric;
  v_source text;
begin
  v_delta := coalesce(new.qty_remaining, 0) - coalesce(old.qty_remaining, 0);
  if v_delta = 0 then return new; end if;

  -- Callers may name themselves for the audit trail; anything that does not
  -- is recorded honestly as an adjustment rather than guessed at.
  v_source := coalesce(nullif(current_setting('app.stock_source', true), ''), 'adjustment');

  if v_delta < 0 then
    v_left := -v_delta;
    for v_batch in
      select id, qty_remaining, purchase_price, sale_price
        from stock_batches
       where stock_item_id = new.id and qty_remaining > 0
       order by received_date nulls last, created_at
    loop
      exit when v_left <= 0;
      v_take := least(v_left, v_batch.qty_remaining);
      update stock_batches set qty_remaining = qty_remaining - v_take where id = v_batch.id;
      insert into stock_batch_consumption (batch_id, stock_item_id, source_type, qty, unit_cost, unit_sale, entry_date)
      values (v_batch.id, new.id, v_source, v_take, v_batch.purchase_price, coalesce(v_batch.sale_price, new.sale_price), current_date);
      v_left := v_left - v_take;
    end loop;

    if v_left > 0 then
      v_cost := coalesce(new.purchase_price, 0);
      insert into stock_batches (stock_item_id, po_number, supplier_name, purchase_price, sale_price, qty_in, qty_remaining, received_date, note)
      values (new.id, 'UNRECORDED', 'Not in purchase history', v_cost, new.sale_price, v_left, 0, current_date,
              'Sold beyond what the purchase records cover. Opened so the count reconciles; the gap is real and shows here.')
      returning id into v_new_batch;
      insert into stock_batch_consumption (batch_id, stock_item_id, source_type, qty, unit_cost, unit_sale, entry_date)
      values (v_new_batch, new.id, v_source, v_left, v_cost, new.sale_price, current_date);
    end if;
  else
    insert into stock_batches (stock_item_id, po_number, supplier_name, purchase_price, sale_price, qty_in, qty_remaining, received_date, note)
    values (new.id, 'AUTO', 'Recorded from stock movement', coalesce(new.purchase_price, 0), new.sale_price, v_delta, v_delta, current_date,
            'Opened automatically when the shelf count went up (' || v_source || ').');
  end if;

  return new;
end;
$$;

drop trigger if exists trg_sync_batches_to_item_qty on stock_items;
create trigger trg_sync_batches_to_item_qty
  after update of qty_remaining on stock_items
  for each row when (old.qty_remaining is distinct from new.qty_remaining)
  execute function sync_batches_to_item_qty();

-- Applying tomorrow's physical count.
--
-- The trigger above keeps the two records moving in step, but it moves the
-- ledger by the same difference, so it cannot by itself make two records that
-- already disagree agree. A count is the one moment we learn the truth
-- outright, so it sets both to the counted figure rather than nudging either.
--
-- Use this for the count sheet. Ordinary sales and purchases should keep going
-- through the normal paths.
create or replace function apply_stock_count(p_item_id uuid, p_counted numeric, p_note text default null)
returns table (item_qty numeric, ledger_qty numeric)
language plpgsql security definer as $$
declare
  v_ledger numeric;
  v_diff numeric;
  v_take numeric;
  v_batch record;
  v_cost numeric;
begin
  if p_counted < 0 then raise exception 'A counted quantity cannot be negative.'; end if;

  perform set_config('app.stock_source', 'stock_count', true);
  update stock_items set qty_remaining = p_counted where id = p_item_id;

  select coalesce(sum(qty_remaining), 0) into v_ledger from stock_batches where stock_item_id = p_item_id;
  v_diff := p_counted - v_ledger;

  if v_diff < 0 then
    -- more on the ledger than on the shelf: retire the oldest first
    v_diff := -v_diff;
    for v_batch in
      select id, qty_remaining, purchase_price, sale_price from stock_batches
       where stock_item_id = p_item_id and qty_remaining > 0
       order by received_date nulls last, created_at
    loop
      exit when v_diff <= 0;
      v_take := least(v_diff, v_batch.qty_remaining);
      update stock_batches set qty_remaining = qty_remaining - v_take where id = v_batch.id;
      insert into stock_batch_consumption (batch_id, stock_item_id, source_type, qty, unit_cost, unit_sale, entry_date, note)
      values (v_batch.id, p_item_id, 'stock_count', v_take, v_batch.purchase_price, v_batch.sale_price, current_date,
              coalesce(p_note, 'Written off against the physical count.'));
      v_diff := v_diff - v_take;
    end loop;
  elsif v_diff > 0 then
    -- more on the shelf than the records explain: open a batch for it
    select coalesce(purchase_price, 0) into v_cost from stock_items where id = p_item_id;
    insert into stock_batches (stock_item_id, po_number, supplier_name, purchase_price, sale_price, qty_in, qty_remaining, received_date, note)
    select p_item_id, 'COUNT', 'Found at the physical count', v_cost, si.sale_price, v_diff, v_diff, current_date,
           coalesce(p_note, 'On the shelf but not in the purchase records. Opened at the count.')
      from stock_items si where si.id = p_item_id;
  end if;

  return query
    select si.qty_remaining, coalesce((select sum(b.qty_remaining) from stock_batches b where b.stock_item_id = si.id), 0)
      from stock_items si where si.id = p_item_id;
end;
$$;
