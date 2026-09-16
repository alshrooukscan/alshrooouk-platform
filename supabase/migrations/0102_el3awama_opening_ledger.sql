-- 0102: el3awama gets the batch ledger dental already has.
--
-- 416 units sit on the F&B shelves and the batch ledger holds nothing at all -
-- 50 of 59 items disagree with it, because every el3awama item was created
-- before the trigger that opens a batch with a new item. Dental reconciles
-- exactly, 269 against 269; el3awama has never had a ledger.
--
-- That matters now rather than in the abstract. Stock deductions went live on
-- 13 September and value a shortfall at sale price, and the F&B admin is
-- answerable for that stock - but with no ledger there is no cost basis, no
-- batch trail, and no way to tell a sale from a loss.
--
-- One opening batch per item that holds stock, matching what dental items get
-- on creation. Items with nothing on the shelf get no batch, because an empty
-- batch says nothing.
--
-- This writes rows but changes no quantity: the trigger that moves stock fires
-- on an update to stock_items, not on an insert into stock_batches, so the
-- shelf figures are untouched and the ledger simply catches up to them.

create table if not exists el3awama_opening_batches_0102 as
  select * from stock_batches where false;

with created as (
  insert into stock_batches
    (stock_item_id, po_number, supplier_name, purchase_price, sale_price,
     qty_in, qty_remaining, received_date, note)
  select i.id, 'OPENING', 'Opening balance when the F&B ledger was started',
         -- purchase_price is not-null on a batch and twelve F&B items have no
         -- cost recorded. Zero is used rather than a guess: an invented cost
         -- would quietly misstate what the stock is worth and what a shortfall
         -- costs. Those twelve are reported so a real cost can be entered.
         coalesce(i.purchase_price, 0), i.sale_price,
         i.qty_remaining, i.qty_remaining, current_date,
         'Opening stock, so the ledger starts level with the shelf.'
  from stock_items i
  where i.category = 'el3awama' and coalesce(i.qty_remaining,0) > 0
  returning *
)
insert into el3awama_opening_batches_0102 select * from created;
