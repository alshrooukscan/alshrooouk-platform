-- 0071: the doctor holds one delivery code, from the moment they order.
--
-- The code was only created when a member of staff pressed Assign & Send Code,
-- so between placing the order and someone being sent out, the doctor's portal
-- showed no code at all. The staff side was already complete - Enter Customer
-- Code, four-digit entry, verification, and a clear message with attempts
-- remaining when the digits are wrong - it simply had nothing to check against
-- until late in the flow.
--
-- The code is now issued when the order is placed, so the doctor can read it
-- out to whoever arrives. assign_delivery reuses it rather than generating a
-- fresh one, which would have silently changed the digits under the doctor
-- while they were looking at them.

create or replace function issue_delivery_code_on_order() returns trigger
language plpgsql as $$
begin
  if new.delivery_otp is null then
    new.delivery_otp := lpad((1000 + floor(random() * 9000))::int::text, 4, '0');
    new.otp_attempts := coalesce(new.otp_attempts, 0);
  end if;
  return new;
end;
$$;

drop trigger if exists trg_issue_delivery_code_on_order on dental_orders;
create trigger trg_issue_delivery_code_on_order
  before insert on dental_orders
  for each row execute function issue_delivery_code_on_order();

-- orders already open and still without a code get one now
update dental_orders
   set delivery_otp = lpad((1000 + floor(random() * 9000))::int::text, 4, '0'),
       otp_attempts = coalesce(otp_attempts, 0)
 where delivery_otp is null
   and status not in ('delivered', 'cancelled');
CREATE OR REPLACE FUNCTION public.assign_delivery(p_order_id uuid, p_employee_id uuid DEFAULT NULL::uuid, p_staff_id uuid DEFAULT NULL::uuid, p_staff_name text DEFAULT NULL::text)
 RETURNS json
 LANGUAGE plpgsql
AS $function$
DECLARE
    v_order dental_orders;
    v_emp   uuid;
    v_src   text;
    v_otp   text;
BEGIN
    SELECT * INTO v_order FROM public.dental_orders WHERE id = p_order_id FOR UPDATE;
    IF v_order.id IS NULL THEN RAISE EXCEPTION 'Order not found.'; END IF;
    IF v_order.status IN ('delivered','cancelled') THEN
        RAISE EXCEPTION 'This order is already %.', v_order.status;
    END IF;

    IF p_employee_id IS NOT NULL THEN
        v_emp := p_employee_id; v_src := 'manual';
    ELSE
        SELECT employee_id, source INTO v_emp, v_src FROM public.pick_delivery_user();
    END IF;

    IF v_emp IS NULL THEN
        RAISE EXCEPTION 'Nobody holds the Material Admin skill and no receptionist is on shift. Please choose someone.';
    END IF;

    -- 4 digits, 1000-9999 so it is never shown with a leading zero.
    -- Reuse the code the doctor already holds. It is issued when the order is
   -- placed and shown in their portal from that moment, so generating a fresh
   -- one here would silently invalidate the digits they are reading out.
   v_otp := coalesce(nullif(trim(v_order.delivery_otp), ''),
                     lpad((1000 + floor(random() * 9000))::int::text, 4, '0'));

    UPDATE public.dental_orders
       SET assigned_to_employee_id = v_emp,
           assigned_at             = now(),
           assignment_source       = v_src,
           status                  = 'in_transit',
           delivery_otp            = v_otp,
           otp_sent_at             = now(),
           otp_attempts            = 0
     WHERE id = p_order_id
     RETURNING * INTO v_order;

    RETURN json_build_object(
        'order_id',    p_order_id,
        'assigned_to', v_emp,
        'source',      v_src,
        'otp',         v_otp,
        'status',      v_order.status
    );
END;
$function$
;