-- 0094 · Put commission and the report bonus on the payslip itself.
-- Both are earned, not granted, so they belong in the run rather than
-- arriving as a manual adjustment somebody has to remember to file.

ALTER TABLE public.payroll_runs
  ADD COLUMN IF NOT EXISTS report_bonus numeric DEFAULT 0,
  ADD COLUMN IF NOT EXISTS report_bonus_count integer DEFAULT 0,
  ADD COLUMN IF NOT EXISTS scan_commission numeric DEFAULT 0;

CREATE OR REPLACE FUNCTION public.payslip_preview(p_employee_id uuid, p_period text)
RETURNS json LANGUAGE plpgsql STABLE AS $$
DECLARE
  v_period text := public.payroll_period_normalize(p_period);
  emp employees; h record; d record; rb record;
  v_gross numeric; v_adj json; v_ded numeric:=0; v_bon numeric:=0;
  v_rules json; v_rules_total numeric:=0; v_adv numeric:=0; v_tab numeric:=0;
  v_comm numeric:=0; v_comm_days int:=0;
BEGIN
  SELECT * INTO emp FROM employees WHERE id=p_employee_id;
  IF emp IS NULL THEN RETURN NULL; END IF;
  SELECT * INTO h FROM public.payslip_hours(p_employee_id, v_period);
  v_gross := public.payslip_gross_v2(p_employee_id, v_period);
  SELECT * INTO rb FROM public.employee_report_bonus(p_employee_id, v_period);
  SELECT coalesce(sum(commission),0), count(*)::int INTO v_comm, v_comm_days
    FROM public.employee_scan_commission_days(p_employee_id, v_period);
  SELECT * INTO d FROM overtime_decisions WHERE employee_id=p_employee_id AND period=v_period;

  SELECT coalesce(json_agg(json_build_object('id',a.id,'kind',a.kind,'label',a.label,
           'amount',a.amount,'note',a.note,'occurred_on',a.occurred_on)),'[]'::json),
         coalesce(sum(a.amount) FILTER (WHERE a.kind='deduction'),0),
         coalesce(sum(a.amount) FILTER (WHERE a.kind='bonus'),0)
    INTO v_adj, v_ded, v_bon
  FROM payroll_adjustments a WHERE a.employee_id=p_employee_id
    AND public.payroll_period_normalize(a.period)=v_period;

  SELECT coalesce(json_agg(json_build_object('name',dr.name,'amount',coalesce(era.amount,dr.value))),'[]'::json),
         coalesce(sum(coalesce(era.amount,dr.value)),0)
    INTO v_rules, v_rules_total
  FROM employee_rule_assignments era JOIN deduction_rules dr ON dr.id=era.deduction_rule_id
  WHERE era.employee_id=p_employee_id AND (era.amount IS NULL OR era.status='active');

  SELECT coalesce(sum(amount-coalesce(advance_amount_deducted,0)),0) INTO v_adv
  FROM cash_expenses WHERE employee_id=p_employee_id
    AND category='employee_advance' AND advance_status='open';

  SELECT coalesce(balance,0) INTO v_tab FROM employee_tab_balances WHERE employee_id=p_employee_id;

  RETURN json_build_object(
    'employee', json_build_object('id',emp.id,'name',emp.name,'hr_id',emp.hr_id,
        'fixed_salary',emp.fixed_salary,'variable_salary',emp.variable_salary,
        'hourly_rate',emp.hourly_rate,'hybrid',emp.enable_hybrid_variable_pay,
        'shift_baseline_value',emp.shift_baseline_value,
        'scan_commission_percentage',emp.scan_commission_percentage,
        'minimum_shift_earning',emp.minimum_shift_earning,
        'report_bonus_rate',emp.report_bonus_rate,
        'report_daily_threshold',emp.report_daily_threshold),
    'period', v_period,
    'pay_basis', CASE WHEN emp.enable_hybrid_variable_pay THEN 'hybrid'
                      WHEN coalesce(emp.hourly_rate,0)>0 THEN 'hourly' ELSE 'monthly' END,
    'paid_days', h.paid_days, 'unscheduled_days', h.unscheduled_days,
    'needs_review', h.needs_review, 'absent_days', h.absent_days,
    'scheduled_hours_paid', round(h.scheduled_paid,2),
    'unscheduled_hours_paid', round(h.unscheduled_paid,2),
    'paid_hours', round(h.scheduled_paid+h.unscheduled_paid,2),
    'overtime_hours', round(h.overtime_pending,2),
    'overtime_indicative_value', round(h.overtime_pending*coalesce(emp.hourly_rate,0),2),
    'overtime_decision', CASE WHEN d IS NULL THEN NULL ELSE json_build_object(
        'status',d.status,'hours_approved',d.hours_approved,'amount',d.amount,
        'note',d.note,'decided_by',d.decided_by_name,'decided_at',d.decided_at) END,
    'overtime_awaiting_decision', (d IS NULL AND round(h.overtime_pending,2) > 0),
    'gross', v_gross,
    'scan_commission', round(v_comm,2), 'commission_days', v_comm_days,
    'report_bonus', rb.bonus, 'reports_total', rb.reports_total,
    'reports_beyond_threshold', rb.beyond_threshold, 'reports_off_shift', rb.off_shift,
    'reports_qualifying', rb.qualifying, 'report_rate', rb.rate,
    'adjustments', v_adj, 'total_bonuses', round(v_bon,2),
    'total_adjustment_deductions', round(v_ded,2),
    'rule_assignments', v_rules, 'total_rule_deductions', round(v_rules_total,2),
    'open_advances', round(v_adv,2), 'tab_balance', round(greatest(v_tab,0),2),
    'settlement', public.payroll_settlement_preview(p_employee_id),
    'already_generated', EXISTS (SELECT 1 FROM payroll_runs
        WHERE employee_id=p_employee_id AND public.payroll_period_normalize(period)=v_period),
    'indicative_net', round(v_gross + rb.bonus + v_bon - v_ded - v_rules_total - v_adv,2)
  );
END; $$;
REVOKE EXECUTE ON FUNCTION public.payslip_preview(uuid,text) FROM anon, PUBLIC;
GRANT  EXECUTE ON FUNCTION public.payslip_preview(uuid,text) TO service_role;
CREATE OR REPLACE FUNCTION public.generate_payslip(
  p_employee_id uuid, p_period text, p_generated_by text DEFAULT NULL)
RETURNS payroll_runs LANGUAGE plpgsql SECURITY DEFINER AS $function$
DECLARE
  v_period text := public.payroll_period_normalize(p_period);
  emp employees; h record; result payroll_runs;
  gross numeric; affordable numeric;
  total_ded numeric := 0; total_bon numeric := 0;
  ded jsonb := '[]'::jsonb; bon jsonb := '[]'::jsonb;
  r record; adv record; a record; cash_row record;
  adv_deduction numeric; adv_remaining numeric;
  tab_balance numeric := 0; tab_take numeric := 0; cash_take numeric; sweep_err text;
  rb record; v_comm numeric := 0;
BEGIN
  SELECT * INTO emp FROM employees WHERE id = p_employee_id;
  IF emp IS NULL THEN RAISE EXCEPTION 'Employee not found.'; END IF;

  IF EXISTS (SELECT 1 FROM payroll_runs
              WHERE employee_id = p_employee_id
                AND public.payroll_period_normalize(period) = v_period) THEN
    RAISE EXCEPTION 'A payslip for % already exists for this employee.', v_period;
  END IF;

  gross := public.payslip_gross_v2(p_employee_id, v_period);
  SELECT * INTO h FROM public.payslip_hours(p_employee_id, v_period);

  -- Commission and the report bonus are earned, not granted. They are part
  -- of the pay before anything is taken off it, so they also raise what the
  -- tab and cash sweeps can afford to clear.
  SELECT * INTO rb FROM public.employee_report_bonus(p_employee_id, v_period);
  SELECT coalesce(sum(commission),0) INTO v_comm
    FROM public.employee_scan_commission_days(p_employee_id, v_period);
  gross := gross + coalesce(rb.bonus,0);

  -- 1. standing rule assignments
  FOR r IN
    SELECT era.id, dr.name, coalesce(era.amount, dr.value) AS amt,
           (era.amount IS NOT NULL) AS one_time
    FROM employee_rule_assignments era
    JOIN deduction_rules dr ON dr.id = era.deduction_rule_id
    WHERE era.employee_id = p_employee_id
      AND (era.amount IS NULL OR era.status = 'active')
  LOOP
    total_ded := total_ded + coalesce(r.amt,0);
    ded := ded || jsonb_build_object('name', r.name, 'amount', r.amt, 'source','rule');
    IF r.one_time THEN
      UPDATE employee_rule_assignments SET status='applied', applied_at=now() WHERE id=r.id;
    END IF;
  END LOOP;

  -- 2. period adjustments. Previously invisible to this function because
  --    the period was stored in two different formats.
  FOR a IN
    SELECT * FROM payroll_adjustments
    WHERE employee_id = p_employee_id
      AND public.payroll_period_normalize(period) = v_period
  LOOP
    IF a.kind = 'bonus' THEN
      total_bon := total_bon + a.amount;
      bon := bon || jsonb_build_object('name', a.label, 'amount', a.amount, 'source','adjustment');
    ELSE
      total_ded := total_ded + a.amount;
      ded := ded || jsonb_build_object('name', a.label, 'amount', a.amount, 'source','adjustment');
    END IF;
  END LOOP;

  -- 3. advances
  FOR adv IN
    SELECT * FROM cash_expenses
    WHERE employee_id = p_employee_id AND category='employee_advance'
      AND advance_status='open' ORDER BY entry_date
  LOOP
    adv_remaining := adv.amount - coalesce(adv.advance_amount_deducted,0);
    CONTINUE WHEN adv_remaining <= 0;
    adv_deduction := CASE WHEN adv.advance_deduction_type='full' THEN adv_remaining
                          ELSE least(adv.advance_installment_amount, adv_remaining) END;
    total_ded := total_ded + adv_deduction;
    ded := ded || jsonb_build_object('name',
            'Advance Repayment'||coalesce(' ('||adv.note||')',''),
            'amount', adv_deduction, 'source','advance');
    UPDATE cash_expenses
       SET advance_amount_deducted = coalesce(advance_amount_deducted,0) + adv_deduction,
           advance_status = CASE WHEN (coalesce(advance_amount_deducted,0)+adv_deduction) >= amount
                                 THEN 'paid_off' ELSE 'open' END
     WHERE id = adv.id;
  END LOOP;

  -- 4. F&B staff tab (A39: only what the salary covers clears)
  SELECT coalesce(balance,0) INTO tab_balance
  FROM employee_tab_balances WHERE employee_id = p_employee_id;
  IF coalesce(tab_balance,0) > 0 THEN
    affordable := greatest(gross + total_bon - total_ded, 0);
    tab_take := least(tab_balance, affordable);
    IF tab_take > 0 THEN
      total_ded := total_ded + tab_take;
      ded := ded || jsonb_build_object('name','Staff Tab','amount',tab_take,'source','tab');
      INSERT INTO employee_tab_ledger (employee_id,direction,amount,reference_type,note,created_by_name)
      VALUES (p_employee_id,'payroll_deduction',tab_take,'payroll',
              'Settled in payroll '||v_period,'Payroll');
      INSERT INTO payroll_cash_settlements (employee_id,period,kind,amount,note)
      VALUES (p_employee_id,v_period,'tab',tab_take,
              CASE WHEN tab_take < tab_balance
                   THEN 'Partly settled; '||(tab_balance-tab_take)||' carried forward'
                   ELSE 'Settled in full' END);
    END IF;
  END IF;

  -- 5. unsettled cash, per stream, Cash Keeper exempt (A37)
  FOR cash_row IN
    SELECT b.brand, b.balance, (k.employee_id IS NOT NULL) AS exempt
    FROM employee_cash_balances b
    LEFT JOIN employee_cash_keeper_streams k
           ON k.employee_id=b.employee_id AND k.brand=b.brand
    WHERE b.employee_id = p_employee_id AND b.balance > 0
  LOOP
    IF cash_row.exempt THEN
      INSERT INTO payroll_cash_settlements (employee_id,period,brand,kind,amount,was_exempt,note)
      VALUES (p_employee_id,v_period,cash_row.brand,'cash',cash_row.balance,true,
              'Cash Keeper for this business - not deducted');
      CONTINUE;
    END IF;
    affordable := greatest(gross + total_bon - total_ded, 0);
    cash_take := least(cash_row.balance, affordable);
    CONTINUE WHEN cash_take <= 0;

    -- D5: the custody guard may refuse this sweep while transfers are
    -- still awaiting confirmation. That must block the sweep only, never
    -- the salary. The cash simply stays where it already is.
    sweep_err := public.payroll_sweep_cash(p_employee_id, v_period, cash_row.brand, cash_take);
    IF sweep_err IS NOT NULL THEN
      INSERT INTO payroll_cash_settlements (employee_id,period,brand,kind,amount,was_exempt,note)
      VALUES (p_employee_id,v_period,cash_row.brand,'cash',0,true,
              'Sweep deferred, cash still held by the employee: '||left(sweep_err,200));
      CONTINUE;
    END IF;

    total_ded := total_ded + cash_take;
    ded := ded || jsonb_build_object('name','Unsettled Cash ('||cash_row.brand||')',
                                     'amount',cash_take,'source','cash');
    INSERT INTO payroll_cash_settlements (employee_id,period,brand,kind,amount,note)
    VALUES (p_employee_id,v_period,cash_row.brand,'cash',cash_take,
            CASE WHEN cash_take < cash_row.balance
                 THEN 'Partly settled; '||(cash_row.balance-cash_take)||' still held'
                 ELSE 'Settled in full' END);
  END LOOP;

  INSERT INTO payroll_runs (employee_id, period, fixed_salary, variable_salary,
      deductions, net_total, gross_pay, bonuses, total_bonuses, total_deductions,
      pay_basis, paid_hours, overtime_pending_hours, generated_by_name,
      report_bonus, report_bonus_count, scan_commission)
  VALUES (p_employee_id, v_period, emp.fixed_salary, emp.variable_salary,
      ded, round(gross + total_bon - total_ded, 2), gross, bon,
      round(total_bon,2), round(total_ded,2),
      CASE WHEN emp.enable_hybrid_variable_pay THEN 'hybrid'
           WHEN coalesce(emp.hourly_rate,0) > 0 THEN 'hourly' ELSE 'monthly' END,
      round(h.scheduled_paid + h.unscheduled_paid, 2),
      round(h.overtime_pending, 2), p_generated_by,
      coalesce(rb.bonus,0), coalesce(rb.qualifying,0), round(v_comm,2))
  RETURNING * INTO result;

  RETURN result;
END; $function$;
