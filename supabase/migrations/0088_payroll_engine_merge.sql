-- =====================================================================
-- 0088  ·  Payroll engine merge
--
-- The platform carried TWO payroll calculations that returned different
-- figures for the same employee:
--   A) lib/payroll.js buildPayslip()  - attendance based, scheduled hours,
--      reads payroll_adjustments, used by the Payslips page.
--   B) generate_payslip() RPC         - raw clock difference, reads rule
--      assignments, advances, tab and cash, used by the profile button.
--
-- Proven divergence on live September data: up to 78% on one radiologist.
-- payroll_runs was at 0 rows, so no issued payslip is affected.
--
-- Defects closed here:
--   D1  two engines            -> one gross calculator, one deduction chain
--   D2  period format mismatch -> normalize_payroll_period(), YYYY-MM
--   D4  50% cap ignored advances -> category string corrected
--   D5  regenerating a payslip double-deducted advances -> guarded
--
-- D3 (generate_payslip is SECURITY DEFINER granted to anon) is closed in
-- 0089, AFTER the server route is live. Revoking first breaks the HR page.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Period normalizer.
--    The profile button wrote "September 2026". Adjustments are stored as
--    "2026-09". Nothing matched, so manual bonuses and deductions were
--    silently dropped from the committed payslip. Both forms are accepted
--    now and everything resolves to YYYY-MM.
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.normalize_payroll_period(p_period text)
RETURNS text LANGUAGE plpgsql IMMUTABLE AS $$
BEGIN
  IF p_period IS NULL OR btrim(p_period) = '' THEN
    RETURN to_char(CURRENT_DATE, 'YYYY-MM');
  END IF;
  IF p_period ~ '^\d{4}-\d{2}$' THEN
    RETURN p_period;
  END IF;
  -- "September 2026", "Sep 2026", "1 September 2026"
  BEGIN
    RETURN to_char(to_date(btrim(p_period), 'Month YYYY'), 'YYYY-MM');
  EXCEPTION WHEN others THEN NULL;
  END;
  BEGIN
    RETURN to_char(to_date(btrim(p_period), 'Mon YYYY'), 'YYYY-MM');
  EXCEPTION WHEN others THEN NULL;
  END;
  BEGIN
    RETURN to_char(p_period::date, 'YYYY-MM');
  EXCEPTION WHEN others THEN NULL;
  END;
  RETURN to_char(CURRENT_DATE, 'YYYY-MM');
END; $$;

COMMENT ON FUNCTION public.normalize_payroll_period(text) IS
  'Every payroll period resolves to YYYY-MM. Legacy "September 2026" still accepted.';

-- ---------------------------------------------------------------------
-- 2. Attendance, the single definition.
--
--    A scheduled day is paid when there is BOTH a sign-in and a sign-out
--    on it, and it is paid at its SCHEDULED hours, not the clock gap. A
--    shift that ends ten minutes early is still a day's work; paying to
--    the minute turns every early finish into a pay cut.
--
--    A day worked that was NOT on the schedule is still paid, at its
--    actual clocked hours, so covering an unplanned shift is never free.
--
--    Sign-in with no sign-out is NOT decided here. It is surfaced as
--    needs_review and goes to the admin exception queue.
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.payslip_attendance(
  p_employee_id uuid, p_from date, p_to date)
RETURNS json LANGUAGE plpgsql STABLE AS $$
DECLARE
  v_sched_hours numeric := 0;
  v_sched_days  integer := 0;
  v_paid_days   integer := 0;
  v_review      integer := 0;
  v_absent      integer := 0;
  v_extra_hours numeric := 0;
  v_extra_days  integer := 0;
  v_days        json;
BEGIN
  -- scheduled working days
  SELECT
    coalesce(sum(CASE WHEN x.has_in AND x.has_out THEN x.hrs ELSE 0 END), 0),
    count(*),
    count(*) FILTER (WHERE x.has_in AND x.has_out),
    count(*) FILTER (WHERE x.has_in AND NOT x.has_out),
    count(*) FILTER (WHERE NOT x.has_in),
    coalesce(json_agg(json_build_object(
      'date', d.work_date, 'hours', round(x.hrs,2),
      'status', CASE WHEN x.has_in AND x.has_out THEN 'worked'
                     WHEN x.has_in THEN 'needs_review' ELSE 'absent' END)
      ORDER BY d.work_date), '[]'::json)
  INTO v_sched_hours, v_sched_days, v_paid_days, v_review, v_absent, v_days
  FROM public.employee_schedule_days d
  CROSS JOIN LATERAL (
    SELECT
      EXISTS (SELECT 1 FROM public.timeclock_events t
               WHERE t.employee_id = d.employee_id AND t.event_type = 'login'
                 AND t.event_time::date = d.work_date) AS has_in,
      EXISTS (SELECT 1 FROM public.timeclock_events t
               WHERE t.employee_id = d.employee_id AND t.event_type = 'logout'
                 AND t.event_time::date = d.work_date) AS has_out,
      CASE WHEN d.end_time > d.start_time
           THEN EXTRACT(EPOCH FROM (d.end_time - d.start_time)) / 3600.0
           ELSE EXTRACT(EPOCH FROM (d.end_time - d.start_time)) / 3600.0 + 24
      END AS hrs
  ) x
  WHERE d.employee_id = p_employee_id
    AND d.is_day_off = false
    AND d.work_date BETWEEN p_from AND p_to;

  -- days actually worked that were never on the schedule, paid at clocked hours
  SELECT coalesce(sum(pair.worked),0), count(*)
    INTO v_extra_hours, v_extra_days
  FROM (
    SELECT t.event_time::date AS d,
           EXTRACT(EPOCH FROM (min(t.event_time) FILTER (WHERE t.event_type='logout')
                             - min(t.event_time) FILTER (WHERE t.event_type='login'))) / 3600.0 AS worked
    FROM public.timeclock_events t
    WHERE t.employee_id = p_employee_id
      AND t.event_time::date BETWEEN p_from AND p_to
    GROUP BY 1
    HAVING count(*) FILTER (WHERE t.event_type='login')  > 0
       AND count(*) FILTER (WHERE t.event_type='logout') > 0
  ) pair
  WHERE pair.worked > 0
    AND NOT EXISTS (SELECT 1 FROM public.employee_schedule_days d
                     WHERE d.employee_id = p_employee_id
                       AND d.work_date = pair.d AND d.is_day_off = false);

  RETURN json_build_object(
    'scheduled_days', v_sched_days,
    'paid_days',      v_paid_days + v_extra_days,
    'paid_hours',     round(v_sched_hours + v_extra_hours, 2),
    'unscheduled_days',  v_extra_days,
    'unscheduled_hours', round(v_extra_hours, 2),
    'needs_review',   v_review,
    'absent_days',    v_absent,
    'days',           v_days
  );
END; $$;

COMMENT ON FUNCTION public.payslip_attendance(uuid,date,date) IS
  'The single attendance definition used by both the payslip preview and the committed payslip.';

-- ---------------------------------------------------------------------
-- 3. Gross, the single calculator.
--    Monthly staff earn their salary; an unworked day reaches them as a
--    deduction rule rather than by shrinking the base, which is what keeps
--    a monthly payslip readable. Hourly staff earn confirmed attendance.
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.payslip_gross(p_employee_id uuid, p_period text)
RETURNS numeric LANGUAGE plpgsql STABLE AS $$
DECLARE
  emp employees;
  v_period text;
  v_from date; v_to date;
  v_att json;
BEGIN
  SELECT * INTO emp FROM public.employees WHERE id = p_employee_id;
  IF emp.id IS NULL THEN RETURN 0; END IF;

  IF coalesce(emp.fixed_salary,0) + coalesce(emp.variable_salary,0) > 0 THEN
    RETURN round(coalesce(emp.fixed_salary,0) + coalesce(emp.variable_salary,0), 2);
  END IF;

  IF coalesce(emp.hourly_rate,0) > 0 THEN
    v_period := public.normalize_payroll_period(p_period);
    v_from := to_date(v_period || '-01', 'YYYY-MM-DD');
    v_to   := (v_from + interval '1 month - 1 day')::date;
    v_att  := public.payslip_attendance(p_employee_id, v_from, v_to);
    RETURN round((v_att->>'paid_hours')::numeric * emp.hourly_rate, 2);
  END IF;

  RETURN 0;
END; $$;

-- ---------------------------------------------------------------------
-- 4. Accrued to date, same basis as the payslip.
--    This feeds the 50% advance and internal-spend cap, so it has to agree
--    with what the payslip will actually pay. It previously used the raw
--    clock gap and disagreed with the payslip by design.
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.employee_accrued_earnings(
  p_employee_id uuid,
  p_from date DEFAULT (date_trunc('month', CURRENT_DATE::timestamptz))::date,
  p_to   date DEFAULT CURRENT_DATE)
RETURNS numeric LANGUAGE plpgsql STABLE AS $$
DECLARE
  v_hourly numeric; v_fixed numeric; v_days integer; v_att json;
BEGIN
  SELECT coalesce(hourly_rate,0), coalesce(fixed_salary,0) + coalesce(variable_salary,0)
    INTO v_hourly, v_fixed
    FROM public.employees WHERE id = p_employee_id;

  IF v_hourly > 0 THEN
    v_att := public.payslip_attendance(p_employee_id, p_from, p_to);
    RETURN round((v_att->>'paid_hours')::numeric * v_hourly, 2);
  END IF;

  -- Fixed salary accrues evenly across the month, monthly / 30 per day,
  -- as the client specified, including days off.
  IF v_fixed > 0 THEN
    v_days := (p_to - p_from) + 1;
    RETURN round((v_fixed / 30.0) * v_days, 2);
  END IF;

  RETURN 0;
END; $$;

-- ---------------------------------------------------------------------
-- 5. D4. The cap never counted advances.
--    employee_spend_capacity read category = 'advance'. The Center
--    Expenses page writes 'employee_advance', which is also what
--    generate_payslip deducts. So an employee could draw an advance and
--    still show full spending capacity at the counter.
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.employee_spend_capacity(
  p_employee_id uuid,
  p_from date DEFAULT (date_trunc('month', CURRENT_DATE::timestamptz))::date,
  p_to   date DEFAULT CURRENT_DATE)
RETURNS json LANGUAGE plpgsql STABLE AS $$
DECLARE
  v_accrued numeric; v_cap numeric; v_advances numeric; v_tab numeric;
BEGIN
  v_accrued := public.employee_accrued_earnings(p_employee_id, p_from, p_to);
  v_cap     := round(v_accrued * 0.5, 2);

  SELECT coalesce(sum(amount - coalesce(advance_amount_deducted,0)), 0)
    INTO v_advances
  FROM public.cash_expenses
  WHERE employee_id = p_employee_id
    AND category = 'employee_advance'
    AND coalesce(advance_status,'open') <> 'paid_off'
    AND entry_date BETWEEN p_from AND p_to;

  SELECT coalesce(sum(CASE direction WHEN 'charge' THEN amount ELSE -amount END), 0)
    INTO v_tab
  FROM public.employee_tab_ledger
  WHERE employee_id = p_employee_id
    AND entry_date BETWEEN p_from AND p_to;

  RETURN json_build_object(
    'accrued',   v_accrued,
    'cap',       v_cap,
    'advances',  v_advances,
    'tab_used',  v_tab,
    'remaining', greatest(v_cap - v_advances - v_tab, 0)
  );
END; $$;

-- ---------------------------------------------------------------------
-- 6. Preview. Read-only, and it returns exactly what generate_payslip
--    will commit. Preview and commit can no longer disagree, because the
--    page stops calculating anything of its own.
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.payslip_preview(p_employee_id uuid, p_period text)
RETURNS json LANGUAGE plpgsql STABLE AS $$
DECLARE
  emp employees;
  v_period text; v_from date; v_to date;
  v_att json; v_gross numeric;
  v_lines json; v_ded numeric := 0; v_bonus numeric := 0;
  v_adv numeric := 0; v_tab_bal numeric := 0; v_tab_take numeric := 0;
  v_cash json; v_cash_sweep numeric := 0; v_cash_exempt numeric := 0;
  v_afford numeric;
  v_existing payroll_runs;
BEGIN
  SELECT * INTO emp FROM public.employees WHERE id = p_employee_id;
  IF emp.id IS NULL THEN RETURN json_build_object('error','Employee not found.'); END IF;

  v_period := public.normalize_payroll_period(p_period);
  v_from := to_date(v_period || '-01','YYYY-MM-DD');
  v_to   := (v_from + interval '1 month - 1 day')::date;

  v_att   := public.payslip_attendance(p_employee_id, v_from, v_to);
  v_gross := public.payslip_gross(p_employee_id, v_period);

  SELECT * INTO v_existing FROM public.payroll_runs
   WHERE employee_id = p_employee_id
     AND public.normalize_payroll_period(period) = v_period
   LIMIT 1;

  -- standing rule assignments
  SELECT coalesce(sum(coalesce(era.amount, dr.value)),0),
         coalesce(json_agg(json_build_object('name', dr.name,
                  'amount', coalesce(era.amount, dr.value), 'source','rule')),'[]'::json)
    INTO v_ded, v_lines
  FROM public.employee_rule_assignments era
  JOIN public.deduction_rules dr ON dr.id = era.deduction_rule_id
  WHERE era.employee_id = p_employee_id
    AND (era.amount IS NULL OR era.status = 'active');

  -- manual adjustments for this period (D2: these were being dropped)
  SELECT v_ded + coalesce(sum(amount) FILTER (WHERE kind='deduction'),0),
         coalesce(sum(amount) FILTER (WHERE kind='bonus'),0)
    INTO v_ded, v_bonus
  FROM public.payroll_adjustments
  WHERE employee_id = p_employee_id
    AND public.normalize_payroll_period(period) = v_period;

  -- open advances
  SELECT coalesce(sum(CASE WHEN advance_deduction_type = 'full'
                           THEN amount - coalesce(advance_amount_deducted,0)
                           ELSE least(coalesce(advance_installment_amount,0),
                                      amount - coalesce(advance_amount_deducted,0)) END), 0)
    INTO v_adv
  FROM public.cash_expenses
  WHERE employee_id = p_employee_id AND category = 'employee_advance'
    AND advance_status = 'open' AND amount > coalesce(advance_amount_deducted,0);

  -- F&B tab, only what the salary can cover, remainder carries forward (A39)
  SELECT coalesce(balance,0) INTO v_tab_bal
    FROM public.employee_tab_balances WHERE employee_id = p_employee_id;
  v_afford  := greatest(v_gross + v_bonus - v_ded - v_adv, 0);
  v_tab_take := least(greatest(coalesce(v_tab_bal,0),0), v_afford);

  -- cash custody, Cash Keeper exempt per business stream (A37)
  SELECT coalesce(sum(CASE WHEN k.employee_id IS NULL THEN b.balance ELSE 0 END),0),
         coalesce(sum(CASE WHEN k.employee_id IS NOT NULL THEN b.balance ELSE 0 END),0),
         coalesce(json_agg(json_build_object('brand', b.brand, 'amount', b.balance,
                  'exempt', k.employee_id IS NOT NULL)),'[]'::json)
    INTO v_cash_sweep, v_cash_exempt, v_cash
  FROM public.employee_cash_balances b
  LEFT JOIN public.employee_cash_keeper_streams k
         ON k.employee_id = b.employee_id AND k.brand = b.brand
  WHERE b.employee_id = p_employee_id AND b.balance > 0;

  v_afford := greatest(v_afford - v_tab_take, 0);
  v_cash_sweep := least(v_cash_sweep, v_afford);

  RETURN json_build_object(
    'employee_id',   emp.id,
    'employee_name', emp.name,
    'hr_id',         emp.hr_id,
    'period',        v_period,
    'pay_basis',     CASE WHEN coalesce(emp.hourly_rate,0) > 0 THEN 'hourly' ELSE 'monthly' END,
    'hourly_rate',   coalesce(emp.hourly_rate,0),
    'attendance',    v_att,
    'gross',         v_gross,
    'bonuses',       v_bonus,
    'rule_lines',    v_lines,
    'deductions',    v_ded,
    'advances',      v_adv,
    'tab_balance',   greatest(coalesce(v_tab_bal,0),0),
    'tab_deduction', v_tab_take,
    'cash_per_brand',v_cash,
    'cash_sweep',    v_cash_sweep,
    'cash_exempt',   v_cash_exempt,
    'total_deductions', round(v_ded + v_adv + v_tab_take + v_cash_sweep, 2),
    'net',           round(v_gross + v_bonus - v_ded - v_adv - v_tab_take - v_cash_sweep, 2),
    'already_issued', v_existing.id IS NOT NULL,
    'issued_at',      v_existing.generated_at
  );
END; $$;

COMMENT ON FUNCTION public.payslip_preview(uuid,text) IS
  'Read-only. Returns exactly what generate_payslip will commit, so the preview page never calculates its own figure.';

-- ---------------------------------------------------------------------
-- 7. The committed payslip.
--    Deduction order locked to approved decision A38:
--      rules -> manual adjustments -> advances -> F&B tab -> cash.
--    Cash is last because the employee is still physically holding it.
--
--    D5: this function has side effects. It marks rule assignments
--    applied, advances deducted, and writes the tab and cash ledgers.
--    Running it twice for the same period used to double-charge. Guarded.
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.generate_payslip(p_employee_id uuid, p_period text)
RETURNS payroll_runs LANGUAGE plpgsql SECURITY DEFINER AS $function$
DECLARE
  emp employees;
  v_period text;
  total_deductions numeric := 0;
  total_bonuses numeric := 0;
  deductions_json jsonb := '[]'::jsonb;
  r record; adv record; cash_row record;
  adv_deduction numeric; adv_remaining numeric;
  result payroll_runs;
  gross numeric; affordable numeric;
  tab_balance numeric := 0; tab_take numeric := 0; cash_take numeric;
BEGIN
  SELECT * INTO emp FROM public.employees WHERE id = p_employee_id;
  IF emp.id IS NULL THEN RAISE EXCEPTION 'Employee not found.'; END IF;

  v_period := public.normalize_payroll_period(p_period);

  -- D5 guard. Never issue the same period twice.
  IF EXISTS (SELECT 1 FROM public.payroll_runs
              WHERE employee_id = p_employee_id
                AND public.normalize_payroll_period(period) = v_period) THEN
    RAISE EXCEPTION 'A payslip for % has already been issued for this employee. Delete it first if it needs reissuing.', v_period;
  END IF;

  gross := public.payslip_gross(p_employee_id, v_period);

  -- 1. standing rule assignments
  FOR r IN
    SELECT era.id, dr.name, coalesce(era.amount, dr.value) AS effective_amount,
           (era.amount IS NOT NULL) AS is_one_time
    FROM public.employee_rule_assignments era
    JOIN public.deduction_rules dr ON dr.id = era.deduction_rule_id
    WHERE era.employee_id = p_employee_id
      AND (era.amount IS NULL OR era.status = 'active')
  LOOP
    total_deductions := total_deductions + coalesce(r.effective_amount,0);
    deductions_json := deductions_json || jsonb_build_object('name', r.name, 'amount', r.effective_amount);
    IF r.is_one_time THEN
      UPDATE public.employee_rule_assignments SET status='applied', applied_at=now() WHERE id = r.id;
    END IF;
  END LOOP;

  -- 2. manual adjustments for this period (D2: previously dropped entirely)
  FOR r IN
    SELECT label, kind, amount FROM public.payroll_adjustments
    WHERE employee_id = p_employee_id
      AND public.normalize_payroll_period(period) = v_period
  LOOP
    IF r.kind = 'bonus' THEN
      total_bonuses := total_bonuses + coalesce(r.amount,0);
    ELSE
      total_deductions := total_deductions + coalesce(r.amount,0);
      deductions_json := deductions_json || jsonb_build_object('name', r.label, 'amount', r.amount);
    END IF;
  END LOOP;

  -- 3. advances
  FOR adv IN
    SELECT * FROM public.cash_expenses
    WHERE employee_id = p_employee_id AND category = 'employee_advance' AND advance_status = 'open'
    ORDER BY entry_date ASC
  LOOP
    adv_remaining := adv.amount - coalesce(adv.advance_amount_deducted,0);
    CONTINUE WHEN adv_remaining <= 0;
    IF adv.advance_deduction_type = 'full' THEN
      adv_deduction := adv_remaining;
    ELSE
      adv_deduction := least(coalesce(adv.advance_installment_amount,0), adv_remaining);
    END IF;
    CONTINUE WHEN adv_deduction <= 0;

    total_deductions := total_deductions + adv_deduction;
    deductions_json := deductions_json || jsonb_build_object(
      'name', 'Advance Repayment' || CASE WHEN adv.note IS NOT NULL THEN ' (' || adv.note || ')' ELSE '' END,
      'amount', adv_deduction);

    UPDATE public.cash_expenses
       SET advance_amount_deducted = coalesce(advance_amount_deducted,0) + adv_deduction,
           advance_status = CASE WHEN (coalesce(advance_amount_deducted,0) + adv_deduction) >= amount
                                 THEN 'paid_off' ELSE 'open' END
     WHERE id = adv.id;
  END LOOP;

  -- 4. F&B staff tab. Only what the salary can cover clears; the rest
  --    carries forward (A39). No reset.
  SELECT coalesce(balance,0) INTO tab_balance
    FROM public.employee_tab_balances WHERE employee_id = p_employee_id;

  IF coalesce(tab_balance,0) > 0 THEN
    affordable := greatest(gross + total_bonuses - total_deductions, 0);
    tab_take := least(tab_balance, affordable);
    IF tab_take > 0 THEN
      total_deductions := total_deductions + tab_take;
      deductions_json := deductions_json || jsonb_build_object('name','Staff Tab','amount',tab_take);

      INSERT INTO public.employee_tab_ledger (employee_id, direction, amount, reference_type, note, created_by_name)
      VALUES (p_employee_id, 'payroll_deduction', tab_take, 'payroll',
              'Settled in payroll ' || v_period, 'Payroll');

      INSERT INTO public.payroll_cash_settlements (employee_id, period, kind, amount, note)
      VALUES (p_employee_id, v_period, 'tab', tab_take,
              CASE WHEN tab_take < tab_balance
                   THEN 'Partly settled; ' || (tab_balance - tab_take) || ' carried forward'
                   ELSE 'Settled in full' END);
    END IF;
  END IF;

  -- 5. unsettled cash, swept per business, Cash Keeper exempt (A37)
  FOR cash_row IN
    SELECT b.brand, b.balance, (k.employee_id IS NOT NULL) AS exempt
    FROM public.employee_cash_balances b
    LEFT JOIN public.employee_cash_keeper_streams k
           ON k.employee_id = b.employee_id AND k.brand = b.brand
    WHERE b.employee_id = p_employee_id AND b.balance > 0
  LOOP
    IF cash_row.exempt THEN
      INSERT INTO public.payroll_cash_settlements (employee_id, period, brand, kind, amount, was_exempt, note)
      VALUES (p_employee_id, v_period, cash_row.brand, 'cash', cash_row.balance, true,
              'Cash Keeper for this business - not deducted');
      CONTINUE;
    END IF;

    affordable := greatest(gross + total_bonuses - total_deductions, 0);
    cash_take := least(cash_row.balance, affordable);
    CONTINUE WHEN cash_take <= 0;

    total_deductions := total_deductions + cash_take;
    deductions_json := deductions_json || jsonb_build_object(
      'name', 'Unsettled Cash (' || cash_row.brand || ')', 'amount', cash_take);

    INSERT INTO public.expense_transactions (
      type, brand, amount, payment_method, from_employee_id, status,
      note, confirmed_by_name, confirmed_at, created_by_name)
    VALUES ('cash_collection', cash_row.brand, cash_take, 'cash', p_employee_id, 'confirmed',
            'Settled in payroll ' || v_period, 'Payroll', now(), 'Payroll');

    INSERT INTO public.payroll_cash_settlements (employee_id, period, brand, kind, amount, note)
    VALUES (p_employee_id, v_period, cash_row.brand, 'cash', cash_take,
            CASE WHEN cash_take < cash_row.balance
                 THEN 'Partly settled; ' || (cash_row.balance - cash_take) || ' still held'
                 ELSE 'Settled in full' END);
  END LOOP;

  INSERT INTO public.payroll_runs (employee_id, period, fixed_salary, variable_salary, deductions, net_total)
  VALUES (p_employee_id, v_period, gross, total_bonuses, deductions_json,
          round(gross + total_bonuses - total_deductions, 2))
  RETURNING * INTO result;

  RETURN result;
END;
$function$;

COMMENT ON FUNCTION public.generate_payslip(uuid,text) IS
  'The only function that commits a payslip. Order A38: rules, adjustments, advances, tab, cash. Guarded against reissuing the same period.';
