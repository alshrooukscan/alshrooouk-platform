-- =====================================================================
-- Cash Management  ·  Stage 9  ·  Payroll settlement
--
-- Client decisions implemented:
--   A37  the Cash Keeper skill. Cash keepers hold cash indefinitely and
--        are NOT swept automatically. Everyone else is settled at payroll
--        if they did not hand the cash over first. A branch manager or
--        owner can still sweep a keeper by hand.
--   A38  deduction order: standard rules, then advances, then F&B tab,
--        then cash. Cash carries forward last because the employee is
--        still physically holding it.
--   A39  the F&B tab does not reset. Only the portion actually deducted
--        clears; the rest carries forward.
--   A40  calendar month
--
-- The sweep is per business stream. Holding Cash Keeper - Scan exempts
-- that employee's Scan cash only; cash they hold for another business is
-- still swept. That is what the three separate skills are for.
-- =====================================================================

CREATE TABLE IF NOT EXISTS public.payroll_cash_settlements (
    id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    payroll_run_id uuid,
    employee_id   uuid NOT NULL REFERENCES public.employees(id),
    period        text NOT NULL,
    brand         text,
    kind          text NOT NULL CHECK (kind IN ('cash','tab')),
    amount        numeric(12,2) NOT NULL,
    was_exempt    boolean NOT NULL DEFAULT false,
    note          text,
    created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_pcs_employee ON public.payroll_cash_settlements(employee_id, period);

COMMENT ON TABLE public.payroll_cash_settlements IS
  'What payroll swept from each employee, per business. Rows with '
  'was_exempt = true record cash NOT taken because the employee holds the '
  'Cash Keeper skill for that business - kept so the decision is auditable.';

-- ---------------------------------------------------------------------
-- What would payroll take from this employee, and what is exempt?
-- Read-only, so it can be shown before anything is committed.
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.payroll_settlement_preview(p_employee_id uuid)
RETURNS json
LANGUAGE plpgsql STABLE AS $$
DECLARE
    v_rows json;
    v_sweep numeric := 0;
    v_exempt numeric := 0;
    v_tab numeric := 0;
BEGIN
    SELECT coalesce(json_agg(json_build_object(
             'brand', b.brand, 'amount', b.balance, 'exempt', k.employee_id IS NOT NULL)), '[]'::json)
      INTO v_rows
    FROM public.employee_cash_balances b
    LEFT JOIN public.employee_cash_keeper_streams k
           ON k.employee_id = b.employee_id AND k.brand = b.brand
    WHERE b.employee_id = p_employee_id AND b.balance > 0;

    SELECT coalesce(sum(CASE WHEN k.employee_id IS NULL THEN b.balance ELSE 0 END), 0),
           coalesce(sum(CASE WHEN k.employee_id IS NOT NULL THEN b.balance ELSE 0 END), 0)
      INTO v_sweep, v_exempt
    FROM public.employee_cash_balances b
    LEFT JOIN public.employee_cash_keeper_streams k
           ON k.employee_id = b.employee_id AND k.brand = b.brand
    WHERE b.employee_id = p_employee_id AND b.balance > 0;

    SELECT coalesce(balance,0) INTO v_tab
    FROM public.employee_tab_balances WHERE employee_id = p_employee_id;

    RETURN json_build_object(
        'per_brand',    v_rows,
        'cash_to_sweep', v_sweep,
        'cash_exempt',   v_exempt,
        'tab_balance',   greatest(coalesce(v_tab,0), 0)
    );
END;
$$;

-- ---------------------------------------------------------------------
-- generate_payslip, extended.
-- Everything above the marker is unchanged from the existing function.
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.generate_payslip(p_employee_id uuid, p_period text)
RETURNS payroll_runs
LANGUAGE plpgsql SECURITY DEFINER
AS $function$
declare
  emp employees;
  total_deductions numeric := 0;
  deductions_json jsonb := '[]'::jsonb;
  r record;
  adv record;
  adv_deduction numeric;
  adv_remaining numeric;
  result payroll_runs;
  gross numeric;
  affordable numeric;
  tab_balance numeric := 0;
  tab_take numeric := 0;
  cash_row record;
  cash_take numeric;
begin
  select * into emp from employees where id = p_employee_id;

  -- 1. standard deduction rules  (A38 first)
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

  -- 2. advances  (A38 second)
  for adv in
    select * from cash_expenses
    where employee_id = p_employee_id and category = 'employee_advance' and advance_status = 'open'
    order by entry_date asc
  loop
    adv_remaining := adv.amount - adv.advance_amount_deducted;
    if adv_remaining <= 0 then continue; end if;
    if adv.advance_deduction_type = 'full' then
      adv_deduction := adv_remaining;
    else
      adv_deduction := least(adv.advance_installment_amount, adv_remaining);
    end if;

    total_deductions := total_deductions + adv_deduction;
    deductions_json := deductions_json || jsonb_build_object(
      'name', 'Advance Repayment' || case when adv.note is not null then ' (' || adv.note || ')' else '' end,
      'amount', adv_deduction);

    update cash_expenses
    set advance_amount_deducted = advance_amount_deducted + adv_deduction,
        advance_status = case when (advance_amount_deducted + adv_deduction) >= amount then 'paid_off' else 'open' end
    where id = adv.id;
  end loop;

  -- ============ Stage 9 additions start here ============
  gross := coalesce(emp.fixed_salary,0) + coalesce(emp.variable_salary,0);

  -- 3. F&B staff tab  (A38 third). Only what the salary can actually cover
  --    is cleared; the rest carries forward (A39). No reset.
  select coalesce(balance,0) into tab_balance
  from employee_tab_balances where employee_id = p_employee_id;

  if coalesce(tab_balance,0) > 0 then
    affordable := greatest(gross - total_deductions, 0);
    tab_take := least(tab_balance, affordable);

    if tab_take > 0 then
      total_deductions := total_deductions + tab_take;
      deductions_json := deductions_json || jsonb_build_object('name','Staff Tab','amount',tab_take);

      insert into employee_tab_ledger (employee_id, direction, amount, reference_type, note, created_by_name)
      values (p_employee_id, 'payroll_deduction', tab_take, 'payroll',
              'Settled in payroll ' || p_period, 'Payroll');

      insert into payroll_cash_settlements (employee_id, period, kind, amount, note)
      values (p_employee_id, p_period, 'tab', tab_take,
              case when tab_take < tab_balance
                   then 'Partly settled; ' || (tab_balance - tab_take) || ' carried forward'
                   else 'Settled in full' end);
    end if;
  end if;

  -- 4. unsettled cash  (A38 last, A37 exemption)
  --    Swept per business. A Cash Keeper for that business is exempt, and
  --    the exemption is recorded rather than silently skipped.
  for cash_row in
    select b.brand, b.balance, (k.employee_id is not null) as exempt
    from employee_cash_balances b
    left join employee_cash_keeper_streams k
           on k.employee_id = b.employee_id and k.brand = b.brand
    where b.employee_id = p_employee_id and b.balance > 0
  loop
    if cash_row.exempt then
      insert into payroll_cash_settlements (employee_id, period, brand, kind, amount, was_exempt, note)
      values (p_employee_id, p_period, cash_row.brand, 'cash', cash_row.balance, true,
              'Cash Keeper for this business - not deducted');
      continue;
    end if;

    affordable := greatest(gross - total_deductions, 0);
    cash_take := least(cash_row.balance, affordable);
    if cash_take <= 0 then continue; end if;

    total_deductions := total_deductions + cash_take;
    deductions_json := deductions_json || jsonb_build_object(
      'name', 'Unsettled Cash (' || cash_row.brand || ')', 'amount', cash_take);

    -- Settling it in payroll means the employee no longer holds it, so the
    -- custody ledger has to reflect that too.
    insert into expense_transactions (
      type, brand, amount, payment_method, from_employee_id, status,
      note, confirmed_by_name, confirmed_at, created_by_name)
    values ('cash_collection', cash_row.brand, cash_take, 'cash', p_employee_id, 'confirmed',
            'Settled in payroll ' || p_period, 'Payroll', now(), 'Payroll');

    insert into payroll_cash_settlements (employee_id, period, brand, kind, amount, note)
    values (p_employee_id, p_period, cash_row.brand, 'cash', cash_take,
            case when cash_take < cash_row.balance
                 then 'Partly settled; ' || (cash_row.balance - cash_take) || ' still held'
                 else 'Settled in full' end);
  end loop;
  -- ============ Stage 9 additions end here ============

  insert into payroll_runs (employee_id, period, fixed_salary, variable_salary, deductions, net_total)
  values (p_employee_id, p_period, emp.fixed_salary, emp.variable_salary, deductions_json,
          gross - total_deductions)
  returning * into result;

  return result;
end;
$function$;

ALTER TABLE public.payroll_cash_settlements ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS staff_all ON public.payroll_cash_settlements;
CREATE POLICY staff_all ON public.payroll_cash_settlements FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- Applied during Stage 9: generate_payslip computed gross from fixed +
-- variable salary only, so the five hourly employees had a gross of zero.
-- Nothing could be deducted from them and the cash sweep never ran.
CREATE OR REPLACE FUNCTION public.payslip_gross(p_employee_id uuid, p_period text)
RETURNS numeric LANGUAGE plpgsql STABLE AS $$
DECLARE emp employees; v_from date; v_to date;
BEGIN
  SELECT * INTO emp FROM employees WHERE id = p_employee_id;
  IF coalesce(emp.fixed_salary,0) + coalesce(emp.variable_salary,0) > 0 THEN
    RETURN coalesce(emp.fixed_salary,0) + coalesce(emp.variable_salary,0);
  END IF;
  IF coalesce(emp.hourly_rate,0) > 0 THEN
    BEGIN v_from := to_date(p_period||'-01','YYYY-MM-DD');
    EXCEPTION WHEN others THEN v_from := date_trunc('month',CURRENT_DATE)::date; END;
    v_to := least((v_from + interval '1 month - 1 day')::date, CURRENT_DATE);
    RETURN public.employee_accrued_earnings(p_employee_id, v_from, v_to);
  END IF;
  RETURN 0;
END; $$;
-- generate_payslip then uses: gross := public.payslip_gross(p_employee_id, p_period);
