-- Cash Expenses -> Center Expenses: add payment method, matching the same
-- four values already used for patient visit payments (Cash, Visa, InstaPay,
-- Vodafone Cash). Cash-specific totals are what the daily reconciliation
-- below actually needs - electronic payments don't move the physical
-- register, so they can't be verified by counting cash in hand.
alter table cash_expenses add column if not exists payment_method text not null default 'cash';

-- One row per day: what the system expects to be sitting in the register
-- (today's cash-paid visits minus today's cash-paid center expenses), and
-- whether admin has physically counted and confirmed it matches. This is a
-- deliberately simple placeholder ahead of the full Expenses Management
-- module (Phase C), which will replace it with a reconciliation derived from
-- the real per-employee, per-brand cash ledgers instead of this flat daily
-- snapshot.
create table if not exists cash_reconciliation (
  id uuid primary key default gen_random_uuid(),
  entry_date date not null unique,
  expected_cash_in numeric(12,2) not null default 0,
  expected_cash_out numeric(12,2) not null default 0,
  expected_remaining numeric(12,2) not null default 0,
  confirmed boolean not null default false,
  confirmed_by_id uuid,
  confirmed_by_name text,
  confirmed_at timestamptz,
  created_at timestamptz not null default now()
);
alter table cash_reconciliation enable row level security;
drop policy if exists staff_all on public.cash_reconciliation;
create policy staff_all on public.cash_reconciliation for all to authenticated using (true) with check (true);
