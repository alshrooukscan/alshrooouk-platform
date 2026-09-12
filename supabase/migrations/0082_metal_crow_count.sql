-- 0082: Metal Crow, the item left blank on the count sheet.
--
-- Counted at 12. It was the one row of the 120 returned without a number, so
-- it was deliberately left alone at the time - a missing count is not a zero.
-- Shelf said 8 and the ledger said 15; neither was right.

create table if not exists stock_count_backup_0082 (
  stock_item_id uuid primary key,
  item_name text,
  qty_before numeric,
  ledger_before numeric,
  counted numeric,
  applied_at timestamptz not null default now()
);

insert into stock_count_backup_0082 (stock_item_id, item_name, qty_before, ledger_before, counted)
select si.id, si.name, si.qty_remaining,
       coalesce((select sum(b.qty_remaining) from stock_batches b where b.stock_item_id = si.id), 0), 12
from stock_items si
where si.category = 'dental' and si.item_code::text = '58' and si.name = 'Metal Crow'
on conflict (stock_item_id) do nothing;

do $$
declare v_id uuid;
begin
  select id into v_id from stock_items
   where category = 'dental' and item_code::text = '58' and name = 'Metal Crow';
  if v_id is null then raise exception 'Metal Crow not found - nothing applied.'; end if;
  perform apply_stock_count(v_id, 12, 'Physical count, September 2026 - counted after the main sheet');
end $$;
