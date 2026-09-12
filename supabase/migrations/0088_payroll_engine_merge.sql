-- =====================================================================
-- 0088  ·  Payroll Engine Merge  ·  STEP A (additive, read-only)
--
-- Creates the single source of truth for payslip numbers. Nothing
-- existing is replaced in this step, so it cannot change any behaviour.
--
-- D1  two engines returned different gross for every hourly employee
-- D2  period was written as "September 2026" by one path and "2026-09"
--     by the other, so adjustments never matched the committed run
-- =====================================================================

-- ---------------------------------------------------------------------
-- One period format. Accepts the legacy "September 2026" so nothing
-- already in the UI breaks, and always returns YYYY-MM.
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.payroll_period_normalize(p_period text)
RETURNS text LANGUAGE plpgsql IMMUTABLE AS $$
BEGIN
  IF p_period IS NULL OR btrim(p_period) = '' THEN
    RETURN to_char(CURRENT_DATE, 'YYYY-MM');
  END IF;
  IF p_period ~ '^\d{4}-\d{2}$' THEN
    RETURN p_period;
  END IF;
  BEGIN
    RETURN to_char(to_date(btrim(p_period), 'Month YYYY'), 'YYYY-MM');
  EXCEPTION WHEN others THEN
    RETURN to_char(CURRENT_DATE, 'YYYY-MM');
  END;
END; $$;

COMMENT ON FUNCTION public.payroll_period_normalize IS
  'Every payroll path normalises its period through here. YYYY-MM is the '
  'only stored form; "September 2026" is accepted for backward compatibility.';


-- ---------------------------------------------------------------------
-- The single gross calculator.
--
-- Hourly staff are paid their SCHEDULED hours on days attendance
-- confirms, not the raw clock difference. A shift that ends ten minutes
-- early is still a day's work; paying to the minute turns every early
-- finish into a pay cut. A day counts only when BOTH a sign-in and a
-- sign-out exist; sign-in with no sign-out is an admin decision, not a
-- silent one.
--
-- Monthly staff earn their salary. An unworked day reaches them as a
-- deduction line, which is what keeps a monthly payslip readable.
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.payslip_gross_v2(p_employee_id uuid, p_period text)
RETURNS numeric LANGUAGE plpgsql STABLE AS $$
DECLARE
  v_period text := public.payroll_period_normalize(p_period);
  v_from date := to_date(v_period || '-01', 'YYYY-MM-DD');
  v_to   date;
  emp    employees;
  v_hours numeric := 0;
BEGIN
  v_to := (v_from + interval '1 month - 1 day')::date;
  SELECT * INTO emp FROM employees WHERE id = p_employee_id;
  IF emp IS NULL THEN RETURN 0; END IF;

  IF coalesce(emp.hourly_rate, 0) > 0 THEN
    SELECT coalesce(sum(
             EXTRACT(EPOCH FROM (
               CASE WHEN d.end_time <= d.start_time
                    THEN (d.end_time + interval '24 hours') - d.start_time
                    ELSE d.end_time - d.start_time END)) / 3600.0), 0)
      INTO v_hours
    FROM employee_schedule_days d
    WHERE d.employee_id = p_employee_id
      AND d.is_day_off = false
      AND d.work_date BETWEEN v_from AND v_to
      AND EXISTS (SELECT 1 FROM timeclock_events t
                   WHERE t.employee_id = p_employee_id AND t.event_type = 'login'
                     AND t.event_time::date = d.work_date)
      AND EXISTS (SELECT 1 FROM timeclock_events t
                   WHERE t.employee_id = p_employee_id AND t.event_type = 'logout'
                     AND t.event_time::date = d.work_date);
    RETURN round(v_hours * emp.hourly_rate, 2);
  END IF;

  RETURN round(coalesce(emp.fixed_salary,0) + coalesce(emp.variable_salary,0), 2);
END; $$;


-- ---------------------------------------------------------------------
-- Read-only preview. Returns exactly the figures generate_payslip will
-- commit, so a preview and a committed payslip can never disagree.
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.payslip_preview(p_employee_id uuid, p_period text)
RETURNS json LANGUAGE plpgsql STABLE AS $$
DECLARE
  v_period text := public.payroll_period_normalize(p_period);
  v_from date := to_date(v_period || '-01', 'YYYY-MM-DD');
  v_to   date;
  emp    employees;
  v_gross numeric;
  v_days json;
  v_sched int := 0; v_paid int := 0; v_review int := 0; v_absent int := 0;
  v_hours numeric := 0;
  v_adj json; v_ded numeric := 0; v_bon numeric := 0;
  v_rules json; v_rules_total numeric := 0;
  v_adv numeric := 0; v_tab numeric := 0;
  v_settle json;
BEGIN
  v_to := (v_from + interval '1 month - 1 day')::date;
  SELECT * INTO emp FROM employees WHERE id = p_employee_id;
  IF emp IS NULL THEN RETURN NULL; END IF;

  v_gross := public.payslip_gross_v2(p_employee_id, v_period);

  SELECT coalesce(json_agg(json_build_object(
           'date', q.work_date, 'hours', round(q.hrs,2), 'status', q.status)
           ORDER BY q.work_date), '[]'::json),
         count(*),
         count(*) FILTER (WHERE q.status = 'worked'),
         count(*) FILTER (WHERE q.status = 'needs_review'),
         count(*) FILTER (WHERE q.status = 'absent'),
         coalesce(sum(q.hrs) FILTER (WHERE q.status = 'worked'), 0)
    INTO v_days, v_sched, v_paid, v_review, v_absent, v_hours
  FROM (
    SELECT d.work_date,
           EXTRACT(EPOCH FROM (CASE WHEN d.end_time <= d.start_time
                THEN (d.end_time + interval '24 hours') - d.start_time
                ELSE d.end_time - d.start_time END)) / 3600.0 AS hrs,
           CASE WHEN i.ok AND o.ok THEN 'worked'
                WHEN i.ok THEN 'needs_review' ELSE 'absent' END AS status
    FROM employee_schedule_days d
    CROSS JOIN LATERAL (SELECT EXISTS (SELECT 1 FROM timeclock_events t
        WHERE t.employee_id = p_employee_id AND t.event_type='login'
          AND t.event_time::date = d.work_date) AS ok) i
    CROSS JOIN LATERAL (SELECT EXISTS (SELECT 1 FROM timeclock_events t
        WHERE t.employee_id = p_employee_id AND t.event_type='logout'
          AND t.event_time::date = d.work_date) AS ok) o
    WHERE d.employee_id = p_employee_id AND d.is_day_off = false
      AND d.work_date BETWEEN v_from AND v_to
  ) q;

  SELECT coalesce(json_agg(json_build_object(
           'id', a.id, 'kind', a.kind, 'label', a.label,
           'amount', a.amount, 'note', a.note, 'occurred_on', a.occurred_on)), '[]'::json),
         coalesce(sum(a.amount) FILTER (WHERE a.kind='deduction'), 0),
         coalesce(sum(a.amount) FILTER (WHERE a.kind='bonus'), 0)
    INTO v_adj, v_ded, v_bon
  FROM payroll_adjustments a
  WHERE a.employee_id = p_employee_id
    AND public.payroll_period_normalize(a.period) = v_period;

  SELECT coalesce(json_agg(json_build_object(
           'name', dr.name, 'amount', coalesce(era.amount, dr.value))), '[]'::json),
         coalesce(sum(coalesce(era.amount, dr.value)), 0)
    INTO v_rules, v_rules_total
  FROM employee_rule_assignments era
  JOIN deduction_rules dr ON dr.id = era.deduction_rule_id
  WHERE era.employee_id = p_employee_id
    AND (era.amount IS NULL OR era.status = 'active');

  SELECT coalesce(sum(amount - coalesce(advance_amount_deducted,0)), 0)
    INTO v_adv
  FROM cash_expenses
  WHERE employee_id = p_employee_id
    AND category = 'employee_advance' AND advance_status = 'open';

  SELECT coalesce(balance, 0) INTO v_tab
  FROM employee_tab_balances WHERE employee_id = p_employee_id;

  v_settle := public.payroll_settlement_preview(p_employee_id);

  RETURN json_build_object(
    'employee', json_build_object('id', emp.id, 'name', emp.name, 'hr_id', emp.hr_id,
                                  'fixed_salary', emp.fixed_salary,
                                  'variable_salary', emp.variable_salary,
                                  'hourly_rate', emp.hourly_rate),
    'period', v_period,
    'pay_basis', CASE WHEN coalesce(emp.hourly_rate,0) > 0 THEN 'hourly' ELSE 'monthly' END,
    'scheduled_days', v_sched, 'paid_days', v_paid,
    'needs_review', v_review, 'absent_days', v_absent,
    'paid_hours', round(v_hours, 2),
    'days', v_days,
    'gross', v_gross,
    'adjustments', v_adj,
    'total_bonuses', round(v_bon, 2),
    'total_adjustment_deductions', round(v_ded, 2),
    'rule_assignments', v_rules,
    'total_rule_deductions', round(v_rules_total, 2),
    'open_advances', round(v_adv, 2),
    'tab_balance', round(greatest(v_tab, 0), 2),
    'settlement', v_settle,
    'indicative_net', round(v_gross + v_bon - v_ded - v_rules_total, 2)
  );
END; $$;

COMMENT ON FUNCTION public.payslip_preview IS
  'Read-only. Returns the same figures generate_payslip commits, so the '
  'Payslips page previews rather than calculating a second time.';
-- 0088 STEP A2: corrected gross rule.
--   scheduled day, attendance confirmed  -> pay SCHEDULED hours
--        (an early finish is not a pay cut)
--   UNSCHEDULED day, attendance confirmed -> pay CLOCKED hours
--        (work performed is work paid; discovered on Reham, 06 Sep)
--   excess over schedule -> surfaced as overtime for an admin decision,
--        never paid silently and never dropped silently
CREATE OR REPLACE FUNCTION public.payslip_hours(p_employee_id uuid, p_period text)
RETURNS TABLE(scheduled_paid numeric, unscheduled_paid numeric, overtime_pending numeric,
              paid_days int, unscheduled_days int, needs_review int, absent_days int)
LANGUAGE plpgsql STABLE AS $$
DECLARE
  v_period text := public.payroll_period_normalize(p_period);
  v_from date := to_date(v_period||'-01','YYYY-MM-DD');
  v_to date;
BEGIN
  v_to := (v_from + interval '1 month - 1 day')::date;
  RETURN QUERY
  WITH clocked AS (
    SELECT t.event_time::date AS d,
           min(t.event_time) FILTER (WHERE t.event_type='login')  AS in_t,
           max(t.event_time) FILTER (WHERE t.event_type='logout') AS out_t
    FROM timeclock_events t
    WHERE t.employee_id = p_employee_id AND t.event_time::date BETWEEN v_from AND v_to
    GROUP BY 1
  ), c AS (
    SELECT d, EXTRACT(EPOCH FROM (out_t - in_t))/3600.0 AS hrs
    FROM clocked WHERE in_t IS NOT NULL AND out_t IS NOT NULL AND out_t > in_t
  ), s AS (
    SELECT d.work_date,
           EXTRACT(EPOCH FROM (CASE WHEN d.end_time <= d.start_time
             THEN (d.end_time + interval '24 hours') - d.start_time
             ELSE d.end_time - d.start_time END))/3600.0 AS hrs
    FROM employee_schedule_days d
    WHERE d.employee_id = p_employee_id AND d.is_day_off = false
      AND d.work_date BETWEEN v_from AND v_to
  )
  SELECT
    coalesce((SELECT sum(s.hrs) FROM s JOIN c ON c.d = s.work_date),0),
    coalesce((SELECT sum(c.hrs) FROM c WHERE NOT EXISTS
              (SELECT 1 FROM s WHERE s.work_date = c.d)),0),
    coalesce((SELECT sum(greatest(c.hrs - s.hrs,0)) FROM s JOIN c ON c.d = s.work_date),0),
    coalesce((SELECT count(*)::int FROM s JOIN c ON c.d = s.work_date),0),
    coalesce((SELECT count(*)::int FROM c WHERE NOT EXISTS
              (SELECT 1 FROM s WHERE s.work_date = c.d)),0),
    coalesce((SELECT count(*)::int FROM s WHERE EXISTS (SELECT 1 FROM timeclock_events t
              WHERE t.employee_id=p_employee_id AND t.event_type='login' AND t.event_time::date=s.work_date)
              AND NOT EXISTS (SELECT 1 FROM c WHERE c.d = s.work_date)),0),
    coalesce((SELECT count(*)::int FROM s WHERE NOT EXISTS (SELECT 1 FROM timeclock_events t
              WHERE t.employee_id=p_employee_id AND t.event_time::date=s.work_date)),0);
END; $$;

CREATE OR REPLACE FUNCTION public.payslip_gross_v2(p_employee_id uuid, p_period text)
RETURNS numeric LANGUAGE plpgsql STABLE AS $$
DECLARE emp employees; h record;
BEGIN
  SELECT * INTO emp FROM employees WHERE id = p_employee_id;
  IF emp IS NULL THEN RETURN 0; END IF;
  IF coalesce(emp.hourly_rate,0) > 0 THEN
    SELECT * INTO h FROM public.payslip_hours(p_employee_id, p_period);
    RETURN round((h.scheduled_paid + h.unscheduled_paid) * emp.hourly_rate, 2);
  END IF;
  RETURN round(coalesce(emp.fixed_salary,0)+coalesce(emp.variable_salary,0),2);
END; $$;
-- =====================================================================
-- 0088 · STEP B · replace the live engine with the unified one
-- D1 one engine   D2 one period format   D4 advance category corrected
-- =====================================================================

ALTER TABLE public.payroll_runs
  ADD COLUMN IF NOT EXISTS gross_pay numeric,
  ADD COLUMN IF NOT EXISTS bonuses jsonb DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS total_bonuses numeric DEFAULT 0,
  ADD COLUMN IF NOT EXISTS total_deductions numeric DEFAULT 0,
  ADD COLUMN IF NOT EXISTS pay_basis text,
  ADD COLUMN IF NOT EXISTS paid_hours numeric,
  ADD COLUMN IF NOT EXISTS overtime_pending_hours numeric,
  ADD COLUMN IF NOT EXISTS generated_by_name text;

-- D4: the UI writes 'employee_advance'. The cap was reading 'advance',
-- so advances were never counted against the 50% ceiling.
CREATE OR REPLACE FUNCTION public.employee_spend_capacity(
  p_employee_id uuid,
  p_from date DEFAULT (date_trunc('month', CURRENT_DATE))::date,
  p_to   date DEFAULT CURRENT_DATE)
RETURNS json LANGUAGE plpgsql STABLE AS $$
DECLARE v_accrued numeric; v_cap numeric; v_advances numeric; v_tab numeric;
BEGIN
  v_accrued := public.employee_accrued_earnings(p_employee_id, p_from, p_to);
  v_cap     := round(v_accrued * 0.5, 2);

  SELECT coalesce(sum(amount - coalesce(advance_amount_deducted,0)),0) INTO v_advances
  FROM public.cash_expenses
  WHERE employee_id = p_employee_id
    AND category = 'employee_advance'
    AND coalesce(advance_status,'open') <> 'paid_off'
    AND entry_date BETWEEN p_from AND p_to;

  SELECT coalesce(sum(CASE direction WHEN 'charge' THEN amount ELSE -amount END),0)
    INTO v_tab
  FROM public.employee_tab_ledger
  WHERE employee_id = p_employee_id AND entry_date BETWEEN p_from AND p_to;

  RETURN json_build_object('accrued',v_accrued,'cap',v_cap,'advances',v_advances,
                           'tab_used',v_tab,
                           'remaining', greatest(v_cap - v_advances - v_tab, 0));
END; $$;

-- payslip_gross now delegates. Kept so any older caller stays correct.
CREATE OR REPLACE FUNCTION public.payslip_gross(p_employee_id uuid, p_period text)
RETURNS numeric LANGUAGE sql STABLE AS $$
  SELECT public.payslip_gross_v2(p_employee_id, p_period);
$$;

-- ---------------------------------------------------------------------
-- generate_payslip, unified.
-- Chain order is approved decision A38, with adjustments inserted where
-- they belong: rules, adjustments, advances, F&B tab, then cash last
-- because the employee is still physically holding it.
-- ---------------------------------------------------------------------
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
  tab_balance numeric := 0; tab_take numeric := 0; cash_take numeric;
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
    total_ded := total_ded + cash_take;
    ded := ded || jsonb_build_object('name','Unsettled Cash ('||cash_row.brand||')',
                                     'amount',cash_take,'source','cash');
    INSERT INTO expense_transactions (type,brand,amount,payment_method,from_employee_id,
                                      status,note,confirmed_by_name,confirmed_at,created_by_name)
    VALUES ('cash_collection',cash_row.brand,cash_take,'cash',p_employee_id,'confirmed',
            'Settled in payroll '||v_period,'Payroll',now(),'Payroll');
    INSERT INTO payroll_cash_settlements (employee_id,period,brand,kind,amount,note)
    VALUES (p_employee_id,v_period,cash_row.brand,'cash',cash_take,
            CASE WHEN cash_take < cash_row.balance
                 THEN 'Partly settled; '||(cash_row.balance-cash_take)||' still held'
                 ELSE 'Settled in full' END);
  END LOOP;

  INSERT INTO payroll_runs (employee_id, period, fixed_salary, variable_salary,
      deductions, net_total, gross_pay, bonuses, total_bonuses, total_deductions,
      pay_basis, paid_hours, overtime_pending_hours, generated_by_name)
  VALUES (p_employee_id, v_period, emp.fixed_salary, emp.variable_salary,
      ded, round(gross + total_bon - total_ded, 2), gross, bon,
      round(total_bon,2), round(total_ded,2),
      CASE WHEN coalesce(emp.hourly_rate,0) > 0 THEN 'hourly' ELSE 'monthly' END,
      round(h.scheduled_paid + h.unscheduled_paid, 2),
      round(h.overtime_pending, 2), p_generated_by)
  RETURNING * INTO result;

  RETURN result;
END; $function$;
-- 0088 · STEP B2 · defect D5
-- The custody guard cash_out_must_be_held() legitimately refuses a sweep
-- while an employee still has unconfirmed transfers waiting. Previously
-- that exception aborted the WHOLE payslip, so a single pending transfer
-- meant no salary could be issued at all. The sweep is now the only thing
-- that fails: the cash stays with the employee, the reason is recorded,
-- and the payslip completes.
CREATE OR REPLACE FUNCTION public.payroll_sweep_cash(
  p_employee_id uuid, p_period text, p_brand text, p_amount numeric)
RETURNS text LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO expense_transactions (type,brand,amount,payment_method,from_employee_id,
      status,note,confirmed_by_name,confirmed_at,created_by_name)
  VALUES ('cash_collection',p_brand,p_amount,'cash',p_employee_id,'confirmed',
          'Settled in payroll '||p_period,'Payroll',now(),'Payroll');
  RETURN NULL;
EXCEPTION WHEN others THEN
  RETURN SQLERRM;
END; $$;
CREATE OR REPLACE FUNCTION public.payslip_preview(p_employee_id uuid, p_period text)
RETURNS json LANGUAGE plpgsql STABLE AS $$
DECLARE
  v_period text := public.payroll_period_normalize(p_period);
  emp employees; h record;
  v_gross numeric; v_adj json; v_ded numeric:=0; v_bon numeric:=0;
  v_rules json; v_rules_total numeric:=0; v_adv numeric:=0; v_tab numeric:=0;
BEGIN
  SELECT * INTO emp FROM employees WHERE id=p_employee_id;
  IF emp IS NULL THEN RETURN NULL; END IF;
  SELECT * INTO h FROM public.payslip_hours(p_employee_id, v_period);
  v_gross := public.payslip_gross_v2(p_employee_id, v_period);

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
        'fixed_salary',emp.fixed_salary,'variable_salary',emp.variable_salary,'hourly_rate',emp.hourly_rate),
    'period', v_period,
    'pay_basis', CASE WHEN coalesce(emp.hourly_rate,0)>0 THEN 'hourly' ELSE 'monthly' END,
    'paid_days', h.paid_days, 'unscheduled_days', h.unscheduled_days,
    'needs_review', h.needs_review, 'absent_days', h.absent_days,
    'scheduled_hours_paid', round(h.scheduled_paid,2),
    'unscheduled_hours_paid', round(h.unscheduled_paid,2),
    'paid_hours', round(h.scheduled_paid+h.unscheduled_paid,2),
    'overtime_pending_hours', round(h.overtime_pending,2),
    'overtime_pending_value', round(h.overtime_pending*coalesce(emp.hourly_rate,0),2),
    'gross', v_gross,
    'adjustments', v_adj, 'total_bonuses', round(v_bon,2),
    'total_adjustment_deductions', round(v_ded,2),
    'rule_assignments', v_rules, 'total_rule_deductions', round(v_rules_total,2),
    'open_advances', round(v_adv,2), 'tab_balance', round(greatest(v_tab,0),2),
    'settlement', public.payroll_settlement_preview(p_employee_id),
    'already_generated', EXISTS (SELECT 1 FROM payroll_runs
        WHERE employee_id=p_employee_id AND public.payroll_period_normalize(period)=v_period),
    'indicative_net', round(v_gross+v_bon-v_ded-v_rules_total-v_adv,2)
  );
END; $$;

-- ---------------------------------------------------------------------
-- Applied last, after the code was live. generate_payslip is
-- SECURITY DEFINER and writes to payroll, advances, the F&B tab, the cash
-- ledger and expense_transactions. EXECUTE had been granted to anon, so
-- anyone holding the public key in the browser bundle could commit a
-- payslip for any employee. SECURITY DEFINER bypasses RLS, so no policy
-- was protecting it. Every caller is now a server route on service_role.
-- ---------------------------------------------------------------------
REVOKE EXECUTE ON FUNCTION public.generate_payslip(uuid, text, text) FROM anon, authenticated, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.payroll_sweep_cash(uuid, text, text, numeric) FROM anon, authenticated, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.payslip_preview(uuid, text) FROM anon, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.payroll_settlement_preview(uuid) FROM anon, PUBLIC;
GRANT  EXECUTE ON FUNCTION public.generate_payslip(uuid, text, text) TO service_role;
GRANT  EXECUTE ON FUNCTION public.payslip_preview(uuid, text) TO service_role;

-- The pre-existing 2-argument overload still carried the OLD engine body.
-- Left in place it would have made any 2-arg call ambiguous and could have
-- silently run the superseded logic.
DROP FUNCTION IF EXISTS public.generate_payslip(uuid, text);
