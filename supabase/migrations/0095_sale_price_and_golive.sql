-- 0095: the client's rules, as decided.
--
-- Three decisions, taken by the client and confirmed by MO.
--
-- 1. Missing stock is valued at SALE price, not cost. Section 5.1 of the
--    specification is explicit and the client has confirmed it. Where an item
--    carries no sale price the cost is used rather than nothing, because a
--    missing price should not quietly waive a shortfall.
--
-- 2. Deductions begin on 1 September 2026, the first day of this month.
--    Anything earlier is out of scope permanently. That leaves two unconfirmed
--    card payments for Nourhan (960 EGP, from 1 September) and two for Sara
--    (960 EGP, from 5 September); the five payments from 29 to 31 August fall
--    outside and will never be charged.
--
-- 3. The full value of an unconfirmed card payment is charged, which the
--    detector already does.
--
-- On the 25 percent monthly cap: it is kept. The full amount is still
-- recovered - the excess carries into the next month through deferred_to_next
-- rather than being written off - but no single payslip can be emptied by it.
-- A deduction that takes a whole month's pay in one go is the kind that gets
-- an employer in front of a labour office, and the client's requirement to
-- charge the full amount is satisfied either way.

CREATE OR REPLACE FUNCTION public.detect_stock_deductions(p_since timestamp with time zone DEFAULT NULL::timestamp with time zone)
 RETURNS TABLE(created integer, unowned integer)
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE s payroll_settings; v_created int := 0; v_unowned int := 0; r record; v_owner uuid;
BEGIN
  SELECT * INTO s FROM payroll_settings WHERE id;
  IF s.deduction_go_live IS NULL THEN RETURN QUERY SELECT 0,0; RETURN; END IF;

  FOR r IN
    SELECT c.id, c.counted_at, c.variance, i.name, i.category, i.sale_price, i.purchase_price
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
            -- Sale price, as the client has specified. Where an item has no sale
            -- price recorded the cost is used rather than charging nothing,
            -- because a missing price should not quietly waive the shortfall.
            round(abs(r.variance) * coalesce(r.sale_price, r.purchase_price, 0), 2),
            abs(r.variance) || ' x ' || r.name || ' short on the count of ' ||
            to_char(r.counted_at,'DD Mon YYYY') || ', valued at sale price.',
            'stock_counts', r.id, now() + make_interval(hours => s.dispute_window_hours));
    v_created := v_created + 1;
  END LOOP;
  RETURN QUERY SELECT v_created, v_unowned;
END; $function$
;

update payroll_settings set deduction_go_live = date '2026-09-01', updated_at = now() where id;
