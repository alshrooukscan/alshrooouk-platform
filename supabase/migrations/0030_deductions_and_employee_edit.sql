-- Support one-time, amount-specific deductions from the new HR "Add Deduction"
-- action, distinct from the recurring hire-time rule assignments (which keep
-- their existing behavior unchanged: amount stays null, always applies every
-- payroll run using the rule's default value).
alter table employee_rule_assignments add column if not exists amount numeric(10,2);
alter table employee_rule_assignments add column if not exists status text not null default 'active' check (status in ('active','applied'));
alter table employee_rule_assignments add column if not exists note text;
alter table employee_rule_assignments add column if not exists created_by_name text;
alter table employee_rule_assignments add column if not exists created_at timestamptz not null default now();

-- Extend payslip generation: a row with an explicit amount is a one-time
-- deduction event - apply it once, using ITS amount, then mark it applied so
-- it never deducts again. A row with no amount is the older recurring-type
-- assignment and keeps behaving exactly as before (deducts the rule's default
-- value every single payroll run, indefinitely).
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
    select era.id, dr.name, coalesce(era.amount, dr.value) as effective_amount, (era.amount is not null) as is_one_time
    from employee_rule_assignments era
    join deduction_rules dr on dr.id = era.deduction_rule_id
    where era.employee_id = p_employee_id
      and (era.amount is null or era.status = 'active')
  loop
    total_deductions := total_deductions + coalesce(r.effective_amount,0);
    deductions_json := deductions_json || jsonb_build_object('name', r.name, 'amount', r.effective_amount);
    if r.is_one_time then
      update employee_rule_assignments set status = 'applied', applied_at = now() where id = r.id;
    end if;
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
