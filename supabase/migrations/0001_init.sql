-- Al Shrooouk Scan & Lab — Core Schema v1
-- Phase 0: foundational tables. RLS enabled on all, policies added in Phase 1+.

create extension if not exists "pgcrypto";

create table branches (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

create table exam_types (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  price numeric(10,2),
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

create table doctors (
  id uuid primary key default gen_random_uuid(),
  clinic_code text not null unique,
  name text not null,
  clinic_name text,
  branch_id uuid references branches(id),
  phone text,
  email text,
  discount_pct numeric(5,2) default 0,
  drive_folder_id text,
  created_at timestamptz not null default now()
);

create table patients (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  mobile text not null unique,
  dob date,
  email text,
  preferred_contact text,
  drive_folder_id text,
  created_at timestamptz not null default now()
);

create table patient_auth (
  id uuid primary key default gen_random_uuid(),
  patient_id uuid not null references patients(id) on delete cascade,
  username text unique,
  password_hash text,
  magic_link_token text,
  created_at timestamptz not null default now()
);

create table visits (
  id uuid primary key default gen_random_uuid(),
  patient_id uuid not null references patients(id),
  doctor_id uuid references doctors(id),
  branch_id uuid references branches(id),
  scan_types text[],
  amount_due numeric(10,2),
  discount_pct numeric(5,2) default 0,
  discount_reason text,
  amount_paid numeric(10,2) default 0,
  payment_status text default 'pending',
  exam_date date default current_date,
  notes text,
  created_at timestamptz not null default now()
);

create table invoices (
  id uuid primary key default gen_random_uuid(),
  visit_id uuid references visits(id),
  invoice_number text unique not null,
  amount numeric(10,2) not null,
  patient_name text,
  exam text,
  exam_date date,
  pdf_url text,
  created_at timestamptz not null default now()
);

create table whatsapp_log (
  id uuid primary key default gen_random_uuid(),
  visit_id uuid references visits(id),
  message_type text check (message_type in ('customer','scan')),
  rendered_text text,
  sent_at timestamptz,
  sent_by uuid,
  created_at timestamptz not null default now()
);

create table drive_folder_index (
  id uuid primary key default gen_random_uuid(),
  entity_type text check (entity_type in ('patient','doctor')),
  entity_id uuid not null,
  drive_folder_id text not null,
  created_at timestamptz not null default now(),
  unique (entity_type, entity_id)
);

create table employees (
  id uuid primary key default gen_random_uuid(),
  hr_id text unique,
  name text not null,
  national_id text unique,
  phone text,
  role text,
  fixed_salary numeric(10,2) default 0,
  variable_salary numeric(10,2) default 0,
  is_active boolean not null default true,
  username text unique,
  password_hash text,
  created_at timestamptz not null default now()
);

create table deduction_rules (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  rule_type text,
  value numeric(10,2),
  condition text,
  created_at timestamptz not null default now()
);

create table excuse_rules (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  rule_type text,
  value numeric(10,2),
  condition text,
  created_at timestamptz not null default now()
);

create table employee_rule_assignments (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid references employees(id),
  deduction_rule_id uuid references deduction_rules(id),
  excuse_rule_id uuid references excuse_rules(id)
);

create table timeclock_events (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null references employees(id),
  event_type text check (event_type in ('login','logout')),
  event_time timestamptz not null default now(),
  lat numeric(10,6),
  lng numeric(10,6)
);

create table payroll_runs (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null references employees(id),
  period text,
  fixed_salary numeric(10,2),
  variable_salary numeric(10,2),
  deductions jsonb,
  net_total numeric(10,2),
  generated_at timestamptz not null default now()
);

create table stock_items (
  id uuid primary key default gen_random_uuid(),
  category text check (category in ('dental','el3awama')),
  item_code text,
  name text not null,
  purchase_price numeric(10,2),
  sale_price numeric(10,2),
  qty_remaining numeric(10,2) default 0,
  created_at timestamptz not null default now()
);

create table stock_transactions (
  id uuid primary key default gen_random_uuid(),
  item_id uuid not null references stock_items(id),
  type text check (type in ('purchase','sale')),
  qty numeric(10,2) not null,
  unit_price numeric(10,2),
  total numeric(10,2),
  transaction_date date default current_date,
  created_at timestamptz not null default now()
);

create table stock_counts (
  id uuid primary key default gen_random_uuid(),
  item_id uuid not null references stock_items(id),
  physical_qty numeric(10,2),
  expected_qty numeric(10,2),
  variance numeric(10,2),
  counted_at timestamptz not null default now()
);

create table cash_ledger (
  id uuid primary key default gen_random_uuid(),
  source_stream text check (source_stream in ('scans','el3awama','stock')),
  direction text check (direction in ('in','out')),
  amount numeric(10,2) not null,
  branch_id uuid references branches(id),
  reference_type text,
  reference_id uuid,
  entry_date date default current_date,
  created_at timestamptz not null default now()
);

-- Enable RLS on every table now; policies land in Phase 1+ per role.
do $$
declare t text;
begin
  for t in select tablename from pg_tables where schemaname = 'public'
  loop
    execute format('alter table public.%I enable row level security;', t);
  end loop;
end $$;
