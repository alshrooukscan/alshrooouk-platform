-- Restores the four payroll functions as they were live on 10 Oct 2026.

CREATE OR REPLACE FUNCTION public.employee_report_bonus(p_employee_id uuid, p_period text)
 RETURNS TABLE(reports_total integer, beyond_threshold integer, off_shift integer, qualifying integer, rate numeric, bonus numeric)
 LANGUAGE plpgsql
 STABLE
AS $function$
DECLARE
  v_period text := public.payroll_period_normalize(p_period);
  v_from date := to_date(v_period||'-01','YYYY-MM-DD');
  v_to date; v_rate numeric; v_thr int;
BEGIN
  v_to := (v_from + interval '1 month - 1 day')::date;
  SELECT coalesce(report_bonus_rate,0), coalesce(report_daily_threshold,5)
    INTO v_rate, v_thr FROM employees WHERE id = p_employee_id;
  IF coalesce(v_rate,0) = 0 THEN
    RETURN QUERY SELECT 0,0,0,0,0::numeric,0::numeric; RETURN;
  END IF;

  RETURN QUERY
  WITH done AS (
    SELECT v.id, v.report_done_at,
           v.report_done_at::date AS d,
           row_number() OVER (PARTITION BY v.report_done_at::date ORDER BY v.report_done_at) AS rn
    FROM visits v
    WHERE v.report_done_by_employee_id = p_employee_id
      AND v.report_done_at::date BETWEEN v_from AND v_to
  ), judged AS (
    SELECT dn.id, dn.rn > v_thr AS beyond,
           NOT EXISTS (
             SELECT 1 FROM employee_schedule_days s
             WHERE s.employee_id = p_employee_id
               AND s.work_date = dn.d
               AND s.is_day_off = false
               AND dn.report_done_at::time >= s.start_time
               AND (dn.report_done_at::time <= s.end_time
                    OR s.end_time <= s.start_time)   -- shift crossing midnight
           ) AS offshift
    FROM done dn
  )
  SELECT (SELECT count(*)::int FROM done),
         count(*) FILTER (WHERE beyond)::int,
         count(*) FILTER (WHERE offshift)::int,
         count(*) FILTER (WHERE beyond OR offshift)::int,
         v_rate,
         round(count(*) FILTER (WHERE beyond OR offshift) * v_rate, 2)
  FROM judged;
END; $function$;

CREATE OR REPLACE FUNCTION public.payslip_preview(p_employee_id uuid, p_period text)
 RETURNS json
 LANGUAGE plpgsql
 STABLE
AS $function$
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
END; $function$;

CREATE OR REPLACE FUNCTION public.generate_payslip(p_employee_id uuid, p_period text, p_generated_by text DEFAULT NULL::text)
 RETURNS payroll_runs
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
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
  v_cap numeric; v_cap_pct numeric; v_pen numeric := 0; v_deferred numeric := 0;
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

  -- 2. Bonuses first, because they raise what the cap below allows.
  FOR a IN
    SELECT * FROM payroll_adjustments
    WHERE employee_id = p_employee_id
      AND public.payroll_period_normalize(period) = v_period
      AND kind = 'bonus'
  LOOP
    total_bon := total_bon + a.amount;
    bon := bon || jsonb_build_object('name', a.label, 'amount', a.amount, 'source','adjustment');
  END LOOP;

  -- 3. Penalty deductions, under the cap.
  --
  -- No single payslip loses more than the configured share of what was
  -- earned. Anything over the line is not forgiven and not silently
  -- applied anyway: it moves to next month, interest free, and says so.
  -- Oldest first, so a backlog clears in the order it was incurred rather
  -- than the order it happens to be read in.
  SELECT penalty_cap_percent INTO v_cap_pct FROM payroll_settings WHERE id;
  v_cap := round((gross + total_bon) * coalesce(v_cap_pct,25) / 100.0, 2);
  v_pen := total_ded;   -- standing rule assignments already counted above

  FOR a IN
    SELECT * FROM payroll_adjustments
    WHERE employee_id = p_employee_id
      AND public.payroll_period_normalize(period) = v_period
      AND kind = 'deduction'
    ORDER BY coalesce(occurred_on, created_at::date), created_at
  LOOP
    IF v_pen + a.amount <= v_cap THEN
      v_pen := v_pen + a.amount;
      total_ded := total_ded + a.amount;
      ded := ded || jsonb_build_object('name', a.label, 'amount', a.amount, 'source','adjustment');
    ELSE
      UPDATE payroll_adjustments
         SET period = to_char(to_date(v_period||'-01','YYYY-MM-DD') + interval '1 month','YYYY-MM'),
             note = coalesce(note,'') || ' [carried forward from ' || v_period ||
                    ': the ' || coalesce(v_cap_pct,25) || '% cap was reached]'
       WHERE id = a.id;
      UPDATE payroll_deductions
         SET status = 'carried_forward', carried_from_period = v_period,
             period = to_char(to_date(v_period||'-01','YYYY-MM-DD') + interval '1 month','YYYY-MM')
       WHERE adjustment_id = a.id;
      v_deferred := v_deferred + a.amount;
    END IF;
  END LOOP;

  IF v_deferred > 0 THEN
    ded := ded || jsonb_build_object('name',
             'Held back to next month (' || coalesce(v_cap_pct,25) || '% cap)',
             'amount', 0, 'source','cap', 'deferred', round(v_deferred,2));
  END IF;

  -- 4. advances
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

  -- 5. F&B staff tab (A39: only what the salary covers clears)
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

  -- 6. unsettled cash, per stream, Cash Keeper exempt (A37)
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

CREATE OR REPLACE FUNCTION public.payroll_trial_run(p_period text)
 RETURNS TABLE(employee_id uuid, employee_name text, hr_id text, pay_basis text, paid_days integer, unscheduled_days integer, absent_days integer, needs_review integer, paid_hours numeric, overtime_hours numeric, gross numeric, scan_commission numeric, report_bonus numeric, bonuses numeric, rule_deductions numeric, penalty_deductions numeric, penalty_cap numeric, deferred_to_next numeric, advance_taken numeric, tab_taken numeric, cash_swept numeric, still_held numeric, indicative_net numeric, flags text)
 LANGUAGE plpgsql
 STABLE
AS $function$
DECLARE v_period text := public.payroll_period_normalize(p_period); v_cap_pct numeric;
BEGIN
  SELECT coalesce(penalty_cap_percent,25) INTO v_cap_pct FROM payroll_settings WHERE id;
  RETURN QUERY
  WITH base AS (
    SELECT e.id, e.name, e.hr_id, e.acknowledgement_on_file AS ack,
           CASE WHEN e.enable_hybrid_variable_pay THEN 'hybrid'
                WHEN coalesce(e.hourly_rate,0) > 0 THEN 'hourly' ELSE 'monthly' END AS basis,
           h.paid_days, h.unscheduled_days, h.absent_days, h.needs_review,
           (SELECT count(*)::int FROM employee_schedule_days sd
             WHERE sd.employee_id = e.id AND sd.is_day_off = false
               AND sd.work_date BETWEEN to_date(v_period||'-01','YYYY-MM-DD')
                   AND (to_date(v_period||'-01','YYYY-MM-DD') + interval '1 month - 1 day')::date) AS sched_days,
           round(h.scheduled_paid + h.unscheduled_paid,2) AS hrs, round(h.overtime_pending,2) AS ot,
           -- payslip_gross_v2 now applies the client's rule itself - salary
           -- divided by scheduled days, times days actually signed in and out -
           -- so this view no longer prorates on its own. The calendar proration
           -- that sat here was replaced by it, and having both would have shown
           -- the employee a different number from the one their payslip pays.
           public.payslip_gross_v2(e.id,v_period) AS g,
           coalesce((SELECT sum(c.commission) FROM public.employee_scan_commission_days(e.id,v_period) c),0) AS comm,
           coalesce((SELECT rb.bonus FROM public.employee_report_bonus(e.id,v_period) rb),0) AS rbonus,
           -- Approved only. A bonus or a deduction is a proposal until an
           -- admin has decided on it, so a pending one must not reach the
           -- payslip nor the figure the employee sees they have earned.
           coalesce((SELECT sum(a.amount) FROM payroll_adjustments a WHERE a.employee_id=e.id
                     AND a.kind='bonus' AND a.status='approved'
                     AND public.payroll_period_normalize(a.period)=v_period),0) AS bon,
           coalesce((SELECT sum(coalesce(era.amount,dr.value)) FROM employee_rule_assignments era
                     JOIN deduction_rules dr ON dr.id=era.deduction_rule_id
                     WHERE era.employee_id=e.id AND (era.amount IS NULL OR era.status='active')),0) AS rules,
           coalesce((SELECT sum(a.amount) FROM payroll_adjustments a WHERE a.employee_id=e.id
                     AND a.kind='deduction' AND a.status='approved'
                     AND public.payroll_period_normalize(a.period)=v_period),0) AS pen,
           coalesce((SELECT sum(ce.amount-coalesce(ce.advance_amount_deducted,0)) FROM cash_expenses ce
                     WHERE ce.employee_id=e.id AND ce.category='employee_advance'
                       AND ce.advance_status='open'),0) AS adv,
           coalesce((SELECT greatest(tb.balance,0) FROM employee_tab_balances tb WHERE tb.employee_id=e.id),0) AS tab,
           coalesce((SELECT sum(b.balance) FROM employee_cash_balances b
                     WHERE b.employee_id=e.id AND b.balance>0
                       AND NOT EXISTS (SELECT 1 FROM employee_cash_keeper_streams k
                                       WHERE k.employee_id=b.employee_id AND k.brand=b.brand)),0) AS cash,
           -- The custody guard refuses a sweep outright while transfers from
           -- this person are still waiting to be confirmed. It is all or
           -- nothing, so a trial that assumes the sweep lands is wrong by the
           -- whole salary.
           coalesce((SELECT sum(x.amount) FROM expense_transactions x
                     WHERE x.from_employee_id=e.id AND x.status='pending'
                       AND (x.type IN ('cash_transfer','cash_collection')
                            OR (x.type='cash_out' AND x.payment_method='cash'))),0) AS cash_pending
    FROM employees e CROSS JOIN LATERAL public.payslip_hours(e.id,v_period) h
    WHERE e.is_active
  ), step AS (
    SELECT b.*, (b.g + b.rbonus + b.bon) AS earned,
           round((b.g + b.rbonus + b.bon) * v_cap_pct/100.0, 2) AS cap,
           least(b.pen, greatest(round((b.g+b.rbonus+b.bon)*v_cap_pct/100.0,2) - b.rules, 0)) AS pen_applied
    FROM base b
  ), c1 AS (
    SELECT s.*, greatest(s.earned - s.rules - s.pen_applied - s.adv, 0) AS after_adv FROM step s
  ), c2 AS (
    SELECT c.*, least(c.tab, c.after_adv) AS tab_take FROM c1 c
  ), c3 AS (
    SELECT c.*,
           CASE WHEN least(c.cash, greatest(c.after_adv - c.tab_take, 0))
                     > greatest(c.cash - c.cash_pending, 0)
                THEN 0                              -- guard refuses it entirely
                ELSE least(c.cash, greatest(c.after_adv - c.tab_take, 0)) END AS cash_take
    FROM c2 c
  )
  SELECT c.id, c.name, c.hr_id, c.basis,
         c.paid_days, c.unscheduled_days, c.absent_days, c.needs_review, c.hrs, c.ot,
         round(c.g,2), round(c.comm,2), round(c.rbonus,2), round(c.bon,2),
         round(c.rules,2), round(c.pen_applied,2), c.cap,
         round(greatest(c.pen - c.pen_applied,0),2),
         round(c.adv,2), round(c.tab_take,2), round(c.cash_take,2),
         round((c.tab - c.tab_take) + (c.cash - c.cash_take),2),
         round(c.earned - c.rules - c.pen_applied - c.adv - c.tab_take - c.cash_take,2),
         btrim(concat_ws(' · ',
           CASE WHEN c.needs_review>0 THEN c.needs_review||' day(s) need an attendance decision' END,
           CASE WHEN c.ot>0 THEN c.ot||' overtime hour(s) undecided' END,
           CASE WHEN c.pen>c.pen_applied THEN 'cap reached, '||round(c.pen-c.pen_applied,2)||' carries to next month' END,
           CASE WHEN c.cash_take=0 AND c.cash>0 AND c.cash_pending>0
                THEN 'cash sweep deferred, '||round(c.cash_pending,2)||' EGP of transfers still awaiting confirmation' END,
           CASE WHEN c.cash-c.cash_take>0 AND c.cash_pending=0
                THEN round(c.cash-c.cash_take,2)||' EGP cash stays with them, the payslip cannot cover it' END,
           CASE WHEN c.tab-c.tab_take>0 THEN round(c.tab-c.tab_take,2)||' EGP tab carries forward' END,
           CASE WHEN NOT c.ack THEN 'no signed acknowledgement' END,
           -- Named out loud. Without a roster the day-rate rule cannot be
           -- applied, so this person is on the whole salary by default - and
           -- nobody should read that figure as though it were calculated.
           CASE WHEN c.basis='monthly' AND c.sched_days=0
                THEN 'no shifts scheduled this month, so the whole salary is shown - enter their roster for this to be calculated' END))
  FROM c3 c ORDER BY c.name;
END; $function$;

CREATE OR REPLACE FUNCTION public.deduction_decide(p_id uuid, p_status text, p_note text, p_by_id uuid, p_by_name text)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE d payroll_deductions; v_adj uuid; v_ack boolean;
BEGIN
  IF p_status NOT IN ('approved','rejected') THEN
    RAISE EXCEPTION 'A deduction is either approved or rejected.';
  END IF;
  IF coalesce(p_by_name,'') = '' THEN
    RAISE EXCEPTION 'A deduction must carry the name of the person approving it.';
  END IF;

  SELECT * INTO d FROM payroll_deductions WHERE id = p_id;
  IF d IS NULL THEN RAISE EXCEPTION 'That deduction no longer exists.'; END IF;
  IF d.status <> 'pending' THEN
    RAISE EXCEPTION 'That deduction was already %.', d.status;
  END IF;
  IF EXISTS (SELECT 1 FROM payroll_runs WHERE employee_id = d.employee_id
             AND public.payroll_period_normalize(period) = d.period) THEN
    RAISE EXCEPTION 'The payslip for % is already issued.', d.period;
  END IF;

  SELECT acknowledgement_on_file INTO v_ack FROM employees WHERE id = d.employee_id;

  IF p_status = 'approved' THEN
    INSERT INTO payroll_adjustments (employee_id, period, kind, label, amount, note,
                                     created_by_id, created_by_name)
    VALUES (d.employee_id, d.period, 'deduction',
            CASE d.kind WHEN 'visa' THEN 'Unconfirmed card payment'
                        WHEN 'stock' THEN 'Stock shortfall'
                        ELSE 'Short-notice leave' END,
            d.amount, coalesce(p_note, d.reason), p_by_id, p_by_name)
    RETURNING id INTO v_adj;
  END IF;

  UPDATE payroll_deductions
     SET status = p_status, adjustment_id = v_adj, decision_note = p_note,
         approved_by_id = p_by_id, approved_by_name = p_by_name, approved_at = now(),
         acknowledgement_on_file = v_ack
   WHERE id = p_id;

  RETURN json_build_object('id', p_id, 'status', p_status, 'amount', d.amount,
                           'adjustment_id', v_adj, 'acknowledgement_on_file', v_ack);
END; $function$;

CREATE OR REPLACE FUNCTION public.detect_leave_deductions()
 RETURNS TABLE(created integer, swapped_skipped integer)
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE s payroll_settings; v_created int := 0; v_swap int := 0; r record;
        v_days int; v_ratio numeric; v_val numeric;
BEGIN
  SELECT * INTO s FROM payroll_settings WHERE id;
  IF s.deduction_go_live IS NULL THEN RETURN QUERY SELECT 0,0; RETURN; END IF;

  FOR r IN
    SELECT l.*, e.short_notice_leave_ratio
    FROM leave_requests l JOIN employees e ON e.id = l.employee_id
    WHERE l.status = 'approved'
      AND l.start_date >= s.deduction_go_live
      AND l.created_at::date > l.start_date - 7          -- less than a week's notice
      AND NOT EXISTS (SELECT 1 FROM payroll_deductions d
                      WHERE d.kind='leave' AND d.source_id = l.id)
  LOOP
    IF EXISTS (SELECT 1 FROM shift_swap_requests w
               WHERE w.requester_id = r.employee_id AND w.status = 'approved'
                 AND w.shift_date BETWEEN r.start_date AND r.end_date) THEN
      v_swap := v_swap + 1; CONTINUE;
    END IF;

    v_days := greatest((r.end_date - r.start_date) + 1, 1);
    v_ratio := coalesce(r.short_notice_leave_ratio, 2);
    v_val := public.employee_day_value(r.employee_id, r.start_date) * v_days * v_ratio;
    CONTINUE WHEN v_val <= 0;

    INSERT INTO payroll_deductions (employee_id, period, kind, amount, reason,
        source_table, source_id, dispute_deadline)
    VALUES (r.employee_id, to_char(r.start_date,'YYYY-MM'), 'leave', round(v_val,2),
            v_days || ' day(s) leave from ' || to_char(r.start_date,'DD Mon YYYY') ||
            ' requested at short notice, at a ratio of ' || v_ratio || '.',
            'leave_requests', r.id, now() + make_interval(hours => s.dispute_window_hours));
    v_created := v_created + 1;
  END LOOP;
  RETURN QUERY SELECT v_created, v_swap;
END; $function$;

ALTER TABLE payroll_deductions DROP CONSTRAINT IF EXISTS payroll_deductions_kind_check;
ALTER TABLE payroll_deductions ADD CONSTRAINT payroll_deductions_kind_check CHECK (kind IN ('visa','stock','leave','absence','late','early_leave'));
-- (kinds kept so already-detected rows stay valid; reject them in the Deductions screen if rolling back)
