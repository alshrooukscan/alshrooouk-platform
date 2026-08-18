-- Supplier Purchase Orders: a running debt ledger per supplier.
-- Positive amount = a purchase made on credit (we now owe the supplier).
-- Negative amount = a payment made to the supplier (reduces what we owe).
-- Running balance = sum of all entries for that supplier = current debt owed.

create table if not exists suppliers (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  phone text,
  notes text,
  created_at timestamptz not null default now()
);

create table if not exists purchase_orders (
  id uuid primary key default gen_random_uuid(),
  supplier_id uuid not null references suppliers(id) on delete cascade,
  amount numeric(12,2) not null, -- positive = purchase (debt), negative = payment (reduces debt)
  entry_type text not null check (entry_type in ('purchase','payment')),
  description text,
  stock_item_id uuid references stock_items(id),
  entry_date date not null default current_date,
  created_at timestamptz not null default now()
);

alter table suppliers enable row level security;
alter table purchase_orders enable row level security;

drop policy if exists staff_all on public.suppliers;
create policy staff_all on public.suppliers for all to authenticated using (true) with check (true);
drop policy if exists staff_all on public.purchase_orders;
create policy staff_all on public.purchase_orders for all to authenticated using (true) with check (true);

create or replace function get_supplier_balances()
returns table(supplier_id uuid, supplier_name text, balance numeric) as $$
  select s.id, s.name, coalesce(sum(po.amount), 0) as balance
  from suppliers s
  left join purchase_orders po on po.supplier_id = s.id
  group by s.id, s.name;
$$ language sql stable;

grant execute on function get_supplier_balances() to authenticated;
