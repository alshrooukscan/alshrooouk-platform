-- Converting physical cash into a digital channel had no way to be recorded.
--
-- What actually happens at the clinic: a member of staff takes the notes a
-- colleague is holding and settles the same amount to the company by card,
-- InstaPay or wallet. The notes become that person's own money; the company
-- ends up with the money in a bank rather than in someone's pocket.
--
-- With nothing for it, an attempt was recorded as a cash_out from the person
-- who PAID (Ahmed) rather than the person who HANDED OVER THE NOTES (Nourhan).
-- The result was backwards: Ahmed went to -400 for cash he never held, and
-- Nourhan still showed the 400 she had already given away.
--
-- Two people are involved and they do different things, so the record has to
-- name both:
--   from_employee_id - whose cash left their hands. This is the balance that
--                      must fall, and it is the only one that changes.
--   to_employee_id   - who settled it digitally. Recorded for accountability;
--                      their cash balance is deliberately untouched, because
--                      they are keeping the notes and have paid for them.
--   payment_method   - the channel it was converted INTO, so the money lands
--                      under visa/instapay/wallet in the totals rather than
--                      still counting as cash.

create or replace view employee_cash_balances as
select employee_id, brand, sum(delta)::numeric(12,2) as balance
from (
  select et.to_employee_id, et.brand, et.amount
    from expense_transactions et
   where et.status = 'confirmed'
     and et.type = any (array['visit_collection','stock_sale','cash_transfer','debt_collection'])
     and et.payment_method = 'cash'
     and et.to_employee_id is not null
  union all
  select et.from_employee_id, et.brand, - et.amount
    from expense_transactions et
   where et.status = 'confirmed'
     and et.type = any (array['cash_transfer','cash_collection'])
     and et.from_employee_id is not null
  union all
  select et.from_employee_id, et.brand, - et.amount
    from expense_transactions et
   where et.status = 'confirmed'
     and et.type = 'cash_out'
     and et.payment_method = 'cash'
     and et.from_employee_id is not null
  union all
  -- Deliberately NOT filtered on payment_method = 'cash': the method here
  -- describes what the money was turned into, while what left the hands was
  -- always cash. Filtering on it would silently drop every conversion and
  -- leave the balance overstated - the exact fault being fixed.
  select et.from_employee_id, et.brand, - et.amount
    from expense_transactions et
   where et.status = 'confirmed'
     and et.type = 'cash_conversion'
     and et.from_employee_id is not null
) t(employee_id, brand, delta)
group by employee_id, brand;

create or replace function public.record_cash_conversion(
  p_brand text,
  p_from_employee_id uuid,
  p_paid_by_employee_id uuid,
  p_amount numeric,
  p_to_method text,
  p_note text,
  p_created_by_id uuid,
  p_created_by_name text
) returns uuid language plpgsql security definer as $$
declare
  v_id uuid;
  v_held numeric;
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
  -- they never had, which is how this went wrong the first time.
  select coalesce(balance, 0) into v_held
    from employee_cash_balances
   where employee_id = p_from_employee_id and brand = p_brand;

  if p_amount > coalesce(v_held, 0) + 0.005 then
    raise exception 'That is more cash than this person is holding for this business (% EGP).',
      trim(to_char(coalesce(v_held, 0), 'FM999999990.00'));
  end if;

  insert into expense_transactions (
    type, brand, amount, payment_method, entry_date, status,
    from_employee_id, to_employee_id, note,
    created_by_id, created_by_name, confirmed_by_id, confirmed_by_name, confirmed_at
  ) values (
    'cash_conversion', p_brand, p_amount, p_to_method, current_date, 'confirmed',
    p_from_employee_id, p_paid_by_employee_id, p_note,
    p_created_by_id, p_created_by_name, p_created_by_id, p_created_by_name, now()
  ) returning id into v_id;

  return v_id;
end;
$$;

-- The type column is constrained to a fixed list, so the new kind of record
-- has to be added to it or every conversion is rejected.
alter table expense_transactions drop constraint if exists expense_transactions_type_check;
alter table expense_transactions add constraint expense_transactions_type_check
  check (type = any (array[
    'cash_out','cash_transfer','cash_collection','brand_transfer',
    'stock_sale','visit_collection','debt_collection','cash_conversion'
  ]));
