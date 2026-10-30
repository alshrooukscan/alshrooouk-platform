-- 0127: card payments with no Paymob charge reach the Action Center
-- (Mohamed Said, 30 Oct 2026). Account payments and counter sales recorded as
-- Visa that Paymob cannot account for used to sit quietly with an "Awaiting
-- card proof" badge until somebody happened to look. They now wait for an
-- admin alongside InstaPay, after an hour's grace (Paymob publishes a charge a
-- few minutes after the tap).
--   approve -> approved_by_admin  (an admin says the money arrived)
--   reject  -> rejected_card      (it did not arrive by card; fix the method)

CREATE OR REPLACE FUNCTION public.cards_unproven()
 RETURNS TABLE(source text, id uuid, amount numeric, recorded_at timestamptz, payer text, detail text, recorded_by text, hint text)
 LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $f$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM staff_profiles WHERE staff_profiles.id = auth.uid() AND role = 'admin')
     AND coalesce(auth.role(), '') <> 'service_role' THEN
    RAISE EXCEPTION 'Only an admin can see card payments to verify.';
  END IF;
  RETURN QUERY
  WITH r AS (
    SELECT 'ar'::text src, l.id, l.amount::numeric amt, l.created_at,
           coalesce(cl.code || ' · ', '') || coalesce(cl.name, d.name, c.name, l.customer_type) who,
           'Account payment · ' || l.brand || coalesce(' · ' || l.receipt_no, '') det, l.created_by_name
      FROM customer_ar_ledger l
      LEFT JOIN clinics cl ON cl.id = l.customer_id LEFT JOIN doctors d ON d.id = l.customer_id LEFT JOIN clients c ON c.id = l.customer_id
     WHERE l.direction = 'payment' AND lower(l.payment_method) = 'visa'
       AND l.paymob_transaction_id IS NULL AND l.payment_verification IS NULL
       AND l.created_at < now() - interval '1 hour'
    UNION ALL
    SELECT 'counter', s.id, s.net_amount::numeric, s.created_at,
           coalesce(cl.code || ' · ', '') || coalesce(cl.name, d.name, c.name, 'Walk-in'),
           'Counter sale · ' || s.brand || coalesce(' · ' || s.receipt_no, ''), s.created_by_name
      FROM counter_sales s
      LEFT JOIN clinics cl ON cl.id = s.customer_id LEFT JOIN doctors d ON d.id = s.customer_id LEFT JOIN clients c ON c.id = s.customer_id
     WHERE lower(s.payment_method) = 'visa'
       AND s.paymob_transaction_id IS NULL AND s.payment_verification IS NULL
       AND s.created_at < now() - interval '1 hour'
  )
  SELECT r.src, r.id, r.amt, r.created_at, r.who, r.det, r.created_by_name,
         -- the nearest free Paymob charge of the same amount within 3 days, as a clue
         (SELECT 'Paymob has ' || to_char(p.amount, 'FM999999990.00') || ' on ' || to_char(p.created_at_paymob, 'DD Mon HH24:MI') || coalesce(', card ••' || p.card_last4, '')
            FROM paymob_transactions p
           WHERE p.success AND NOT coalesce(p.is_voided,false) AND NOT coalesce(p.is_refunded,false)
             AND p.matched_payment_id IS NULL AND p.matched_expense_id IS NULL
             AND p.matched_ar_id IS NULL AND p.matched_counter_sale_id IS NULL
             AND abs(p.amount - r.amt) < 0.01
             AND p.created_at_paymob BETWEEN (r.created_at AT TIME ZONE 'Africa/Cairo') - interval '3 days' AND (r.created_at AT TIME ZONE 'Africa/Cairo') + interval '1 day'
           ORDER BY abs(extract(epoch FROM (p.created_at_paymob - (r.created_at AT TIME ZONE 'Africa/Cairo')))) LIMIT 1)
    FROM r ORDER BY 4;
END $f$;

CREATE OR REPLACE FUNCTION public.verify_card_manual(p_source text, p_id uuid, p_approve boolean)
 RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $f$
DECLARE v_name text; v_status text; n int;
BEGIN
  SELECT name INTO v_name FROM staff_profiles WHERE id = auth.uid() AND role = 'admin';
  IF v_name IS NULL THEN RAISE EXCEPTION 'Only an admin can verify card payments.'; END IF;
  v_status := CASE WHEN p_approve THEN 'approved_by_admin' ELSE 'rejected_card' END;
  IF p_source = 'ar' THEN
    UPDATE customer_ar_ledger SET payment_verification = v_status, verified_by_name = v_name, verified_at = now()
     WHERE id = p_id AND lower(payment_method) IN ('visa','wallet') AND paymob_transaction_id IS NULL AND payment_verification IS NULL;
  ELSIF p_source = 'counter' THEN
    UPDATE counter_sales SET payment_verification = v_status, verified_by_name = v_name, verified_at = now()
     WHERE id = p_id AND lower(payment_method) IN ('visa','wallet') AND paymob_transaction_id IS NULL AND payment_verification IS NULL;
  ELSE RAISE EXCEPTION 'Unknown payment source %', p_source; END IF;
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n = 0 THEN RAISE EXCEPTION 'This payment was already decided or matched.'; END IF;
  INSERT INTO activity_log(actor_id, actor_name, actor_type, action, entity_type, entity_id, details)
  VALUES (auth.uid(), v_name, 'admin', v_status, p_source || '_payment', p_id, jsonb_build_object('source', p_source));
  RETURN v_status;
END $f$;

-- The Paymob sweep skips rows an admin has already decided.
CREATE OR REPLACE FUNCTION public.match_pending_sale_cards()
 RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $f$
DECLARE x record; n int := 0;
BEGIN
  FOR x IN
    SELECT 'ar' s, id, created_at FROM customer_ar_ledger
     WHERE direction = 'payment' AND lower(payment_method) IN ('visa','wallet') AND paymob_transaction_id IS NULL
       AND payment_verification IS NULL AND created_at > now() - interval '14 days'
    UNION ALL
    SELECT 'counter', id, created_at FROM counter_sales
     WHERE lower(payment_method) IN ('visa','wallet') AND paymob_transaction_id IS NULL
       AND payment_verification IS NULL AND created_at > now() - interval '14 days'
    ORDER BY 3
  LOOP
    IF public.match_sale_paymob(x.s, x.id) IS NOT NULL THEN n := n + 1; END IF;
  END LOOP;
  RETURN n;
END $f$;

REVOKE ALL ON FUNCTION public.cards_unproven() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.cards_unproven() TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.verify_card_manual(text, uuid, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.verify_card_manual(text, uuid, boolean) TO authenticated;
REVOKE ALL ON FUNCTION public.match_pending_sale_cards() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.match_pending_sale_cards() TO service_role;
