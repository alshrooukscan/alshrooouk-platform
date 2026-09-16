-- 0097: the Visa rule could never have charged anybody.
--
-- detect_visa_deductions took created_by_id from the payment and wrote it into
-- payroll_deductions.employee_id. But created_by_id is a staff login id and
-- that column is a foreign key to employees - two different id spaces. All 110
-- card payments carry a staff id and none carries an employee id, so the rule
-- did not merely mis-attribute: it failed on the foreign key and the entire
-- detection run errored.
--
-- This was invisible while deduction_go_live was null, because the function
-- returned before reaching the insert. Setting the date is what would have
-- exposed it - on the first day the client expected the rule to work.
--
-- Now resolved through staff_account_email, the same link the rest of payroll
-- uses. Seven of the ten logins resolve. The three that do not - Moamen,
-- Mohamed Said, and one duplicate Sara login - are counted as skipped rather
-- than charged to somebody else, because a payment taken on a login with no
-- employee behind it cannot be attributed to a person without guessing.

CREATE OR REPLACE FUNCTION public.detect_visa_deductions()
 RETURNS TABLE(created integer, skipped_no_author integer)
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE s payroll_settings; v_created int := 0; v_skipped int := 0; r record; v_employee uuid;
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
    -- created_by_id on a payment is a staff login, never an employee record -
    -- two different id spaces - so this went straight into a foreign key on
    -- employees and failed outright. The whole rule would have errored on the
    -- first day it was switched on rather than charging anybody. Resolved
    -- through the staff account email, which is the link the rest of payroll
    -- already uses.
    v_employee := NULL;
    IF r.created_by_id IS NOT NULL THEN
      SELECT e.id INTO v_employee
      FROM staff_profiles sp
      JOIN employees e ON e.staff_account_email = sp.email
      WHERE sp.id = r.created_by_id;
    END IF;

    -- Counted as skipped, not charged to somebody else. Three logins have no
    -- employee record behind them, and a payment taken on one of those cannot
    -- be attributed to a person without guessing.
    IF v_employee IS NULL THEN v_skipped := v_skipped + 1; CONTINUE; END IF;
    INSERT INTO payroll_deductions (employee_id, period, kind, amount, reason,
        source_table, source_id, dispute_deadline)
    VALUES (v_employee, to_char(r.paid_at,'YYYY-MM'), 'visa', r.amount,
            'Card payment of ' || r.amount || ' EGP recorded on ' ||
            to_char(r.paid_at,'DD Mon YYYY') || ' was not confirmed by the payment gateway.',
            'visit_payments', r.id, now() + make_interval(hours => s.dispute_window_hours));
    v_created := v_created + 1;
  END LOOP;
  RETURN QUERY SELECT v_created, v_skipped;
END; $function$
;