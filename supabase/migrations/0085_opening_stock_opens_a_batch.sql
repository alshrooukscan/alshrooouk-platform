-- 0085: opening stock on a new item opens a batch to match.
--
-- 0062 keeps the shelf count and the purchase ledger in step, but it watches
-- UPDATE of qty_remaining only. An item created with an opening quantity was
-- therefore born diverged: shelf 5, ledger 0. Tested before this fix and it
-- did exactly that.
--
-- That matters more than it sounds. We have just spent a day reconciling 246
-- items that drifted for precisely this reason, and the Add Item form now asks
-- for an opening quantity - so without this, the first item added would start
-- the same divergence over again.
--
-- The batch is marked OPENING rather than folded into a purchase, because
-- nobody bought it today; it is stock declared to be on the shelf at the
-- moment the item was created.

create or replace function open_batch_for_new_stock_item() returns trigger
language plpgsql as $$
begin
  if coalesce(new.qty_remaining, 0) > 0 then
    insert into stock_batches (
      stock_item_id, po_number, supplier_name, purchase_price, sale_price,
      qty_in, qty_remaining, received_date, note
    ) values (
      new.id, 'OPENING', 'Declared when the item was created',
      coalesce(new.purchase_price, 0), new.sale_price,
      new.qty_remaining, new.qty_remaining, current_date,
      'Opening stock entered with the item, so the ledger starts level with the shelf.'
    );
  end if;
  return null;
end;
$$;

drop trigger if exists trg_open_batch_for_new_stock_item on stock_items;
create trigger trg_open_batch_for_new_stock_item
  after insert on stock_items
  for each row
  when (coalesce(new.qty_remaining, 0) > 0)
  execute function open_batch_for_new_stock_item();
