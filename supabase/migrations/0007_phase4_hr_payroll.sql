-- Phase 4: Payroll & HR — RLS + HR ID/credentials + payslip generation

do $$
declare t text;
begin
  for t in select unnest(array[
    'employees','deduction_rules','excuse_rules','employee_rule_assignments',
    'timeclock_events','payroll_runs'
  ])
  loop
    execute format('drop policy if exists staff_all on public.%I;', t);
    execute format('create policy staff_all on public.%I for all to authenticated using (true) with check (true);', t);
  end loop;
end $$;

create sequence if not exists hr_id_seq start 1;

create or replace function generate_hr_id() returns text as $$
  select 'HR-' || to_char(current_date,'YYYY') || '-' || lpad(nextval('hr_id_seq')::text, 4, '0');
$$ language sql volatile;

create or replace function create_employee_credentials(p_employee_id uuid, p_username text)
returns text as $$
declare
  pwd text;
begin
  pwd := generate_temp_password();
  update employees set username = p_username, password_hash = crypt(pwd, gen_salt('bf')) where id = p_employee_id;
  return pwd;
end;
$$ language plpgsql security definer;

create or replace function generate_payslip(p_employee_id uuid, p_period text)
returns payroll_runs as $$
declare
  emp employees;
  total_deductions numeric := 0;
  deductions_json jsonb := '[]'::jsonb;
  r record;
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

  insert into payroll_runs (employee_id, period, fixed_salary, variable_salary, deductions, net_total)
  values (
    p_employee_id, p_period, emp.fixed_salary, emp.variable_salary, deductions_json,
    coalesce(emp.fixed_salary,0) + coalesce(emp.variable_salary,0) - total_deductions
  )
  returning * into result;

  return result;
end;
$$ language plpgsql security definer;

grant execute on function generate_hr_id() to authenticated;
grant execute on function create_employee_credentials(uuid, text) to authenticated;
grant execute on function generate_payslip(uuid, text) to authenticated;
grant usage, select on sequence hr_id_seq to authenticated;
