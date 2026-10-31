-- 0131: an admin can undo a generated payslip (Mohamed Said, 31 Oct 2026).
-- Sara's October payslip was generated with a 10,000 EGP advance taken in
-- full, leaving her 1,308 EGP, and there was no way back. void_payslip
-- removes the payslip and reverses everything generating it changed, so the
-- month can be corrected and generated again:
--   advances      the amount taken goes back on the advance (open again)
--   staff tab     the payroll settlement entry is removed
--   cash in hand  the payroll sweep of unsettled cash is removed
--   one-off rules assignments marked applied by this payslip are active again
--   cap carry-over deductions pushed to next month by the cap come back
-- A payslip already marked as paid is refused: the money left the clinic.
-- The removed payslip is kept in activity_log for the record.

-- generate_payslip now records which advance each repayment came from, so an
-- undo returns it to exactly that advance.
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
  rb record; v_comm numeric := 0; rw record; v_bal json;
  v_cap numeric; v_cap_pct numeric; v_pen numeric := 0; v_deferred numeric := 0;
BEGIN
  SELECT * INTO emp FROM employees WHERE id = p_employee_id;
  IF emp IS NULL THEN RAISE EXCEPTION 'Employee not found.'; END IF;

  IF EXISTS (SELECT 1 FROM payroll_runs
              WHERE employee_id = p_employee_id
                AND public.payroll_period_normalize(period) = v_period) THEN
    RAISE EXCEPTION 'A payslip for % already exists for this employee.', v_period;
  END IF;

  gross := public.payslip_gross_v3(p_employee_id, v_period);
  v_bal := public.attendance_balance(p_employee_id, v_period);
  SELECT * INTO h FROM public.payslip_hours(p_employee_id, v_period);

  -- Commission and the report bonus are earned, not granted. They are part
  -- of the pay before anything is taken off it, so they also raise what the
  -- tab and cash sweeps can afford to clear.
  SELECT * INTO rb FROM public.employee_report_bonus(p_employee_id, v_period);
  SELECT coalesce(sum(commission),0) INTO v_comm
    FROM public.employee_scan_commission_days(p_employee_id, v_period);
  SELECT * INTO rw FROM public.employee_raw_data_bonus(p_employee_id, v_period);
  gross := gross + coalesce(rb.bonus,0) + coalesce(rw.bonus,0);

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
      AND kind = 'bonus' AND status = 'approved'
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
      AND kind = 'deduction' AND status = 'approved'
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
            'amount', adv_deduction, 'source','advance', 'advance_id', adv.id);
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
      report_bonus, report_bonus_count, scan_commission,
      raw_data_bonus, raw_data_bonus_count, attendance_balance)
  VALUES (p_employee_id, v_period, emp.fixed_salary, emp.variable_salary,
      ded, round(gross + total_bon - total_ded, 2), gross, bon,
      round(total_bon,2), round(total_ded,2),
      CASE WHEN emp.enable_hybrid_variable_pay THEN 'hybrid'
           WHEN coalesce(emp.hourly_rate,0) > 0 THEN 'hourly' ELSE 'monthly' END,
      round(h.scheduled_paid + h.unscheduled_paid, 2),
      round(coalesce((v_bal->>'overtime_minutes')::numeric,0)/60.0, 2), p_generated_by,
      coalesce(rb.bonus,0), coalesce(rb.qualifying,0), round(v_comm,2),
      coalesce(rw.bonus,0), coalesce(rw.qualifying,0), v_bal)
  RETURNING * INTO result;

  RETURN result;
END; $function$;

CREATE OR REPLACE FUNCTION public.void_payslip(p_run_id uuid, p_by_name text, p_reason text DEFAULT NULL)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $f$
DECLARE r payroll_runs; it jsonb; v_adv uuid; v_amt numeric; v_next text; n_adv int := 0; n_tab int := 0; n_cash int := 0; n_rules int := 0; n_carry int := 0;
BEGIN
  PERFORM public.assert_admin_or_service();
  SELECT * INTO r FROM payroll_runs WHERE id = p_run_id FOR UPDATE;
  IF r.id IS NULL THEN RAISE EXCEPTION 'Payslip not found.'; END IF;
  IF r.paid_at IS NOT NULL THEN
    RAISE EXCEPTION 'This payslip is already marked as paid (%), so it cannot be undone.', coalesce(r.paid_method, 'paid');
  END IF;

  -- advances
  FOR it IN SELECT * FROM jsonb_array_elements(coalesce(r.deductions, '[]'::jsonb)) LOOP
    CONTINUE WHEN it->>'source' <> 'advance';
    v_amt := (it->>'amount')::numeric;
    v_adv := nullif(it->>'advance_id', '')::uuid;
    IF v_adv IS NULL THEN
      -- payslips generated before 0131 did not record the advance: the
      -- employee's advance that took at least this much, newest first
      SELECT id INTO v_adv FROM cash_expenses
       WHERE employee_id = r.employee_id AND category = 'employee_advance' AND coalesce(advance_amount_deducted,0) >= v_amt
       ORDER BY entry_date DESC, created_at DESC LIMIT 1;
    END IF;
    IF v_adv IS NOT NULL THEN
      UPDATE cash_expenses SET advance_amount_deducted = greatest(coalesce(advance_amount_deducted,0) - v_amt, 0), advance_status = 'open'
       WHERE id = v_adv;
      n_adv := n_adv + 1;
    END IF;
  END LOOP;

  -- staff tab and cash sweeps written for this month by payroll
  DELETE FROM employee_tab_ledger
   WHERE employee_id = r.employee_id AND reference_type = 'payroll' AND note = 'Settled in payroll ' || r.period;
  GET DIAGNOSTICS n_tab = ROW_COUNT;
  DELETE FROM expense_transactions
   WHERE from_employee_id = r.employee_id AND type = 'cash_collection' AND created_by_name = 'Payroll' AND note = 'Settled in payroll ' || r.period;
  GET DIAGNOSTICS n_cash = ROW_COUNT;
  DELETE FROM payroll_cash_settlements WHERE employee_id = r.employee_id AND period = r.period;

  -- one-off rule assignments this payslip applied
  UPDATE employee_rule_assignments SET status = 'active', applied_at = NULL
   WHERE employee_id = r.employee_id AND status = 'applied'
     AND applied_at BETWEEN r.generated_at - interval '2 minutes' AND r.generated_at + interval '2 minutes';
  GET DIAGNOSTICS n_rules = ROW_COUNT;

  -- deductions the cap pushed to next month
  v_next := to_char(to_date(r.period || '-01', 'YYYY-MM-DD') + interval '1 month', 'YYYY-MM');
  UPDATE payroll_deductions SET status = 'approved', period = r.period, carried_from_period = NULL
   WHERE employee_id = r.employee_id AND status = 'carried_forward' AND carried_from_period = r.period;
  UPDATE payroll_adjustments
     SET period = r.period,
         note = nullif(trim(regexp_replace(coalesce(note,''), ' \[carried forward from ' || r.period || ': the [0-9.]+% cap was reached\]', '')), '')
   WHERE employee_id = r.employee_id AND public.payroll_period_normalize(period) = v_next
     AND note LIKE '%[carried forward from ' || r.period || ':%';
  GET DIAGNOSTICS n_carry = ROW_COUNT;

  DELETE FROM payroll_runs WHERE id = r.id;

  INSERT INTO activity_log(actor_type, actor_id, actor_name, action, entity_type, entity_id, details)
  VALUES ('admin', auth.uid(), p_by_name, 'payslip_voided', 'employee', r.employee_id,
          jsonb_build_object('period', r.period, 'reason', p_reason, 'payslip', to_jsonb(r),
                             'reversed', jsonb_build_object('advances', n_adv, 'tab', n_tab, 'cash', n_cash, 'rules', n_rules, 'carried', n_carry)));

  RETURN jsonb_build_object('period', r.period, 'net_total', r.net_total, 'advances', n_adv, 'tab', n_tab, 'cash', n_cash, 'rules', n_rules, 'carried', n_carry);
END $f$;

REVOKE ALL ON FUNCTION public.void_payslip(uuid, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.void_payslip(uuid, text, text) TO service_role;
