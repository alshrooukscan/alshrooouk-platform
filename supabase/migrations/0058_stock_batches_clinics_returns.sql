-- Groundwork for importing the client's stock workbook. Three things the
-- platform cannot currently express, each asked for directly.

-- 1. PURCHASE BATCHES
-- stock_items holds one purchase price and one quantity per item, so "which PO
-- did this unit come from" has no home, and purchase_orders is an invoice
-- ledger that has never once been linked to an item. Cost, and therefore
-- profit, differs per delivery: the same gloves bought at 145 in May and 155 in
-- July are two different margins. A batch is one delivery of one item.
create table if not exists stock_batches (
  id uuid primary key default gen_random_uuid(),
  stock_item_id uuid not null references stock_items(id) on delete cascade,
  po_number text,
  supplier_name text,
  purchase_price numeric(12,2) not null default 0,
  sale_price numeric(12,2),
  qty_in numeric(12,2) not null default 0,
  qty_remaining numeric(12,2) not null default 0,
  received_date date,
  note text,
  created_at timestamptz not null default now()
);
create index if not exists stock_batches_item_idx on stock_batches(stock_item_id);
-- Oldest first: this is the index FIFO consumption reads.
create index if not exists stock_batches_fifo_idx
  on stock_batches(stock_item_id, received_date, created_at)
  where qty_remaining > 0;

-- Which batch each sale came out of. Without this the FIFO trail exists only
-- at import time and is lost the moment anyone sells something.
create table if not exists stock_batch_consumption (
  id uuid primary key default gen_random_uuid(),
  batch_id uuid not null references stock_batches(id) on delete cascade,
  stock_item_id uuid not null references stock_items(id) on delete cascade,
  source_type text not null,          -- dental_order | counter_sale | import | adjustment
  source_id uuid,
  qty numeric(12,2) not null,
  unit_cost numeric(12,2) not null default 0,
  unit_sale numeric(12,2),
  entry_date date,
  note text,
  created_at timestamptz not null default now()
);
create index if not exists sbc_batch_idx on stock_batch_consumption(batch_id);
create index if not exists sbc_source_idx on stock_batch_consumption(source_type, source_id);

-- 2. CLINICS
-- A clinic code is a text field on doctors - 122 codes across 166 doctors - so
-- there is nothing to owe money. The workbook records orders per clinic, and
-- clinic 506 alone has four doctors, so a debt cannot be attributed to a person
-- without picking one arbitrarily. Money is owed by the clinic, and every
-- doctor at it should see it.
create table if not exists clinics (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  name text,
  created_at timestamptz not null default now()
);

alter table customer_ar_ledger drop constraint if exists customer_ar_ledger_customer_type_check;
alter table customer_ar_ledger add constraint customer_ar_ledger_customer_type_check
  check (customer_type = any (array['doctor','client','internal','clinic']));
alter table counter_sales drop constraint if exists counter_sales_customer_type_check;
alter table counter_sales add constraint counter_sales_customer_type_check
  check (customer_type = any (array['doctor','client','internal','clinic']));

-- 3. SUPPLIER RETURNS AND CREDIT
-- Returning goods is not "negative stock": the units go back to the supplier
-- they came from, and their value is held as credit against that supplier's
-- next invoice. Tied to the batch so the return leaves at the price it was
-- bought at, not today's.
create table if not exists supplier_returns (
  id uuid primary key default gen_random_uuid(),
  supplier_name text not null,
  stock_item_id uuid references stock_items(id) on delete set null,
  batch_id uuid references stock_batches(id) on delete set null,
  qty numeric(12,2) not null,
  unit_cost numeric(12,2) not null default 0,
  total_value numeric(12,2) not null default 0,
  reason text,
  entry_date date not null default current_date,
  created_by_id uuid,
  created_by_name text,
  created_at timestamptz not null default now()
);
create index if not exists supplier_returns_supplier_idx on supplier_returns(supplier_name);

create table if not exists supplier_credits (
  id uuid primary key default gen_random_uuid(),
  supplier_name text not null,
  direction text not null check (direction in ('credit','used')),
  amount numeric(12,2) not null,
  return_id uuid references supplier_returns(id) on delete set null,
  po_number text,
  note text,
  entry_date date not null default current_date,
  created_by_id uuid,
  created_by_name text,
  created_at timestamptz not null default now()
);
create index if not exists supplier_credits_supplier_idx on supplier_credits(supplier_name);

create or replace view supplier_credit_balances as
  select supplier_name,
         sum(case when direction = 'credit' then amount else -amount end) as balance
    from supplier_credits
   group by supplier_name;

alter table stock_batches enable row level security;
alter table stock_batch_consumption enable row level security;
alter table clinics enable row level security;
alter table supplier_returns enable row level security;
alter table supplier_credits enable row level security;
do $$
begin
  perform 1;
  execute 'create policy staff_all on stock_batches for all using (true) with check (true)';
  execute 'create policy staff_all on stock_batch_consumption for all using (true) with check (true)';
  execute 'create policy staff_all on clinics for all using (true) with check (true)';
  execute 'create policy staff_all on supplier_returns for all using (true) with check (true)';
  execute 'create policy staff_all on supplier_credits for all using (true) with check (true)';
exception when duplicate_object then null;
end $$;
