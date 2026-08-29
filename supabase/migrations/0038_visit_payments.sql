-- Multiple payment splits per visit (e.g. 500 cash + 1000 Visa on one scan),
-- replacing the single payment_method/amount_paid fields as the source of
-- truth. Those columns on visits stay in place but become derived/computed -
-- always the sum and status implied by this table, kept in sync by trigger,
-- the same event-log-then-derive pattern already used for Expenses
-- Management's cash balances.
create table if not exists visit_payments (
  id uuid primary key default gen_random_uuid(),
  visit_id uuid not null references visits(id) on delete cascade,
  amount numeric not null check (amount > 0),
  payment_method text not null,
  paid_at timestamptz not null default now(),
  created_by_id uuid,
  created_by_name text,
  created_at timestamptz not null default now()
);
create index if not exists visit_payments_visit_idx on visit_payments (visit_id);
alter table visit_payments enable row level security;
drop policy if exists staff_all on public.visit_payments;
create policy staff_all on public.visit_payments for all to authenticated using (true) with check (true);

-- Recomputes the parent visit's amount_paid, payment_status, and paid_at
-- from the full set of its payment splits. paid_at is set the moment status
-- first reaches "paid" and cleared if a later change (e.g. a correction)
-- drops it back below full - it should mean "when this became fully paid",
-- not "when the first payment happened".
create or replace function recompute_visit_payment()
returns trigger
language plpgsql
as $$
declare
  v_visit_id uuid;
  v_due numeric;
  v_paid numeric;
  v_status text;
  v_current_status text;
begin
  v_visit_id := coalesce(new.visit_id, old.visit_id);

  select amount_due, payment_status into v_due, v_current_status from visits where id = v_visit_id;
  select coalesce(sum(amount), 0) into v_paid from visit_payments where visit_id = v_visit_id;

  if v_paid <= 0 then
    v_status := 'pending';
  elsif v_due is not null and v_due > 0 and v_paid >= v_due then
    v_status := 'paid';
  else
    v_status := 'partial';
  end if;

  update visits
  set amount_paid = v_paid,
      payment_status = v_status,
      paid_at = case
        when v_status = 'paid' and v_current_status is distinct from 'paid' then now()
        when v_status = 'paid' then paid_at
        else null
      end
  where id = v_visit_id;

  return coalesce(new, old);
end;
$$;

drop trigger if exists trg_recompute_visit_payment on visit_payments;
create trigger trg_recompute_visit_payment
  after insert or update or delete on visit_payments
  for each row execute function recompute_visit_payment();
