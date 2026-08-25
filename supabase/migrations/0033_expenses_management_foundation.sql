-- Expenses Management module (Phase C) - foundation layer.
-- Single event log everything else derives from - balances are never stored
-- directly, always summed from confirmed rows here, the same pattern already
-- proven safe for the payroll deduction work.
create table if not exists expense_transactions (
  id uuid primary key default gen_random_uuid(),
  type text not null check (type in ('cash_out','cash_transfer','cash_collection','brand_transfer','stock_sale','visit_collection')),
  brand text not null check (brand in ('scan','dental_stock','el3awama_stock')),
  to_brand text check (to_brand in ('scan','dental_stock','el3awama_stock')),
  amount numeric(12,2) not null check (amount > 0),
  payment_method text not null default 'cash' check (payment_method in ('cash','visa','instapay','vodafone_cash')),
  from_employee_id uuid references employees(id),
  to_employee_id uuid references employees(id),
  category text,
  note text,
  entry_date date not null default current_date,
  -- cash_transfer and cash_collection always need confirmation regardless of
  -- payment method (money hasn't actually moved until the receiving side
  -- confirms it). cash_out is confirmed immediately when paid in cash (a
  -- physically reconciled category) and only queues when non-cash.
  -- stock_sale mirrors an already-completed sale, so it inserts confirmed.
  status text not null default 'pending' check (status in ('pending','confirmed','rejected')),
  confirmed_by_id uuid,
  confirmed_by_name text,
  confirmed_at timestamptz,
  created_by_id uuid,
  created_by_name text,
  created_at timestamptz not null default now()
);
create index if not exists expense_transactions_status_idx on expense_transactions (status);
create index if not exists expense_transactions_brand_idx on expense_transactions (brand);
create index if not exists expense_transactions_employees_idx on expense_transactions (from_employee_id, to_employee_id);
alter table expense_transactions enable row level security;
drop policy if exists staff_all on public.expense_transactions;
create policy staff_all on public.expense_transactions for all to authenticated using (true) with check (true);

-- Per-employee, per-brand cash-in-hand balance. visit_collection (an employee
-- physically collecting a cash patient payment) and the receiving side of a
-- confirmed cash_transfer both increase a balance; the sending side of a
-- cash_transfer and any confirmed cash_collection both decrease it.
create or replace view employee_cash_balances as
select employee_id, brand, sum(delta)::numeric(12,2) as balance
from (
  select to_employee_id as employee_id, brand, amount as delta
  from expense_transactions
  where status = 'confirmed' and type in ('visit_collection', 'cash_transfer') and to_employee_id is not null
  union all
  select from_employee_id as employee_id, brand, -amount as delta
  from expense_transactions
  where status = 'confirmed' and type in ('cash_transfer', 'cash_collection') and from_employee_id is not null
) t
group by employee_id, brand;

-- Net cash moved between any two brands, from confirmed brand_transfer rows only.
create or replace view brand_transfer_totals as
select brand as from_brand, to_brand, sum(amount)::numeric(12,2) as total_transferred
from expense_transactions
where type = 'brand_transfer' and status = 'confirmed' and to_brand is not null
group by brand, to_brand;

-- Which employee physically collected a cash visit payment. Nullable and
-- backfill-free by design - existing visits simply have no collector on
-- record, which is accurate (nobody was asked at the time).
alter table visits add column if not exists collected_by_employee_id uuid references employees(id);

-- Stock sales need a payment method to route into expense_transactions
-- correctly (only record_stock_transaction sets this going forward -
-- existing rows default to cash, matching how the rest of the system already
-- defaulted un-migrated payment data).
alter table stock_transactions add column if not exists payment_method text not null default 'cash' check (payment_method in ('cash','visa','instapay','vodafone_cash'));

-- Extend record_stock_transaction: a sale now also writes its cash-in into
-- expense_transactions, crediting the right brand. This is the fix for the
-- gap identified during planning - Dental/El3awama sales already recorded
-- amount_paid, but that money never reached the ledger, which is exactly why
-- the Dashboard has shown 0 for both brands since launch.
create or replace function record_stock_transaction(
  p_item_id uuid, p_type text, p_qty numeric, p_unit_price numeric,
  p_amount_paid numeric default null, p_payment_status text default 'paid',
  p_payment_method text default 'cash'
)
returns stock_items as $$
declare
  result stock_items;
  v_total numeric;
  v_paid numeric;
  v_category text;
  v_brand text;
begin
  v_total := p_qty * p_unit_price;
  v_paid := coalesce(p_amount_paid, v_total);

  insert into stock_transactions (item_id, type, qty, unit_price, total, amount_paid, payment_status, payment_method)
  values (p_item_id, p_type, p_qty, p_unit_price, v_total, v_paid, p_payment_status, p_payment_method);

  if p_type = 'purchase' then
    update stock_items set qty_remaining = coalesce(qty_remaining,0) + p_qty, purchase_price = p_unit_price
    where id = p_item_id;
  elsif p_type = 'sale' then
    update stock_items set qty_remaining = coalesce(qty_remaining,0) - p_qty, sale_price = p_unit_price
    where id = p_item_id;

    select category into v_category from stock_items where id = p_item_id;
    v_brand := case v_category when 'dental' then 'dental_stock' when 'el3awama' then 'el3awama_stock' else null end;

    if v_brand is not null and v_paid > 0 then
      insert into expense_transactions (type, brand, amount, payment_method, entry_date, status, note)
      values ('stock_sale', v_brand, v_paid, p_payment_method, current_date, 'confirmed', 'Stock sale, item ' || p_item_id);
    end if;
  end if;

  select * into result from stock_items where id = p_item_id;
  return result;
end;
$$ language plpgsql security definer;
