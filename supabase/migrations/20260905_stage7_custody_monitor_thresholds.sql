-- =====================================================================
-- Cash Management  ·  Stage 7  ·  Thresholds, alerts and the monitor
--
-- Client decisions implemented:
--   A25  role-based thresholds, already seeded per employee
--   A26  measured on the TOTAL across all three businesses
--   A27  Green / Yellow at 80% / Red at 100%. Warning and admin flag
--        only - never a hard block on taking a payment.
--   A28  the handover prompt: when a staff member is holding cash and a
--        cash keeper is on shift with them, suggest the handover
--   A29  an employee sees their own balance and nobody else's
--   §8   one monitor with all three businesses, the total, the threshold
--        and the status side by side
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. The Staff Custody Live Monitor  (§8)
--    Every active employee, one row, three businesses plus the total.
-- ---------------------------------------------------------------------
CREATE OR REPLACE VIEW public.staff_custody_monitor AS
WITH held AS (
    SELECT employee_id,
           sum(CASE WHEN brand = 'scan'           THEN balance ELSE 0 END) AS scan_cash,
           sum(CASE WHEN brand = 'dental_stock'   THEN balance ELSE 0 END) AS material_cash,
           sum(CASE WHEN brand = 'el3awama_stock' THEN balance ELSE 0 END) AS fnb_cash,
           sum(balance) AS total_cash
    FROM public.employee_cash_balances
    GROUP BY employee_id
),
keeper AS (
    SELECT employee_id, array_agg(brand ORDER BY brand) AS keeper_for
    FROM public.employee_cash_keeper_streams
    GROUP BY employee_id
)
SELECT e.id                                        AS employee_id,
       e.name,
       e.role,
       e.branch_id,
       coalesce(h.scan_cash, 0)::numeric(12,2)     AS scan_cash,
       coalesce(h.material_cash, 0)::numeric(12,2) AS material_cash,
       coalesce(h.fnb_cash, 0)::numeric(12,2)      AS fnb_cash,
       coalesce(h.total_cash, 0)::numeric(12,2)    AS total_cash,
       coalesce(e.max_cash_threshold, 0)::numeric(12,2) AS threshold,
       CASE
         WHEN coalesce(e.max_cash_threshold,0) <= 0 THEN NULL
         ELSE round(coalesce(h.total_cash,0) / e.max_cash_threshold * 100, 1)
       END                                         AS percent_of_threshold,
       CASE
         WHEN coalesce(e.max_cash_threshold,0) <= 0                              THEN 'unset'
         WHEN coalesce(h.total_cash,0) >= e.max_cash_threshold                    THEN 'red'
         WHEN coalesce(h.total_cash,0) >= e.max_cash_threshold * 0.8              THEN 'yellow'
         ELSE 'green'
       END                                         AS status,
       coalesce(k.keeper_for, ARRAY[]::text[])     AS cash_keeper_for,
       (k.employee_id IS NOT NULL)                 AS is_cash_keeper,
       coalesce(t.balance, 0)::numeric(12,2)       AS tab_balance
FROM public.employees e
LEFT JOIN held    h ON h.employee_id = e.id
LEFT JOIN keeper  k ON k.employee_id = e.id
LEFT JOIN public.employee_tab_balances t ON t.employee_id = e.id
WHERE e.is_active;

COMMENT ON VIEW public.staff_custody_monitor IS
  'One row per active employee: cash held per business, the total, their '
  'threshold and Green/Yellow/Red status. A27: status is advisory only, '
  'it never blocks a payment being taken.';

-- ---------------------------------------------------------------------
-- 2. Who is over, and who should they hand to?  (A28)
--    A handover is suggested when someone is holding cash for a business
--    they are NOT the cash keeper for, and a keeper for that business is
--    on shift today.
-- ---------------------------------------------------------------------
CREATE OR REPLACE VIEW public.cash_handover_prompts AS
WITH holders AS (
    SELECT b.employee_id, b.brand, b.balance
    FROM public.employee_cash_balances b
    WHERE b.balance > 0
),
on_shift_keepers AS (
    SELECT k.employee_id, k.brand, e.name
    FROM public.employee_cash_keeper_streams k
    JOIN public.employees e ON e.id = k.employee_id AND e.is_active
    WHERE EXISTS (
        SELECT 1 FROM public.employee_schedule_days d
        WHERE d.employee_id = k.employee_id
          AND d.work_date = CURRENT_DATE
          AND NOT d.is_day_off
    )
)
SELECT h.employee_id           AS holder_id,
       he.name                 AS holder_name,
       h.brand,
       h.balance,
       k.employee_id           AS suggested_keeper_id,
       k.name                  AS suggested_keeper_name
FROM holders h
JOIN public.employees he ON he.id = h.employee_id
LEFT JOIN on_shift_keepers k ON k.brand = h.brand
WHERE NOT EXISTS (
    SELECT 1 FROM public.employee_cash_keeper_streams s
    WHERE s.employee_id = h.employee_id AND s.brand = h.brand
);

COMMENT ON VIEW public.cash_handover_prompts IS
  'A28: staff hand cash to a cash keeper on the same shift. Rows here are '
  'suggestions only. A null suggested keeper means nobody with that skill '
  'is scheduled today, so the cash stays put.';

-- ---------------------------------------------------------------------
-- 3. Consolidated daily revenue by business and channel  (§8)
--    Scan visits, dental orders, and counter sales in one shape.
-- ---------------------------------------------------------------------
CREATE OR REPLACE VIEW public.daily_revenue_by_channel AS
SELECT entry_date,
       brand,
       payment_method,
       sum(amount)::numeric(12,2) AS amount,
       count(*)                   AS transactions
FROM (
    SELECT et.entry_date, et.brand, et.payment_method, et.amount
    FROM public.expense_transactions et
    WHERE et.type IN ('visit_collection','stock_sale','debt_collection')
      AND et.status = 'confirmed'
    UNION ALL
    -- Counter sales on a staff tab are not revenue collected yet; they are
    -- settled at payroll, so they are excluded here on purpose.
    SELECT cs.entry_date, cs.brand, cs.payment_method, cs.net_amount
    FROM public.counter_sales cs
    WHERE cs.payment_method <> 'staff_tab'
) x
GROUP BY entry_date, brand, payment_method;

COMMENT ON VIEW public.daily_revenue_by_channel IS
  'Revenue per day, per business, per payment channel. Staff tab sales are '
  'excluded because nothing has been collected yet - they settle at payroll.';
