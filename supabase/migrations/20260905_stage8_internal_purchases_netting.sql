-- =====================================================================
-- Cash Management  ·  Stage 8  ·  Buying between businesses, and netting
--
-- Client decisions implemented:
--   A31  transfers happen at NORMAL SALE PRICE, so each division shows
--        realistic trading figures and could later stand alone without
--        rewriting history. The internal profit this creates is stripped
--        out again at month end (see internal_profit_elimination).
--   A32  any business may buy from any other
--   A33  no admin approval needed on the purchase itself
--   A34  immediate, no OTP - both sides are staff
--   A35  the system prepares the netting; an admin approves before it posts
--   A36  calendar month end
--   R6   a purchase is a trade, treated like a normal customer. A LOAN
--        between businesses is a different thing entirely and already
--        exists as the owner-approved Brand Transfer.
--   §4   the dual-role cash shift: the buying business's cash goes down,
--        the selling business's cash goes up, and the employee's physical
--        cash total does not change at all.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. An internal purchase
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.internal_purchases (
    id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    buyer_brand      text NOT NULL CHECK (buyer_brand  IN ('scan','dental_stock','el3awama_stock')),
    seller_brand     text NOT NULL CHECK (seller_brand IN ('scan','dental_stock','el3awama_stock')),
    amount           numeric(12,2) NOT NULL CHECK (amount > 0),
    cost_amount      numeric(12,2),      -- what it cost the seller, for elimination
    payment_method   text NOT NULL CHECK (payment_method IN ('cash','postponed')),
    handled_by_employee_id uuid REFERENCES public.employees(id),
    reference_type   text,
    reference_id     uuid,
    note             text,
    entry_date       date NOT NULL DEFAULT CURRENT_DATE,
    created_by_id    uuid,
    created_by_name  text,
    created_at       timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT buyer_is_not_seller CHECK (buyer_brand <> seller_brand)
);
CREATE INDEX IF NOT EXISTS idx_internal_purchases_date ON public.internal_purchases(entry_date);

COMMENT ON TABLE public.internal_purchases IS
  'One business buying goods or services from another. Distinct from a '
  'Brand Transfer, which is a loan of capital between businesses. Only '
  'cash or postponed are allowed - digital channels are for real customers.';

-- ---------------------------------------------------------------------
-- 2. Record the purchase, including the dual-role cash shift
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.record_internal_purchase(
    p_buyer_brand   text,
    p_seller_brand  text,
    p_amount        numeric,
    p_payment_method text,
    p_employee_id   uuid    DEFAULT NULL,
    p_cost_amount   numeric DEFAULT NULL,
    p_note          text    DEFAULT NULL,
    p_staff_id      uuid    DEFAULT NULL,
    p_staff_name    text    DEFAULT NULL
) RETURNS json
LANGUAGE plpgsql AS $$
DECLARE
    v_id      uuid;
    v_held    numeric;
    v_method  text;
BEGIN
    IF p_amount IS NULL OR p_amount <= 0 THEN
        RAISE EXCEPTION 'Enter the amount of the purchase.';
    END IF;
    IF p_buyer_brand = p_seller_brand THEN
        RAISE EXCEPTION 'A business cannot buy from itself.';
    END IF;

    v_method := lower(coalesce(p_payment_method,'cash'));
    IF v_method NOT IN ('cash','postponed') THEN
        RAISE EXCEPTION 'Internal purchases are cash or postponed only.';
    END IF;

    IF v_method = 'cash' THEN
        IF p_employee_id IS NULL THEN
            RAISE EXCEPTION 'Who is handling the cash for this purchase?';
        END IF;
        -- The employee must actually be holding enough of the buying
        -- business's cash, otherwise the shift would invent money.
        SELECT coalesce(balance,0) INTO v_held
        FROM public.employee_cash_balances
        WHERE employee_id = p_employee_id AND brand = p_buyer_brand;

        IF coalesce(v_held,0) < p_amount THEN
            RAISE EXCEPTION
              'They are only holding % of %s cash, which is less than %.',
              to_char(coalesce(v_held,0),'FM999999990.00'), p_buyer_brand,
              to_char(p_amount,'FM999999990.00');
        END IF;
    END IF;

    INSERT INTO public.internal_purchases (
        buyer_brand, seller_brand, amount, cost_amount, payment_method,
        handled_by_employee_id, note, created_by_id, created_by_name)
    VALUES (p_buyer_brand, p_seller_brand, p_amount, p_cost_amount, v_method,
        CASE WHEN v_method = 'cash' THEN p_employee_id END,
        p_note, p_staff_id, p_staff_name)
    RETURNING id INTO v_id;

    IF v_method = 'cash' THEN
        -- THE DUAL-ROLE SHIFT (spec section 4).
        -- Same person, same physical notes. The money simply stops belonging
        -- to the buying business and starts belonging to the selling one.
        INSERT INTO public.expense_transactions (
            type, brand, amount, payment_method, from_employee_id, status,
            note, confirmed_by_id, confirmed_by_name, confirmed_at,
            created_by_id, created_by_name)
        VALUES ('cash_out', p_buyer_brand, p_amount, 'cash', p_employee_id, 'confirmed',
            'Internal purchase from ' || p_seller_brand, p_staff_id, p_staff_name, now(),
            p_staff_id, p_staff_name);

        INSERT INTO public.expense_transactions (
            type, brand, amount, payment_method, to_employee_id, status,
            note, confirmed_by_id, confirmed_by_name, confirmed_at,
            created_by_id, created_by_name)
        VALUES ('stock_sale', p_seller_brand, p_amount, 'cash', p_employee_id, 'confirmed',
            'Internal sale to ' || p_buyer_brand, p_staff_id, p_staff_name, now(),
            p_staff_id, p_staff_name);
    ELSE
        -- Postponed: the buying business owes the selling one.
        INSERT INTO public.customer_ar_ledger (
            customer_type, internal_brand, brand, direction, amount,
            reference_type, reference_id, note, created_by_id, created_by_name)
        VALUES ('internal', p_buyer_brand, p_seller_brand, 'charge', p_amount,
            'internal_purchase', v_id, p_note, p_staff_id, p_staff_name);
    END IF;

    RETURN json_build_object('purchase_id', v_id, 'method', v_method, 'amount', p_amount);
END;
$$;

COMMENT ON FUNCTION public.record_internal_purchase IS
  'Section 4 dual-role cash shift. On a cash purchase the buying brand is '
  'debited and the selling brand credited against the SAME employee, so '
  'their physical cash total is unchanged while the ownership moves.';

-- ---------------------------------------------------------------------
-- 3. What each pair of businesses owes each other  (A35)
-- ---------------------------------------------------------------------
CREATE OR REPLACE VIEW public.internal_ar_positions AS
SELECT internal_brand AS debtor_brand,
       brand          AS creditor_brand,
       sum(CASE direction WHEN 'charge' THEN amount ELSE -amount END)::numeric(12,2) AS owed
FROM public.customer_ar_ledger
WHERE customer_type = 'internal'
GROUP BY internal_brand, brand
HAVING sum(CASE direction WHEN 'charge' THEN amount ELSE -amount END) <> 0;

-- Net Offset = min(A/P, A/R) for each pair, per the specification.
CREATE OR REPLACE VIEW public.internal_netting AS
WITH pairs AS (
    SELECT DISTINCT
           least(debtor_brand, creditor_brand)    AS brand_a,
           greatest(debtor_brand, creditor_brand) AS brand_b
    FROM public.internal_ar_positions
)
SELECT p.brand_a,
       p.brand_b,
       coalesce(ab.owed, 0)::numeric(12,2) AS a_owes_b,
       coalesce(ba.owed, 0)::numeric(12,2) AS b_owes_a,
       least(coalesce(ab.owed,0), coalesce(ba.owed,0))::numeric(12,2) AS net_offset,
       (coalesce(ab.owed,0) - coalesce(ba.owed,0))::numeric(12,2)     AS settlement
FROM pairs p
LEFT JOIN public.internal_ar_positions ab
       ON ab.debtor_brand = p.brand_a AND ab.creditor_brand = p.brand_b
LEFT JOIN public.internal_ar_positions ba
       ON ba.debtor_brand = p.brand_b AND ba.creditor_brand = p.brand_a;

COMMENT ON VIEW public.internal_netting IS
  'Net Offset = min(A/P, A/R) per pair of businesses. settlement is what '
  'brand_a still owes brand_b after offsetting; negative means the reverse. '
  'Prepared for an admin to approve, never posted automatically (A35).';

-- ---------------------------------------------------------------------
-- 4. Internal profit elimination  (A31 consequence)
--    Selling at sale price books profit inside the group that is not real
--    group profit. This is what has to come out of consolidated revenue.
-- ---------------------------------------------------------------------
CREATE OR REPLACE VIEW public.internal_profit_elimination AS
SELECT date_trunc('month', entry_date)::date AS month,
       seller_brand,
       buyer_brand,
       sum(amount)::numeric(12,2)                                   AS internal_revenue,
       sum(coalesce(cost_amount, amount))::numeric(12,2)            AS internal_cost,
       sum(amount - coalesce(cost_amount, amount))::numeric(12,2)   AS profit_to_eliminate
FROM public.internal_purchases
GROUP BY 1, 2, 3;

COMMENT ON VIEW public.internal_profit_elimination IS
  'A31: transfers happen at sale price, so each internal sale books profit '
  'that is not real for the group. profit_to_eliminate is what must be '
  'removed from consolidated revenue at month end. Where no cost price was '
  'recorded the margin is treated as zero rather than guessed.';

ALTER TABLE public.internal_purchases ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS staff_all ON public.internal_purchases;
CREATE POLICY staff_all ON public.internal_purchases FOR ALL TO authenticated USING (true) WITH CHECK (true);
