-- 0125: converting cash to Visa / InstaPay / wallet needs an admin, and a Visa
-- conversion is matched to its Paymob charge (Mohamed Said, 30 Oct 2026).
-- Nourhan's 300 EGP conversion (29 Oct) was recorded and confirmed by Nourhan;
-- the card charge (300, card 8340, 21:14) existed on Paymob but nothing tied
-- the two together.

ALTER TABLE paymob_transactions ADD COLUMN IF NOT EXISTS matched_expense_id uuid REFERENCES expense_transactions(id) ON DELETE SET NULL;
ALTER TABLE expense_transactions ADD COLUMN IF NOT EXISTS paymob_transaction_id bigint REFERENCES paymob_transactions(id) ON DELETE SET NULL;

-- Link one Visa conversion to the unclaimed Paymob charge of the same amount
-- closest in time (3 hours before to 30 minutes after it was recorded).
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
     AND abs(p.amount - e.amount) < 0.01
     AND p.created_at_paymob BETWEEN v_at - interval '3 hours' AND v_at + interval '30 minutes'
   ORDER BY abs(extract(epoch FROM (p.created_at_paymob - v_at)))
   LIMIT 1;
  IF v_tx IS NULL THEN RETURN NULL; END IF;
  UPDATE paymob_transactions SET matched_expense_id = e.id, matched_at = now(), review_status = 'matched' WHERE id = v_tx;
  UPDATE expense_transactions SET paymob_transaction_id = v_tx WHERE id = e.id;
  RETURN v_tx;
END $f$;

CREATE OR REPLACE FUNCTION public.record_cash_conversion(p_brand text, p_from_employee_id uuid, p_paid_by_employee_id uuid, p_amount numeric, p_to_method text, p_note text, p_created_by_id uuid, p_created_by_name text)
 RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $function$
declare
  v_id uuid;
  v_held numeric;
  v_pending numeric;
  v_admin boolean;
begin
  if p_amount is null or p_amount <= 0 then
    raise exception 'Enter an amount greater than zero.';
  end if;
  if p_to_method not in ('visa','instapay','wallet') then
    raise exception 'Cash can only be converted to Visa, InstaPay or a wallet.';
  end if;
  if p_from_employee_id is null then
    raise exception 'Say whose cash is being converted.';
  end if;

  -- Converting more than someone is holding would push them negative for money
  -- they never had. Cash already in a conversion waiting for an admin counts
  -- as spoken for, so the same notes cannot be converted twice.
  select coalesce(balance, 0) into v_held
    from employee_cash_balances
   where employee_id = p_from_employee_id and brand = p_brand;
  select coalesce(sum(amount), 0) into v_pending
    from expense_transactions
   where type = 'cash_conversion' and status = 'pending'
     and from_employee_id = p_from_employee_id and brand = p_brand;

  if p_amount > coalesce(v_held, 0) - v_pending + 0.005 then
    raise exception 'That is more cash than this person is holding for this business (% EGP%).',
      trim(to_char(coalesce(v_held, 0) - v_pending, 'FM999999990.00')),
      case when v_pending > 0 then ', after ' || trim(to_char(v_pending, 'FM999999990.00')) || ' already waiting for an admin' else '' end;
  end if;

  -- An admin's conversion is their own decision; anyone else's waits for one.
  select exists (select 1 from staff_profiles where id = p_created_by_id and role = 'admin') into v_admin;

  insert into expense_transactions (
    type, brand, amount, payment_method, entry_date, status,
    from_employee_id, to_employee_id, note,
    created_by_id, created_by_name, confirmed_by_id, confirmed_by_name, confirmed_at
  ) values (
    'cash_conversion', p_brand, p_amount, p_to_method, (now() at time zone 'Africa/Cairo')::date,
    case when v_admin then 'confirmed' else 'pending' end,
    p_from_employee_id, p_paid_by_employee_id, p_note,
    p_created_by_id, p_created_by_name,
    case when v_admin then p_created_by_id end, case when v_admin then p_created_by_name end, case when v_admin then now() end
  ) returning id into v_id;

  if p_to_method = 'visa' then perform public.match_conversion_paymob(v_id); end if;
  return v_id;
end;
$function$;

-- The Visa conversions already recorded.
DO $$ DECLARE x record; BEGIN
  FOR x IN SELECT id FROM expense_transactions WHERE type = 'cash_conversion' AND payment_method = 'visa' AND paymob_transaction_id IS NULL ORDER BY created_at LOOP
    PERFORM public.match_conversion_paymob(x.id);
  END LOOP;
END $$;

REVOKE ALL ON FUNCTION public.match_conversion_paymob(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.match_conversion_paymob(uuid) TO authenticated, service_role;
