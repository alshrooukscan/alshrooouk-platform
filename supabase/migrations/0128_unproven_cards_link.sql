-- 0128: each unproven card payment in the Action Center carries a link to
-- where it lives (the clinic statement or the orders page), like "Open visit"
-- on a patient payment, so every row in the section works the same way.
DROP FUNCTION IF EXISTS public.cards_unproven();
CREATE OR REPLACE FUNCTION public.cards_unproven()
 RETURNS TABLE(source text, id uuid, amount numeric, recorded_at timestamptz, payer text, detail text, recorded_by text, hint text, link text)
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
           'Account payment · ' || l.brand || coalesce(' · ' || l.receipt_no, '') det, l.created_by_name,
           '/dashboard/debt-collection/statement/' || l.customer_id || '/' || l.brand || '?payment=' || l.id lnk
      FROM customer_ar_ledger l
      LEFT JOIN clinics cl ON cl.id = l.customer_id LEFT JOIN doctors d ON d.id = l.customer_id LEFT JOIN clients c ON c.id = l.customer_id
     WHERE l.direction = 'payment' AND lower(l.payment_method) = 'visa'
       AND l.paymob_transaction_id IS NULL AND l.payment_verification IS NULL
       AND l.created_at < now() - interval '1 hour'
    UNION ALL
    SELECT 'counter', s.id, s.net_amount::numeric, s.created_at,
           coalesce(cl.code || ' · ', '') || coalesce(cl.name, d.name, c.name, 'Walk-in'),
           'Counter sale · ' || s.brand || coalesce(' · ' || s.receipt_no, ''), s.created_by_name,
           CASE WHEN s.brand = 'dental_stock' THEN '/dashboard/stock/orders?stock=dental' ELSE '/dashboard/stock/orders?stock=el3awama' END
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
           ORDER BY abs(extract(epoch FROM (p.created_at_paymob - (r.created_at AT TIME ZONE 'Africa/Cairo')))) LIMIT 1),
         r.lnk
    FROM r ORDER BY 4;
END $f$;

REVOKE ALL ON FUNCTION public.cards_unproven() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.cards_unproven() TO authenticated, service_role;
