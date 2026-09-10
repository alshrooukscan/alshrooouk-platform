-- 0070: the manager override path had the same fault as 0069.
--
-- override_delivery closes a delivery when the code cannot be used - a lost
-- phone, too many failed attempts - and it raised the postponed charge against
-- the doctor exactly as verify_delivery_otp did. Same consequence: the money
-- recorded on an account nothing totals, and the clinic balance unmoved. It
-- is the path used when a delivery is already going wrong, so it is the last
-- place a silent loss should sit.

CREATE OR REPLACE FUNCTION public.override_delivery(p_order_id uuid, p_reason text, p_staff_id uuid DEFAULT NULL::uuid, p_staff_name text DEFAULT NULL::text)
 RETURNS json
 LANGUAGE plpgsql
AS $function$
DECLARE
    v_order dental_orders;
    v_charge json := NULL;
BEGIN
    IF p_reason IS NULL OR length(trim(p_reason)) < 5 THEN
        RAISE EXCEPTION 'Please give a reason for closing this delivery without the customer code.';
    END IF;

    SELECT * INTO v_order FROM public.dental_orders WHERE id = p_order_id FOR UPDATE;
    IF v_order.id IS NULL THEN RAISE EXCEPTION 'Order not found.'; END IF;
    IF v_order.status = 'delivered' THEN RAISE EXCEPTION 'This order is already delivered.'; END IF;

    UPDATE public.dental_orders
       SET status            = 'delivered',
           delivered_at      = now(),
           delivered_by_id   = coalesce(p_staff_id, delivered_by_id),
           delivered_by_name = coalesce(p_staff_name, delivered_by_name),
           override_by_id    = p_staff_id,
           override_by_name  = p_staff_name,
           override_reason   = trim(p_reason),
           override_at       = now(),
           needs_review      = true
     WHERE id = p_order_id
     RETURNING * INTO v_order;

    IF v_order.pay_later THEN
        v_charge := public.record_ar_charge(
            coalesce((select a.customer_type from ar_customer_for_doctor(v_order.doctor_id) a),'doctor'),
    coalesce((select a.customer_id from ar_customer_for_doctor(v_order.doctor_id) a), v_order.doctor_id),
    'dental_stock',
            coalesce(v_order.total_amount,0) - coalesce(v_order.amount_paid,0),
            'dental_order', p_order_id, 'Postponed on delivery (override)',
            p_staff_id, p_staff_name, false);
    END IF;

    RETURN json_build_object('order_id', p_order_id, 'status', 'delivered',
                             'overridden', true, 'ar_charge', v_charge);
END;
$function$
;