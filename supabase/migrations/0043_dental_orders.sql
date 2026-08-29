-- Image field on stock items - shown both in the admin Stock page and on
-- the doctor-facing e-commerce browsing cards.
alter table stock_items add column if not exists image_url text;

-- A doctor's order placed through the portal's Dental Stock e-commerce flow.
-- Line items snapshot name and price at order time, since stock_items.name
-- or sale_price could change later and the order should reflect what was
-- actually charged, not whatever the catalog says today.
create table if not exists dental_orders (
  id uuid primary key default gen_random_uuid(),
  doctor_id uuid not null references doctors(id),
  payment_method text not null,
  total_amount numeric not null check (total_amount > 0),
  status text not null default 'confirmed' check (status in ('confirmed', 'cancelled')),
  created_at timestamptz not null default now()
);

create table if not exists dental_order_items (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references dental_orders(id) on delete cascade,
  stock_item_id uuid not null references stock_items(id),
  item_name text not null,
  quantity numeric not null check (quantity > 0),
  unit_price numeric not null,
  line_total numeric not null
);

create index if not exists dental_orders_doctor_idx on dental_orders (doctor_id);
create index if not exists dental_order_items_order_idx on dental_order_items (order_id);

alter table dental_orders enable row level security;
alter table dental_order_items enable row level security;
-- Staff dashboard needs full read/write for the admin Dental Stock Orders page.
create policy staff_all on public.dental_orders for all to authenticated using (true) with check (true);
create policy staff_all on public.dental_order_items for all to authenticated using (true) with check (true);
