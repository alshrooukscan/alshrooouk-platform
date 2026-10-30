-- 0126: payment verification everywhere (Mohamed Said, 30 Oct 2026).
--
-- 1. Card (Visa / wallet) money outside patient visits gets the same Paymob
--    proof the patient page has: payments on a clinic or client account
--    (customer_ar_ledger) and counter sales. Matched like a cash conversion:
--    same amount, charged between 3 hours before and 30 minutes after the
--    record, and not already claimed by anything else.
-- 2. InstaPay has no gateway behind it (HSBC personal account, no API). Every
--    InstaPay receipt waits in the Action Center until an admin confirms the
--    money arrived; then it shows as Verified. Everything recorded before
--    today is treated as already approved, as Mohamed decided.
--
-- payment_verification values used here:
--   verified_paymob     - matched to a Paymob charge (card)
--   verified_instapay   - an admin confirmed the InstaPay transfer arrived
--   rejected_instapay   - an admin said it never arrived
--   NULL                - no verdict yet

-- 1. Columns ---------------------------------------------------------------
ALTER TABLE paymob_transactions
  ADD COLUMN IF NOT EXISTS matched_ar_id uuid REFERENCES customer_ar_ledger(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS matched_counter_sale_id uuid REFERENCES counter_sales(id) ON DELETE SET NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_paymob_matched_ar ON paymob_transactions(matched_ar_id) WHERE matched_ar_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_paymob_matched_counter ON paymob_transactions(matched_counter_sale_id) WHERE matched_counter_sale_id IS NOT NULL;

ALTER TABLE customer_ar_ledger
  ADD COLUMN IF NOT EXISTS payment_verification text,
  ADD COLUMN IF NOT EXISTS paymob_transaction_id bigint REFERENCES paymob_transactions(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS paymob_card_last4 text,
  ADD COLUMN IF NOT EXISTS verified_by_name text,
  ADD COLUMN IF NOT EXISTS verified_at timestamptz;
CREATE UNIQUE INDEX IF NOT EXISTS uq_ar_paymob_tx ON customer_ar_ledger(paymob_transaction_id) WHERE paymob_transaction_id IS NOT NULL;

ALTER TABLE counter_sales
  ADD COLUMN IF NOT EXISTS payment_verification text,
  ADD COLUMN IF NOT EXISTS paymob_transaction_id bigint REFERENCES paymob_transactions(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS paymob_card_last4 text,
  ADD COLUMN IF NOT EXISTS verified_by_name text,
  ADD COLUMN IF NOT EXISTS verified_at timestamptz;
CREATE UNIQUE INDEX IF NOT EXISTS uq_counter_paymob_tx ON counter_sales(paymob_transaction_id) WHERE paymob_transaction_id IS NOT NULL;

ALTER TABLE visit_payments
  ADD COLUMN IF NOT EXISTS verified_by_name text,
  ADD COLUMN IF NOT EXISTS verified_at timestamptz;

-- 2. Card matching for account payments and counter sales ------------------
CREATE OR REPLACE FUNCTION public.match_sale_paymob(p_source text, p_id uuid)
 RETURNS bigint LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $f$
DECLARE v_amt numeric; v_at timestamp; v_m text; v_have bigint; v_tx paymob_transactions;
BEGIN
  IF p_source = 'ar' THEN
    SELECT amount, created_at AT TIME ZONE 'Africa/Cairo', lower(payment_method), paymob_transaction_id
      INTO v_amt, v_at, v_m, v_have FROM customer_ar_ledger WHERE id = p_id AND direction = 'payment';
  ELSIF p_source = 'counter' THEN
    SELECT net_amount, created_at AT TIME ZONE 'Africa/Cairo', lower(payment_method), paymob_transaction_id
      INTO v_amt, v_at, v_m, v_have FROM counter_sales WHERE id = p_id;
  ELSE RETURN NULL; END IF;
  IF v_m IS NULL OR v_m NOT IN ('visa','wallet') THEN RETURN NULL; END IF;
  IF v_have IS NOT NULL THEN RETURN v_have; END IF;

  SELECT * INTO v_tx FROM paymob_transactions p
   WHERE p.success AND NOT coalesce(p.is_voided,false) AND NOT coalesce(p.is_refunded,false)
     AND p.matched_payment_id IS NULL AND p.matched_expense_id IS NULL
     AND p.matched_ar_id IS NULL AND p.matched_counter_sale_id IS NULL
     AND abs(p.amount - v_amt) < 0.01
     AND p.created_at_paymob BETWEEN v_at - interval '3 hours' AND v_at + interval '30 minutes'
   ORDER BY abs(extract(epoch FROM (p.created_at_paymob - v_at)))
   LIMIT 1 FOR UPDATE SKIP LOCKED;
  IF v_tx.id IS NULL THEN RETURN NULL; END IF;

  IF p_source = 'ar' THEN
    UPDATE paymob_transactions SET matched_ar_id = p_id, matched_at = now(), review_status = 'matched' WHERE id = v_tx.id;
    UPDATE customer_ar_ledger SET paymob_transaction_id = v_tx.id, paymob_card_last4 = v_tx.card_last4,
           payment_verification = 'verified_paymob', verified_by_name = 'Paymob', verified_at = now() WHERE id = p_id;
  ELSE
    UPDATE paymob_transactions SET matched_counter_sale_id = p_id, matched_at = now(), review_status = 'matched' WHERE id = v_tx.id;
    UPDATE counter_sales SET paymob_transaction_id = v_tx.id, paymob_card_last4 = v_tx.card_last4,
           payment_verification = 'verified_paymob', verified_by_name = 'Paymob', verified_at = now() WHERE id = p_id;
  END IF;
  RETURN v_tx.id;
END $f$;

-- Paymob publishes a charge a few minutes after the tap, so the sync job
-- sweeps the last two weeks of unproven card rows each run.
CREATE OR REPLACE FUNCTION public.match_pending_sale_cards()
 RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $f$
DECLARE x record; n int := 0;
BEGIN
  FOR x IN
    SELECT 'ar' s, id, created_at FROM customer_ar_ledger
     WHERE direction = 'payment' AND lower(payment_method) IN ('visa','wallet') AND paymob_transaction_id IS NULL AND created_at > now() - interval '14 days'
    UNION ALL
    SELECT 'counter', id, created_at FROM counter_sales
     WHERE lower(payment_method) IN ('visa','wallet') AND paymob_transaction_id IS NULL AND created_at > now() - interval '14 days'
    ORDER BY 3
  LOOP
    IF public.match_sale_paymob(x.s, x.id) IS NOT NULL THEN n := n + 1; END IF;
  END LOOP;
  RETURN n;
END $f$;

CREATE OR REPLACE FUNCTION public.trg_match_sale_paymob()
 RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $f$
BEGIN
  PERFORM public.match_sale_paymob(TG_ARGV[0], NEW.id);
  RETURN NULL;
END $f$;

DROP TRIGGER IF EXISTS ar_match_paymob ON customer_ar_ledger;
CREATE TRIGGER ar_match_paymob AFTER INSERT ON customer_ar_ledger FOR EACH ROW
  WHEN (NEW.direction = 'payment' AND lower(NEW.payment_method) IN ('visa','wallet'))
  EXECUTE FUNCTION public.trg_match_sale_paymob('ar');
DROP TRIGGER IF EXISTS counter_match_paymob ON counter_sales;
CREATE TRIGGER counter_match_paymob AFTER INSERT ON counter_sales FOR EACH ROW
  WHEN (lower(NEW.payment_method) IN ('visa','wallet'))
  EXECUTE FUNCTION public.trg_match_sale_paymob('counter');

-- A cash conversion must not take a charge an account payment or counter sale already holds.
CREATE OR REPLACE FUNCTION public.match_conversion_paymob(p_expense_id uuid)
 RETURNS bigint LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $f$
DECLARE e expense_transactions; v_at timestamp; v_tx bigint;
BEGIN
  SELECT * INTO e FROM expense_transactions WHERE id = p_expense_id;
  IF e.id IS NULL OR e.type <> 'cash_conversion' OR e.payment_method <> 'visa' THEN RETURN NULL; END IF;
  IF e.paymob_transaction_id IS NOT NULL THEN RETURN e.paymob_transaction_id; END IF;
  v_at := e.created_at AT TIME ZONE 'Africa/Cairo';
  SELECT p.id INTO v_tx FROM paymob_transactions p
   WHERE p.success AND NOT coalesce(p.is_voided, false) AND NOT coalesce(p.is_refunded, false)
     AND p.matched_payment_id IS NULL AND p.matched_expense_id IS NULL
     AND p.matched_ar_id IS NULL AND p.matched_counter_sale_id IS NULL
     AND abs(p.amount - e.amount) < 0.01
     AND p.created_at_paymob BETWEEN v_at - interval '3 hours' AND v_at + interval '30 minutes'
   ORDER BY abs(extract(epoch FROM (p.created_at_paymob - v_at)))
   LIMIT 1;
  IF v_tx IS NULL THEN RETURN NULL; END IF;
  UPDATE paymob_transactions SET matched_expense_id = e.id, matched_at = now(), review_status = 'matched' WHERE id = v_tx;
  UPDATE expense_transactions SET paymob_transaction_id = v_tx WHERE id = e.id;
  RETURN v_tx;
END $f$;

-- 3. InstaPay: admin verification ------------------------------------------
-- Everything recorded before today counts as approved.
UPDATE visit_payments SET payment_verification = 'verified_instapay', verified_by_name = 'Approved before 30 Oct 2026', verified_at = now()
 WHERE lower(payment_method) = 'instapay' AND payment_verification IS NULL;
UPDATE customer_ar_ledger SET payment_verification = 'verified_instapay', verified_by_name = 'Approved before 30 Oct 2026', verified_at = now()
 WHERE direction = 'payment' AND lower(payment_method) = 'instapay' AND payment_verification IS NULL;
UPDATE counter_sales SET payment_verification = 'verified_instapay', verified_by_name = 'Approved before 30 Oct 2026', verified_at = now()
 WHERE lower(payment_method) = 'instapay' AND payment_verification IS NULL;

CREATE OR REPLACE FUNCTION public.instapay_pending()
 RETURNS TABLE(source text, id uuid, amount numeric, recorded_at timestamptz, payer text, detail text, recorded_by text)
 LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $f$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM staff_profiles WHERE staff_profiles.id = auth.uid() AND role = 'admin')
     AND coalesce(auth.role(), '') <> 'service_role' THEN
    RAISE EXCEPTION 'Only an admin can see InstaPay payments to verify.';
  END IF;
  RETURN QUERY
  SELECT 'visit'::text, vp.id, vp.amount::numeric, coalesce(vp.paid_at, vp.created_at), coalesce(p.name, 'Patient'),
         'Patient visit'::text, vp.created_by_name
    FROM visit_payments vp LEFT JOIN visits v ON v.id = vp.visit_id LEFT JOIN patients p ON p.id = v.patient_id
   WHERE lower(vp.payment_method) = 'instapay' AND vp.payment_verification IS NULL
  UNION ALL
  SELECT 'ar', l.id, l.amount::numeric, l.created_at,
         coalesce(cl.name, d.name, c.name, l.customer_type),
         'Account payment · ' || l.brand || coalesce(' · ' || l.receipt_no, ''), l.created_by_name
    FROM customer_ar_ledger l
    LEFT JOIN clinics cl ON cl.id = l.customer_id LEFT JOIN doctors d ON d.id = l.customer_id LEFT JOIN clients c ON c.id = l.customer_id
   WHERE l.direction = 'payment' AND lower(l.payment_method) = 'instapay' AND l.payment_verification IS NULL
  UNION ALL
  SELECT 'counter', s.id, s.net_amount::numeric, s.created_at,
         coalesce(cl.name, d.name, c.name, 'Walk-in'),
         'Counter sale · ' || s.brand || coalesce(' · ' || s.receipt_no, ''), s.created_by_name
    FROM counter_sales s
    LEFT JOIN clinics cl ON cl.id = s.customer_id LEFT JOIN doctors d ON d.id = s.customer_id LEFT JOIN clients c ON c.id = s.customer_id
   WHERE lower(s.payment_method) = 'instapay' AND s.payment_verification IS NULL
  ORDER BY 4;
END $f$;

CREATE OR REPLACE FUNCTION public.verify_instapay(p_source text, p_id uuid, p_approve boolean)
 RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $f$
DECLARE v_name text; v_status text; n int;
BEGIN
  SELECT name INTO v_name FROM staff_profiles WHERE id = auth.uid() AND role = 'admin';
  IF v_name IS NULL THEN RAISE EXCEPTION 'Only an admin can verify InstaPay payments.'; END IF;
  v_status := CASE WHEN p_approve THEN 'verified_instapay' ELSE 'rejected_instapay' END;
  IF p_source = 'visit' THEN
    UPDATE visit_payments SET payment_verification = v_status, verified_by_name = v_name, verified_at = now()
     WHERE id = p_id AND lower(payment_method) = 'instapay' AND payment_verification IS NULL;
  ELSIF p_source = 'ar' THEN
    UPDATE customer_ar_ledger SET payment_verification = v_status, verified_by_name = v_name, verified_at = now()
     WHERE id = p_id AND lower(payment_method) = 'instapay' AND payment_verification IS NULL;
  ELSIF p_source = 'counter' THEN
    UPDATE counter_sales SET payment_verification = v_status, verified_by_name = v_name, verified_at = now()
     WHERE id = p_id AND lower(payment_method) = 'instapay' AND payment_verification IS NULL;
  ELSE RAISE EXCEPTION 'Unknown payment source %', p_source; END IF;
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n = 0 THEN RAISE EXCEPTION 'This payment was already decided or is not InstaPay.'; END IF;
  INSERT INTO activity_log(actor_id, actor_name, actor_type, action, entity_type, entity_id, details)
  VALUES (auth.uid(), v_name, 'admin', v_status, p_source || '_payment', p_id, jsonb_build_object('source', p_source));
  RETURN v_status;
END $f$;

REVOKE ALL ON FUNCTION public.match_sale_paymob(text, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.match_sale_paymob(text, uuid) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.match_pending_sale_cards() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.match_pending_sale_cards() TO service_role;
REVOKE ALL ON FUNCTION public.instapay_pending() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.instapay_pending() TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.verify_instapay(text, uuid, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.verify_instapay(text, uuid, boolean) TO authenticated;

-- 4. The deduction engine's late match also respects every kind of claim.
CREATE OR REPLACE FUNCTION public.detect_visa_deductions()
 RETURNS TABLE(created integer, skipped_no_author integer)
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE s payroll_settings; v_created int := 0; v_skipped int := 0; r record; v_employee uuid; v_txn record; v_n int;
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
    -- A payment recorded days after the visit (Nourhan, 19 Oct 2026) has its card
    -- transaction on the VISIT day, not the recording day. One unmatched
    -- successful transaction of the same amount that day links it instead of
    -- charging the employee.
    SELECT count(*) INTO v_n FROM paymob_transactions t JOIN visits vv ON vv.id = r.visit_id
     WHERE t.success AND NOT coalesce(t.is_voided,false) AND t.matched_payment_id IS NULL AND t.matched_expense_id IS NULL AND t.matched_ar_id IS NULL AND t.matched_counter_sale_id IS NULL
       AND t.amount = r.amount AND t.created_at_paymob::date = vv.exam_date;
    IF v_n = 1 THEN
      SELECT t.* INTO v_txn FROM paymob_transactions t JOIN visits vv ON vv.id = r.visit_id
       WHERE t.success AND NOT coalesce(t.is_voided,false) AND t.matched_payment_id IS NULL AND t.matched_expense_id IS NULL AND t.matched_ar_id IS NULL AND t.matched_counter_sale_id IS NULL
         AND t.amount = r.amount AND t.created_at_paymob::date = vv.exam_date;
      UPDATE visit_payments SET payment_verification = 'verified_paymob_late', paymob_transaction_id = v_txn.id,
             paymob_terminal_id = v_txn.terminal_id, paymob_card_brand = v_txn.card_brand, paymob_card_last4 = v_txn.card_last4,
             paymob_fees = v_txn.fees, paymob_matched_at = now(),
             paymob_match_gap_minutes = round(abs(EXTRACT(EPOCH FROM ((r.paid_at AT TIME ZONE 'Africa/Cairo') - v_txn.created_at_paymob::timestamp)))/60)
       WHERE id = r.id;
      UPDATE paymob_transactions SET matched_payment_id = r.id, matched_at = now(), review_status = 'matched' WHERE id = v_txn.id;
      CONTINUE;
    END IF;

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

-- 5. Card rows already recorded.
SELECT public.match_pending_sale_cards();
DO $$ DECLARE x record; BEGIN
  FOR x IN SELECT 'ar' s, id FROM customer_ar_ledger WHERE direction='payment' AND lower(payment_method) IN ('visa','wallet') AND paymob_transaction_id IS NULL
           UNION ALL SELECT 'counter', id FROM counter_sales WHERE lower(payment_method) IN ('visa','wallet') AND paymob_transaction_id IS NULL
  LOOP PERFORM public.match_sale_paymob(x.s, x.id); END LOOP;
END $$;
