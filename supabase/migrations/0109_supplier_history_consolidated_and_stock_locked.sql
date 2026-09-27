-- 0109: the purchase history, supplier balances and Doaa's cash, as agreed
-- with the client on 27 Sep 2026, and the lock that makes 0108 the only way in.
--
-- Run only after the screens from the same change are live: this revokes the
-- browser's direct writes to stock quantities, prices and the supplier ledger,
-- and the old screens depended on them.
--
-- Agreed figures, checked at the end; any mismatch aborts everything:
--   Main Dental Supplier owed 11,630 EGP, Sleepy Tooth 11,050, AlEman 0
--   Doaa's dental cash in hand 280 EGP
--   توبيكال جيل مصرى 171 units, ledger equal

-- ── 1. Pre-launch history becomes one consolidated purchase and payment ────
--
-- The history was imported twice: 18 Aug (day and month swapped whenever the
-- day was 12 or less, which put PO-55, 69, 83, 92 in November) and 9 Sep from
-- the stock workbook. 98 PO numbers appeared two to four times, and a payment
-- of 980,979 EGP dated 13 Aug with no description was added on 13 Sep to make
-- the balance come out. The client confirmed 15,650 EGP was still owed at 31
-- Aug. Every one of those rows is kept here, then replaced by two entries.

create table if not exists purchase_orders_archive_0109 as select * from purchase_orders where false;

insert into purchase_orders_archive_0109
select * from purchase_orders
 where (created_at < '2026-09-10' and not (entry_type = 'payment' and entry_date >= '2026-09-01'))
    or (entry_type = 'payment' and amount = -980979.00)
on conflict do nothing;

do $$
declare
  md uuid := 'd84c7f41-a44c-4124-9e9e-da7237a9908d';
  v_purchases numeric;
begin
  select sum(amount) into v_purchases from purchase_orders_archive_0109
   where supplier_id = md and entry_type = 'purchase' and description = 'imported from stock workbook';
  if v_purchases is null then raise exception 'Workbook purchases not found; nothing applied.'; end if;

  delete from purchase_orders where id in (select id from purchase_orders_archive_0109);

  insert into purchase_orders (supplier_id, amount, entry_type, description, entry_date, status, is_consolidated,
                               created_by_name, date_reason)
  values
   (md, v_purchases, 'purchase',
    'All purchases before the system went live on 1 Sep 2026, combined. Taken from the stock workbook; the originals are kept in purchase_orders_archive_0109.',
    '2026-08-31', 'active', true, 'System (opening balance)', 'Opening balance at launch'),
   (md, -(v_purchases - 15650), 'payment',
    'All payments before the system went live on 1 Sep 2026, combined. 15,650 EGP was still owed at 31 Aug, as confirmed by the client.',
    '2026-08-31', 'active', true, 'System (opening balance)', 'Opening balance at launch');
end $$;

-- ── 2. Live POs get their item lines and their batches back ────────────────
--
-- Each PO from 10 Sep onward created its stock a moment before the PO row,
-- as batches labelled "AUTO". Matched by time, every PO's batches add up to
-- its amount exactly, item for item.
do $$
declare p record; b record; v_supplier text;
begin
  for p in select * from purchase_orders where entry_type = 'purchase' and not is_consolidated and created_at >= '2026-09-10'
             and not exists (select 1 from purchase_order_lines l where l.po_id = purchase_orders.id)
  loop
    select name into v_supplier from suppliers where id = p.supplier_id;
    for b in select sb.*, si.name item_name from stock_batches sb join stock_items si on si.id = sb.stock_item_id
              where sb.po_number in ('AUTO', 'OPENING')
                and sb.created_at between p.created_at - interval '90 seconds' and p.created_at
              order by sb.created_at
    loop
      insert into purchase_order_lines (po_id, stock_item_id, item_name, qty, unit_price, batch_id, created_at)
      values (p.id, b.stock_item_id, b.item_name, b.qty_in, b.purchase_price, b.id, p.created_at);
      update stock_batches set po_number = 'PO-' || p.po_number, supplier_name = v_supplier, po_id = p.id,
             received_date = p.entry_date, note = 'Received on PO-' || p.po_number
       where id = b.id;
    end loop;
    if (select coalesce(sum(line_total), 0) from purchase_order_lines where po_id = p.id) <> p.amount then
      raise exception 'PO-% lines do not add up to its amount; nothing applied.', p.po_number;
    end if;
  end loop;
end $$;

-- ── 3. PO-113 was the same 20 units as PO-114 ──────────────────────────────
-- Entered first under Main Dental Supplier, then again under Sleepy Tooth ten
-- minutes after that supplier was created. Its stock already came off with
-- the 27 Sep approval, so it is cancelled without moving stock again.
update purchase_orders
   set status = 'void', voided_by_name = 'System correction', voided_at = now(),
       void_reason = 'Duplicate of PO-114: the same 20 units, first entered under the wrong supplier. Stock was already corrected by the 27 Sep approval.'
 where po_number = 113 and entry_type = 'purchase' and status = 'active';

-- ── 4. توبيكال جيل مصرى back to 171 ────────────────────────────────────────
-- The 27 Sep approval set it to 22 after PO-117 had added 150, erasing them.
-- The client counts 171 (one short of 172), recorded without a shortfall.
do $$
declare t uuid := 'dda85b76-218e-4f3f-88fa-09cec0f6d43b'; v_po uuid; v_now numeric;
begin
  select qty_remaining into v_now from stock_items where id = t for update;
  if v_now <> 22 then raise exception 'توبيكال is at %, not 22 as checked; nothing applied.', v_now; end if;
  select id into v_po from purchase_orders where po_number = 117 and entry_type = 'purchase';
  perform set_config('app.batch_handled', 'on', true);
  update stock_items set qty_remaining = 171 where id = t;
  perform set_config('app.batch_handled', '', true);
  insert into stock_batches (stock_item_id, po_number, supplier_name, purchase_price, sale_price, qty_in, qty_remaining, received_date, note, po_id)
  values (t, 'PO-117', 'Sleepy Tooth', 65, 75, 149, 149, '2026-09-27',
          'Restored: the PO-117 units erased by the 27 Sep approval. 150 received, 149 on the shelf at the client''s check.', v_po);
end $$;

-- ── 5. Who paid, how, and Doaa's cash in hand ──────────────────────────────
-- Confirmed by the client. Doaa received 7,195 EGP cash from 12 to 17 Sep, of
-- which 5,495 was logged; the 1,700 difference is recorded first, so her
-- balance can carry the three cash payments she made and land on the 280 she
-- holds.
do $$
declare
  doaa uuid := '6b956376-01db-4fa9-8988-c10844027286';
  md uuid := 'd84c7f41-a44c-4124-9e9e-da7237a9908d';
  al uuid := '4972d2f1-1d72-4b65-921d-47c30c51c339';
  r record; v_tx uuid; v_sup text;
begin
  insert into expense_transactions (type, brand, amount, payment_method, to_employee_id, status, note, entry_date,
                                    confirmed_by_name, confirmed_at, created_by_name)
  values ('stock_sale', 'dental_stock', 1700, 'cash', doaa, 'confirmed',
          'Correction: cash received 12 to 17 Sep and not logged at the time (7,195 received, 5,495 logged). Confirmed by the client 27 Sep 2026.',
          '2026-09-17', 'System correction', now(), 'System correction');

  for r in
    select * from (values
      (md, 4700.00, date '2026-09-13', 'cash',     doaa, 'Doaa Tarek Mohamed'),
      (al,  850.00, date '2026-09-17', 'cash',     doaa, 'Doaa Tarek Mohamed'),
      (md, 4600.00, date '2026-09-22', 'cash',     doaa, 'Doaa Tarek Mohamed'),
      (md, 5000.00, date '2026-09-14', 'instapay', null::uuid, 'Mohamed Said'),
      (md, 2000.00, date '2026-09-22', 'instapay', null::uuid, 'Mohamed Said')
    ) v(supplier, amt, d, method, emp, payer)
  loop
    if (select count(*) from purchase_orders where supplier_id = r.supplier and entry_type = 'payment'
          and amount = -r.amt and entry_date = r.d and status = 'active') <> 1 then
      raise exception 'Payment of % on % not found exactly once; nothing applied.', r.amt, r.d;
    end if;
    v_tx := null;
    if r.method = 'cash' then
      select name into v_sup from suppliers where id = r.supplier;
      insert into expense_transactions (type, brand, amount, payment_method, from_employee_id, category, note, entry_date,
                                        status, confirmed_by_name, confirmed_at, created_by_name)
      values ('cash_out', 'dental_stock', r.amt, 'cash', r.emp, 'supplier_payment', 'Paid to ' || v_sup, r.d,
              'confirmed', 'System correction', now(), 'System correction')
      returning id into v_tx;
    end if;
    update purchase_orders
       set payment_method = r.method, paid_by_employee_id = r.emp, paid_by_name = r.payer,
           cash_brand = case when v_tx is not null then 'dental_stock' end, cash_tx_id = v_tx
     where supplier_id = r.supplier and entry_type = 'payment' and amount = -r.amt and entry_date = r.d and status = 'active';
  end loop;
end $$;

-- ── 6. PO numbers are unique from here on ──────────────────────────────────
create unique index if not exists purchase_orders_po_number_unique
  on purchase_orders (po_number)
  where entry_type = 'purchase' and status = 'active' and po_number is not null;

-- ── 7. The browser can no longer write stock or the ledger directly ────────
-- Quantities and prices change through a PO, a sale, a return, a count or an
-- approval; the supplier ledger through the PO functions. Names, codes,
-- pictures and reorder levels still save straight from the stock screen.
revoke insert, update, delete on purchase_orders from anon, authenticated;
revoke insert, update, delete on purchase_order_lines from anon, authenticated;
revoke insert, update, delete on stock_batches from anon, authenticated;
revoke insert, update, delete on stock_batch_consumption from anon, authenticated;
revoke insert, update, delete on supplier_returns from anon, authenticated;
revoke insert, update, delete on supplier_credits from anon, authenticated;
revoke update on stock_items from anon, authenticated;
grant update (name, item_code, category, image_url, reorder_level) on stock_items to authenticated;

-- ── 8. Checks ──────────────────────────────────────────────────────────────
do $$
declare v numeric; v2 numeric;
begin
  select balance into v from get_supplier_balances() where supplier_name = 'Main Dental Supplier';
  if v <> 11630 then raise exception 'Main Dental Supplier balance is %, expected 11,630; nothing applied.', v; end if;
  select balance into v from get_supplier_balances() where supplier_name = 'Sleepy Tooth';
  if v <> 11050 then raise exception 'Sleepy Tooth balance is %, expected 11,050; nothing applied.', v; end if;
  select balance into v from get_supplier_balances() where supplier_name = 'AlEman Cleaning Supplier';
  if v <> 0 then raise exception 'AlEman balance is %, expected 0; nothing applied.', v; end if;
  select material_cash into v from staff_custody_monitor where name = 'Doaa Tarek Mohamed';
  if v <> 280 then raise exception 'Doaa''s dental cash is %, expected 280; nothing applied.', v; end if;
  select qty_remaining, (select sum(qty_remaining) from stock_batches where stock_item_id = si.id) into v, v2
    from stock_items si where id = 'dda85b76-218e-4f3f-88fa-09cec0f6d43b';
  if v <> 171 or v2 <> 171 then raise exception 'توبيكال is % with ledger %, expected 171; nothing applied.', v, v2; end if;
  if exists (select 1 from purchase_orders where entry_date > cairo_today()) then
    raise exception 'A future-dated entry is still on the ledger; nothing applied.';
  end if;
end $$;
