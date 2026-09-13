-- =====================================================================
-- 0095 · Step 3b · the deduction engine
--
-- Every automatic deduction in the client's specification funnels through
-- one queue and one approval. Nothing posts to a payslip on its own.
--
-- Client answers this implements:
--   Q1  Visa liability applies from go-live onward, not retroactively
--   Q5  stock liability sits with whoever holds the admin skill that day
--   Q6  "No variance 0%"
--   Q7  short-notice leave at a ratio set per person
-- Stated positions: named approver, 25% cap with carry-forward, cost
-- price for stock, 48 hour dispute window.
-- =====================================================================

CREATE TABLE IF NOT EXISTS public.payroll_settings (
  id boolean PRIMARY KEY DEFAULT true CHECK (id),
  deduction_go_live date,
  visa_grace_hours integer NOT NULL DEFAULT 72,
  penalty_cap_percent numeric(5,2) NOT NULL DEFAULT 25,
  dispute_window_hours integer NOT NULL DEFAULT 48,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by_name text
);
INSERT INTO public.payroll_settings (id) VALUES (true) ON CONFLICT (id) DO NOTHING;

COMMENT ON COLUMN public.payroll_settings.deduction_go_live IS
  'Client answer Q1: deductions apply from go-live onward. While this is '
  'NULL no detector produces anything, which is what keeps the engine inert '
  'until someone deliberately starts it.';

-- Whether this person has signed the pay and deduction acknowledgement.
-- It does not block anything. It means that when a deduction is disputed,
-- the record shows whether they had signed at the time.
ALTER TABLE public.employees
  ADD COLUMN IF NOT EXISTS acknowledgement_on_file boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS acknowledgement_signed_on date;

-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.payroll_deductions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id uuid NOT NULL REFERENCES public.employees(id),
  period text NOT NULL,
  kind text NOT NULL CHECK (kind IN ('visa','stock','leave')),
  amount numeric(12,2) NOT NULL CHECK (amount > 0),
  reason text NOT NULL,
  source_table text,
  source_id uuid,
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','approved','rejected','reversed','carried_forward')),
  adjustment_id uuid REFERENCES public.payroll_adjustments(id) ON DELETE SET NULL,
  approved_by_id uuid,
  approved_by_name text,
  approved_at timestamptz,
  decision_note text,
  acknowledgement_on_file boolean,      -- frozen at approval, not read later
  detected_at timestamptz NOT NULL DEFAULT now(),
  dispute_deadline timestamptz,
  carried_from_period text
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_payroll_deduction_source
  ON public.payroll_deductions (kind, source_id) WHERE source_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_payroll_deductions_queue
  ON public.payroll_deductions (status, period, employee_id);

ALTER TABLE public.payroll_deductions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS staff_all ON public.payroll_deductions;
CREATE POLICY staff_all ON public.payroll_deductions FOR ALL TO authenticated USING (true) WITH CHECK (true);

COMMENT ON TABLE public.payroll_deductions IS
  'One queue for every automatically detected deduction. Detection is not a '
  'decision: a row here costs nobody anything until a named person approves '
  'it, and approval is what writes the frozen payroll_adjustments line.';

-- ---------------------------------------------------------------------
-- What one day of this person is worth, used by the leave detector.
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.employee_day_value(p_employee_id uuid, p_on date)
RETURNS numeric LANGUAGE plpgsql STABLE AS $$
DECLARE emp employees; v_hours numeric;
BEGIN
  SELECT * INTO emp FROM employees WHERE id = p_employee_id;
  IF emp IS NULL THEN RETURN 0; END IF;

  IF emp.enable_hybrid_variable_pay THEN
    RETURN round(coalesce(emp.shift_baseline_value,0), 2);
  END IF;

  IF coalesce(emp.hourly_rate,0) > 0 THEN
    SELECT EXTRACT(EPOCH FROM (CASE WHEN d.end_time <= d.start_time
             THEN (d.end_time + interval '24 hours') - d.start_time
             ELSE d.end_time - d.start_time END))/3600.0
      INTO v_hours
    FROM employee_schedule_days d
    WHERE d.employee_id = p_employee_id AND d.work_date = p_on AND d.is_day_off = false;
    RETURN round(coalesce(v_hours, 8) * emp.hourly_rate, 2);
  END IF;

  RETURN round((coalesce(emp.fixed_salary,0)+coalesce(emp.variable_salary,0))/30.0, 2);
END; $$;

-- ---------------------------------------------------------------------
-- Detector 1 · unconfirmed card payments.
--
-- Forward-only from go-live, per the client's answer. Only payments the
-- gateway has had the full grace window to confirm are considered, because
-- settlement is not instantaneous and deducting on the same day would
-- manufacture false positives. A payment with no recorded author is
-- skipped rather than assigned: two of the historical seventeen came from
-- the bulk import and belong to nobody.
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.detect_visa_deductions()
RETURNS TABLE(created int, skipped_no_author int)
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE s payroll_settings; v_created int := 0; v_skipped int := 0; r record;
BEGIN
  SELECT * INTO s FROM payroll_settings WHERE id;
  IF s.deduction_go_live IS NULL THEN
    RETURN QUERY SELECT 0,0; RETURN;
  END IF;

  FOR r IN
    SELECT p.id, p.amount, p.created_by_id, p.created_by_name, p.paid_at, p.visit_id
    FROM visit_payments p
    WHERE p.payment_method = 'Visa'
      AND p.paymob_transaction_id IS NULL
      AND coalesce(p.payment_verification,'') NOT LIKE 'verified%'
      AND p.paid_at::date >= s.deduction_go_live
      AND p.paid_at < now() - make_interval(hours => s.visa_grace_hours)
      AND NOT EXISTS (SELECT 1 FROM payroll_deductions d
                      WHERE d.kind='visa' AND d.source_id = p.id)
  LOOP
    IF r.created_by_id IS NULL THEN v_skipped := v_skipped + 1; CONTINUE; END IF;
    INSERT INTO payroll_deductions (employee_id, period, kind, amount, reason,
        source_table, source_id, dispute_deadline)
    VALUES (r.created_by_id, to_char(r.paid_at,'YYYY-MM'), 'visa', r.amount,
            'Card payment of ' || r.amount || ' EGP recorded on ' ||
            to_char(r.paid_at,'DD Mon YYYY') || ' was not confirmed by the payment gateway.',
            'visit_payments', r.id, now() + make_interval(hours => s.dispute_window_hours));
    v_created := v_created + 1;
  END LOOP;
  RETURN QUERY SELECT v_created, v_skipped;
END; $$;

-- ---------------------------------------------------------------------
-- Detector 2 · stock shortfall.
--
-- Zero tolerance, per the client's answer to Q6. Valued at PURCHASE price,
-- not sale price: sale price carries the clinic's margin, and recovering
-- margin turns cost recovery into a private penalty. Liability follows the
-- admin skill held on the audit date, which is exactly the mechanism the
-- client described for covering Doaa's vacations.
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.detect_stock_deductions(p_since timestamptz DEFAULT NULL)
RETURNS TABLE(created int, unowned int)
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE s payroll_settings; v_created int := 0; v_unowned int := 0; r record; v_owner uuid;
BEGIN
  SELECT * INTO s FROM payroll_settings WHERE id;
  IF s.deduction_go_live IS NULL THEN RETURN QUERY SELECT 0,0; RETURN; END IF;

  FOR r IN
    SELECT c.id, c.counted_at, c.variance, i.name, i.category, i.purchase_price
    FROM stock_counts c JOIN stock_items i ON i.id = c.item_id
    WHERE c.variance < 0
      AND c.counted_at::date >= s.deduction_go_live
      AND (p_since IS NULL OR c.counted_at >= p_since)
      AND NOT EXISTS (SELECT 1 FROM payroll_deductions d
                      WHERE d.kind='stock' AND d.source_id = c.id)
  LOOP
    SELECT es.employee_id INTO v_owner
    FROM employee_skills es JOIN skills sk ON sk.id = es.skill_id
    WHERE sk.key = CASE WHEN lower(coalesce(r.category,'')) LIKE '%f%b%'
                          OR lower(coalesce(r.category,'')) LIKE '%bevera%'
                          OR lower(coalesce(r.category,'')) LIKE '%food%'
                        THEN 'fnb_admin' ELSE 'material_admin' END
      AND es.granted_at <= r.counted_at
    ORDER BY es.granted_at DESC LIMIT 1;

    IF v_owner IS NULL THEN v_unowned := v_unowned + 1; CONTINUE; END IF;

    INSERT INTO payroll_deductions (employee_id, period, kind, amount, reason,
        source_table, source_id, dispute_deadline)
    VALUES (v_owner, to_char(r.counted_at,'YYYY-MM'), 'stock',
            round(abs(r.variance) * coalesce(r.purchase_price,0), 2),
            abs(r.variance) || ' x ' || r.name || ' short on the count of ' ||
            to_char(r.counted_at,'DD Mon YYYY') || ', valued at cost price.',
            'stock_counts', r.id, now() + make_interval(hours => s.dispute_window_hours));
    v_created := v_created + 1;
  END LOOP;
  RETURN QUERY SELECT v_created, v_unowned;
END; $$;

-- ---------------------------------------------------------------------
-- Detector 3 · leave taken at short notice.
--
-- The ratio is the one on the person's own profile, set by how much their
-- absence hurts and raised by hand if it repeats. A shift that was swapped
-- rather than simply dropped is not penalised.
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.detect_leave_deductions()
RETURNS TABLE(created int, swapped_skipped int)
LANGUAGE plpgsql SECURITY DEFINER AS $$
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
END; $$;

-- ---------------------------------------------------------------------
-- The decision. Approval is what creates the frozen adjustment line; a
-- detected row on its own has never cost anyone anything.
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.deduction_decide(
  p_id uuid, p_status text, p_note text, p_by_id uuid, p_by_name text)
RETURNS json LANGUAGE plpgsql SECURITY DEFINER AS $$
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
END; $$;

-- A card payment the gateway confirms after the fact is reversed, not argued
-- about. The employee gets it back on the next payslip.
CREATE OR REPLACE FUNCTION public.reverse_confirmed_visa_deductions()
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE r record; n int := 0;
BEGIN
  FOR r IN
    SELECT d.*, p.amount AS paid
    FROM payroll_deductions d
    JOIN visit_payments p ON p.id = d.source_id
    WHERE d.kind='visa' AND d.status='approved'
      AND (p.paymob_transaction_id IS NOT NULL OR coalesce(p.payment_verification,'') LIKE 'verified%')
  LOOP
    INSERT INTO payroll_adjustments (employee_id, period, kind, label, amount, note, created_by_name)
    VALUES (r.employee_id, to_char(CURRENT_DATE,'YYYY-MM'), 'bonus',
            'Reversal: card payment later confirmed', r.amount,
            'The gateway confirmed this payment after the deduction was taken.', 'System');
    UPDATE payroll_deductions SET status='reversed' WHERE id = r.id;
    n := n + 1;
  END LOOP;
  RETURN n;
END; $$;

REVOKE EXECUTE ON FUNCTION public.detect_visa_deductions() FROM anon, authenticated, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.detect_stock_deductions(timestamptz) FROM anon, authenticated, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.detect_leave_deductions() FROM anon, authenticated, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.deduction_decide(uuid,text,text,uuid,text) FROM anon, authenticated, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.reverse_confirmed_visa_deductions() FROM anon, authenticated, PUBLIC;
GRANT EXECUTE ON FUNCTION public.detect_visa_deductions() TO service_role;
GRANT EXECUTE ON FUNCTION public.detect_stock_deductions(timestamptz) TO service_role;
GRANT EXECUTE ON FUNCTION public.detect_leave_deductions() TO service_role;
GRANT EXECUTE ON FUNCTION public.deduction_decide(uuid,text,text,uuid,text) TO service_role;
GRANT EXECUTE ON FUNCTION public.reverse_confirmed_visa_deductions() TO service_role;
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
