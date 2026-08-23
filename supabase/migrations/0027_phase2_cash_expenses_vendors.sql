-- Phase 2: manual cash expense ledger (with employee advance -> payroll deduction),
-- and the external vendor report request workflow.

-- ===================== ITEM 6: CASH EXPENSES =====================

alter table cash_ledger drop constraint if exists cash_ledger_source_stream_check;
alter table cash_ledger add constraint cash_ledger_source_stream_check check (source_stream in ('scans','el3awama','stock','payroll','expenses'));

create table if not exists cash_expenses (
  id uuid primary key default gen_random_uuid(),
  category text not null check (category in ('utilities','maintenance','supplies','employee_advance','courier','other')),
  amount numeric(10,2) not null check (amount > 0),
  entry_date date not null default current_date,
  note text,
  employee_id uuid references employees(id) on delete set null,
  branch_id uuid references branches(id) on delete set null,
  -- Employee Advance only. Null for every other category.
  advance_deduction_type text check (advance_deduction_type in ('full','partial')),
  advance_installment_amount numeric(10,2),
  advance_amount_deducted numeric(10,2) not null default 0,
  advance_status text check (advance_status in ('open','paid_off')),
  created_by_id uuid,
  created_by_name text,
  created_at timestamptz not null default now()
);
alter table cash_expenses enable row level security;
drop policy if exists staff_all on public.cash_expenses;
create policy staff_all on public.cash_expenses for all to authenticated using (true) with check (true);

-- Every manual expense is real cash leaving the register the moment it's logged
-- (an advance is cash handed to the employee now; it's recovered from their
-- salary later, that's a payroll-side offset, not a second cash movement).
create or replace function trg_cash_expense_cash_out() returns trigger as $$
begin
  insert into cash_ledger (source_stream, direction, amount, branch_id, reference_type, reference_id, entry_date)
  values ('expenses', 'out', new.amount, new.branch_id, 'cash_expense', new.id, new.entry_date);
  return new;
end;
$$ language plpgsql security definer;

drop trigger if exists on_cash_expense_insert on cash_expenses;
create trigger on_cash_expense_insert after insert on cash_expenses
for each row execute function trg_cash_expense_cash_out();

-- Employee Advance rows start with an open/paid_off status.
create or replace function trg_cash_expense_advance_defaults() returns trigger as $$
begin
  if new.category = 'employee_advance' then
    new.advance_status := 'open';
    if new.advance_deduction_type = 'partial' and (new.advance_installment_amount is null or new.advance_installment_amount <= 0) then
      raise exception 'Partial advance deductions require an installment amount';
    end if;
  end if;
  return new;
end;
$$ language plpgsql;

drop trigger if exists on_cash_expense_advance_defaults on cash_expenses;
create trigger on_cash_expense_advance_defaults before insert on cash_expenses
for each row execute function trg_cash_expense_advance_defaults();

-- Extend payroll generation: pull in any open advances for this employee and
-- deduct them automatically, full or by installment per how each advance was logged.
create or replace function generate_payslip(p_employee_id uuid, p_period text)
returns payroll_runs as $$
declare
  emp employees;
  total_deductions numeric := 0;
  deductions_json jsonb := '[]'::jsonb;
  r record;
  adv record;
  adv_deduction numeric;
  adv_remaining numeric;
  result payroll_runs;
begin
  select * into emp from employees where id = p_employee_id;

  for r in
    select dr.name, dr.value
    from employee_rule_assignments era
    join deduction_rules dr on dr.id = era.deduction_rule_id
    where era.employee_id = p_employee_id
  loop
    total_deductions := total_deductions + coalesce(r.value,0);
    deductions_json := deductions_json || jsonb_build_object('name', r.name, 'amount', r.value);
  end loop;

  for adv in
    select * from cash_expenses
    where employee_id = p_employee_id and category = 'employee_advance' and advance_status = 'open'
    order by entry_date asc
  loop
    adv_remaining := adv.amount - adv.advance_amount_deducted;
    if adv_remaining <= 0 then
      continue;
    end if;
    if adv.advance_deduction_type = 'full' then
      adv_deduction := adv_remaining;
    else
      adv_deduction := least(adv.advance_installment_amount, adv_remaining);
    end if;

    total_deductions := total_deductions + adv_deduction;
    deductions_json := deductions_json || jsonb_build_object(
      'name', 'Advance Repayment' || case when adv.note is not null then ' (' || adv.note || ')' else '' end,
      'amount', adv_deduction
    );

    update cash_expenses
    set advance_amount_deducted = advance_amount_deducted + adv_deduction,
        advance_status = case when (advance_amount_deducted + adv_deduction) >= amount then 'paid_off' else 'open' end
    where id = adv.id;
  end loop;

  insert into payroll_runs (employee_id, period, fixed_salary, variable_salary, deductions, net_total)
  values (
    p_employee_id, p_period, emp.fixed_salary, emp.variable_salary, deductions_json,
    coalesce(emp.fixed_salary,0) + coalesce(emp.variable_salary,0) - total_deductions
  )
  returning * into result;

  return result;
end;
$$ language plpgsql security definer;

-- ===================== ITEM 7: EXTERNAL VENDOR REPORTS =====================

create table if not exists vendors (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  mobile text,
  notes text,
  created_at timestamptz not null default now()
);
alter table vendors enable row level security;
drop policy if exists staff_all on public.vendors;
create policy staff_all on public.vendors for all to authenticated using (true) with check (true);

create table if not exists vendor_requests (
  id uuid primary key default gen_random_uuid(),
  vendor_id uuid not null references vendors(id) on delete cascade,
  description text not null,
  assigned_employee_id uuid references employees(id) on delete set null,
  status text not null default 'assigned' check (status in ('assigned','in_progress','done')),
  requested_date date not null default current_date,
  completed_at timestamptz,
  reported_back_at timestamptz,
  notes text,
  created_by_id uuid,
  created_by_name text,
  created_at timestamptz not null default now()
);
create index if not exists vendor_requests_vendor_idx on vendor_requests (vendor_id);
create index if not exists vendor_requests_status_idx on vendor_requests (status);
alter table vendor_requests enable row level security;
drop policy if exists staff_all on public.vendor_requests;
create policy staff_all on public.vendor_requests for all to authenticated using (true) with check (true);
