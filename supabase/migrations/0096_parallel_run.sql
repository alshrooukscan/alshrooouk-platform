-- =====================================================================
-- 0096 · The parallel run  (client answer Q10: "lets make Sep as the
-- trial month")
--
-- A trial run has to produce the real number without any of the real
-- consequences. generate_payslip repays advances, clears the staff tab
-- and sweeps cash the moment it is called, so running it "just to see"
-- would settle a month nobody has agreed yet.
--
-- payroll_trial_run does the same arithmetic and writes nothing. It is
-- STABLE, so the database itself refuses to let it modify anything.
-- =====================================================================

ALTER TABLE public.payroll_settings
  ADD COLUMN IF NOT EXISTS trial_period text;

COMMENT ON COLUMN public.payroll_settings.trial_period IS
  'The month being run in parallel with the manual payroll. A payslip '
  'cannot be committed for this period: the whole point is that the system '
  'is not the record yet, and a trial that can quietly become the record is '
  'not a trial.';

UPDATE public.payroll_settings SET trial_period = '2026-09' WHERE id;

-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.payroll_trial_run(p_period text)
RETURNS TABLE(
  employee_id uuid, employee_name text, hr_id text, pay_basis text,
  paid_days int, unscheduled_days int, absent_days int, needs_review int,
  paid_hours numeric, overtime_hours numeric,
  gross numeric, scan_commission numeric, report_bonus numeric,
  bonuses numeric, rule_deductions numeric, penalty_deductions numeric,
  penalty_cap numeric, deferred_to_next numeric,
  open_advances numeric, tab_balance numeric, cash_held numeric,
  indicative_net numeric, flags text)
LANGUAGE plpgsql STABLE AS $$
DECLARE
  v_period text := public.payroll_period_normalize(p_period);
  v_cap_pct numeric;
BEGIN
  SELECT penalty_cap_percent INTO v_cap_pct FROM payroll_settings WHERE id;
  v_cap_pct := coalesce(v_cap_pct, 25);

  RETURN QUERY
  WITH base AS (
    SELECT e.id, e.name, e.hr_id,
           CASE WHEN e.enable_hybrid_variable_pay THEN 'hybrid'
                WHEN coalesce(e.hourly_rate,0) > 0 THEN 'hourly' ELSE 'monthly' END AS basis,
           h.paid_days, h.unscheduled_days, h.absent_days, h.needs_review,
           round(h.scheduled_paid + h.unscheduled_paid, 2) AS hrs,
           round(h.overtime_pending, 2) AS ot,
           public.payslip_gross_v2(e.id, v_period) AS g,
           coalesce((SELECT sum(c.commission)
                     FROM public.employee_scan_commission_days(e.id, v_period) c), 0) AS comm,
           coalesce((SELECT rb.bonus FROM public.employee_report_bonus(e.id, v_period) rb), 0) AS rbonus,
           coalesce((SELECT sum(a.amount) FROM payroll_adjustments a
                     WHERE a.employee_id = e.id AND a.kind = 'bonus'
                       AND public.payroll_period_normalize(a.period) = v_period), 0) AS bon,
           coalesce((SELECT sum(coalesce(era.amount, dr.value))
                     FROM employee_rule_assignments era
                     JOIN deduction_rules dr ON dr.id = era.deduction_rule_id
                     WHERE era.employee_id = e.id
                       AND (era.amount IS NULL OR era.status = 'active')), 0) AS rules,
           coalesce((SELECT sum(a.amount) FROM payroll_adjustments a
                     WHERE a.employee_id = e.id AND a.kind = 'deduction'
                       AND public.payroll_period_normalize(a.period) = v_period), 0) AS pen,
           coalesce((SELECT sum(ce.amount - coalesce(ce.advance_amount_deducted,0))
                     FROM cash_expenses ce
                     WHERE ce.employee_id = e.id AND ce.category = 'employee_advance'
                       AND ce.advance_status = 'open'), 0) AS adv,
           coalesce((SELECT greatest(tb.balance,0) FROM employee_tab_balances tb
                     WHERE tb.employee_id = e.id), 0) AS tab,
           -- cash the sweep would take, ignoring streams they keep by skill
           coalesce((SELECT sum(b.balance) FROM employee_cash_balances b
                     WHERE b.employee_id = e.id AND b.balance > 0
                       AND NOT EXISTS (SELECT 1 FROM employee_cash_keeper_streams k
                                       WHERE k.employee_id = b.employee_id AND k.brand = b.brand)), 0) AS cash,
           e.acknowledgement_on_file AS ack
    FROM employees e
    CROSS JOIN LATERAL public.payslip_hours(e.id, v_period) h
    WHERE e.is_active
  ), capped AS (
    SELECT b.*,
           (b.g + b.rbonus + b.bon) AS earned,
           round((b.g + b.rbonus + b.bon) * v_cap_pct / 100.0, 2) AS cap
    FROM base b
  )
  SELECT c.id, c.name, c.hr_id, c.basis,
         c.paid_days, c.unscheduled_days, c.absent_days, c.needs_review,
         c.hrs, c.ot,
         round(c.g,2), round(c.comm,2), round(c.rbonus,2), round(c.bon,2),
         round(c.rules,2),
         round(least(c.pen, greatest(c.cap - c.rules, 0)),2),
         c.cap,
         round(greatest(c.pen - greatest(c.cap - c.rules, 0), 0),2),
         round(c.adv,2), round(c.tab,2), round(c.cash,2),
         round(c.earned - c.rules - least(c.pen, greatest(c.cap - c.rules, 0))
               - c.adv - c.tab - c.cash, 2),
         btrim(concat_ws(' · ',
           CASE WHEN c.needs_review > 0 THEN c.needs_review || ' day(s) need an attendance decision' END,
           CASE WHEN c.ot > 0 THEN c.ot || ' overtime hour(s) undecided' END,
           CASE WHEN c.pen > greatest(c.cap - c.rules,0) THEN 'cap reached, part carries to next month' END,
           CASE WHEN c.cash > 0 THEN 'holding cash the sweep would take' END,
           CASE WHEN NOT c.ack THEN 'no signed acknowledgement' END))
  FROM capped c
  ORDER BY c.name;
END; $$;

-- ---------------------------------------------------------------------
-- The trial month cannot be committed. A parallel run that can quietly
-- become the record is not a parallel run.
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.payroll_block_trial_commit()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE v_trial text;
BEGIN
  SELECT trial_period INTO v_trial FROM payroll_settings WHERE id;
  IF v_trial IS NOT NULL
     AND public.payroll_period_normalize(NEW.period) = public.payroll_period_normalize(v_trial) THEN
    RAISE EXCEPTION
      '% is the trial month. Run it in parallel and compare it against the manual payroll; clear the trial month in payroll settings before committing it for real.', v_trial;
  END IF;
  RETURN NEW;
END; $$;

DROP TRIGGER IF EXISTS trg_block_trial_commit ON public.payroll_runs;
CREATE TRIGGER trg_block_trial_commit
  BEFORE INSERT ON public.payroll_runs
  FOR EACH ROW EXECUTE FUNCTION public.payroll_block_trial_commit();

REVOKE EXECUTE ON FUNCTION public.payroll_trial_run(text) FROM anon, PUBLIC;
GRANT EXECUTE ON FUNCTION public.payroll_trial_run(text) TO service_role;

-- The trial must mirror generate_payslip exactly, or it is worth nothing.
-- The first version subtracted the full cash balance and produced a net of
-- minus 2,170 for Doaa. The real engine never takes more cash than the
-- payslip can afford: the remainder stays with the employee, because they
-- are physically holding it and a payslip cannot claw back money it never
-- had. A trial that does not match the engine is worse than no trial.
CREATE OR REPLACE FUNCTION public.payroll_trial_run(p_period text)
RETURNS TABLE(
  employee_id uuid, employee_name text, hr_id text, pay_basis text,
  paid_days int, unscheduled_days int, absent_days int, needs_review int,
  paid_hours numeric, overtime_hours numeric,
  gross numeric, scan_commission numeric, report_bonus numeric,
  bonuses numeric, rule_deductions numeric, penalty_deductions numeric,
  penalty_cap numeric, deferred_to_next numeric,
  advance_taken numeric, tab_taken numeric, cash_swept numeric,
  still_held numeric, indicative_net numeric, flags text)
LANGUAGE plpgsql STABLE AS $$
DECLARE v_period text := public.payroll_period_normalize(p_period); v_cap_pct numeric;
BEGIN
  SELECT coalesce(penalty_cap_percent,25) INTO v_cap_pct FROM payroll_settings WHERE id;
  RETURN QUERY
  WITH base AS (
    SELECT e.id, e.name, e.hr_id, e.acknowledgement_on_file AS ack,
           CASE WHEN e.enable_hybrid_variable_pay THEN 'hybrid'
                WHEN coalesce(e.hourly_rate,0) > 0 THEN 'hourly' ELSE 'monthly' END AS basis,
           h.paid_days, h.unscheduled_days, h.absent_days, h.needs_review,
           round(h.scheduled_paid + h.unscheduled_paid,2) AS hrs, round(h.overtime_pending,2) AS ot,
           public.payslip_gross_v2(e.id,v_period) AS g,
           coalesce((SELECT sum(c.commission) FROM public.employee_scan_commission_days(e.id,v_period) c),0) AS comm,
           coalesce((SELECT rb.bonus FROM public.employee_report_bonus(e.id,v_period) rb),0) AS rbonus,
           coalesce((SELECT sum(a.amount) FROM payroll_adjustments a WHERE a.employee_id=e.id
                     AND a.kind='bonus' AND public.payroll_period_normalize(a.period)=v_period),0) AS bon,
           coalesce((SELECT sum(coalesce(era.amount,dr.value)) FROM employee_rule_assignments era
                     JOIN deduction_rules dr ON dr.id=era.deduction_rule_id
                     WHERE era.employee_id=e.id AND (era.amount IS NULL OR era.status='active')),0) AS rules,
           coalesce((SELECT sum(a.amount) FROM payroll_adjustments a WHERE a.employee_id=e.id
                     AND a.kind='deduction' AND public.payroll_period_normalize(a.period)=v_period),0) AS pen,
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
           CASE WHEN NOT c.ack THEN 'no signed acknowledgement' END))
  FROM c3 c ORDER BY c.name;
END; $$;
REVOKE EXECUTE ON FUNCTION public.payroll_trial_run(text) FROM anon, PUBLIC;
GRANT EXECUTE ON FUNCTION public.payroll_trial_run(text) TO service_role;
