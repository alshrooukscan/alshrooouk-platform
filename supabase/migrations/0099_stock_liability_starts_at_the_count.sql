-- 0099: stock liability starts when the shelves were actually counted.
--
-- The physical count sheet was applied on 12 and 13 September - 119 items,
-- then 1, then 3 - and that is the first moment the system's figures matched
-- the shelf. Before it, a variance measured a stale system number, not
-- anything a person took.
--
-- So stock deductions begin on 13 September, as decided. The two shortfalls on
-- All bond universal from the 7th and 9th are out of scope permanently.
--
-- Until now they were skipped for a different reason - Doaa was granted the
-- Material Admin role on the 13th, and the detector will not charge somebody
-- for stock missing before they held the role. That happened to give the right
-- answer, but by accident: backdate her grant for any reason and 20,520 EGP of
-- pre-count variance would land on her payslip. The rule is written down here
-- instead of depending on a date in a skills table.
--
-- Separate from deduction_go_live, which stays at 1 September, because card
-- payments and stock shortfalls became measurable on different days and one
-- date cannot be honest about both.

alter table payroll_settings
  add column if not exists stock_liability_start date;

update payroll_settings set stock_liability_start = date '2026-09-13', updated_at = now() where id;
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
      -- Stock has its own start date: the day the count sheet was applied and
      -- the system first agreed with the shelf. A variance measured before
      -- that is a stale system figure, not something a person took. Falls back
      -- to the general go-live if it was never set, so this cannot quietly
      -- disable stock deductions altogether.
      AND c.counted_at::date >= coalesce(s.stock_liability_start, s.deduction_go_live)
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