-- 0092: monthly salary accrues day by day instead of landing whole on the 1st.
--
-- 'Earned so far' showed a monthly employee their entire salary from the first
-- of the month. Fatma had not signed in once and her page still read 3,600 EGP
-- on the 15th. Hourly staff were already honest - rate times hours worked - so
-- the figure meant two different things depending on how a person was paid.
--
-- Prorated on calendar days elapsed rather than scheduled days worked. Doaa has
-- seven days attended against a roster with none recorded, and proration on
-- scheduled days would have shown her nothing; pay should not depend on a
-- roster being complete. Absence is handled by deduction rules, which is where
-- it belongs.
--
-- Deliberately confined to the accrual view. payslip_gross_v2 is untouched, so
-- a real payslip still pays the full monthly salary, and because the fraction
-- reaches 1 on the last day of the month a payslip for a finished period is
-- identical either way. This changes what is shown, not what is paid.

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
           round(h.scheduled_paid + h.unscheduled_paid,2) AS hrs, round(h.overtime_pending,2) AS ot,
           -- Monthly salary accrues across the month rather than landing whole
           -- on the first. This view is 'earned so far', and a person halfway
           -- through the month has earned about half. Hourly and hybrid pay is
           -- already earned as it is worked, so only the monthly branch is
           -- prorated.
           --
           -- Prorated on calendar days elapsed, not on scheduled days: Doaa has
           -- seven days attended against a roster with none recorded, so
           -- scheduled days would have paid her nothing. Pay should not depend
           -- on a roster being complete.
           --
           -- On the last day of the month the fraction is 1, so a payslip for a
           -- finished period is unchanged. payslip_gross_v2 itself is untouched,
           -- so an actual payslip still pays the full salary - this affects
           -- what is displayed as accrued, never what is paid.
           CASE
             WHEN NOT e.enable_hybrid_variable_pay AND coalesce(e.hourly_rate,0) = 0
             THEN round(public.payslip_gross_v2(e.id,v_period) * (
                    (least(current_date, (to_date(v_period||'-01','YYYY-MM-DD') + interval '1 month - 1 day')::date)
                      - to_date(v_period||'-01','YYYY-MM-DD') + 1)::numeric
                    / EXTRACT(DAY FROM (to_date(v_period||'-01','YYYY-MM-DD') + interval '1 month - 1 day'))::numeric
                  ), 2)
             ELSE public.payslip_gross_v2(e.id,v_period)
           END AS g,
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
END; $function$
;