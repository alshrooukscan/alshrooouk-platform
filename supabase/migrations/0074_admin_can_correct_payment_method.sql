-- 0074: an admin can correct a payment method, and the correction is recorded.
--
-- Every write to visit_payments in the whole application is an insert. A
-- payment logged as Cash when it was taken on the card could not be corrected
-- by anyone, admin included - the only remedy was another payment row, which
-- distorts the totals rather than fixing them.
--
-- Admin only, and the original is never quietly overwritten: every correction
-- writes a row naming the old method, the new one, who changed it, when, and
-- why. Payment records are the last thing in this system that should change
-- without a trace - the August import already showed what silent rewriting
-- of payments costs.
--
-- The custody consequence is the real work. Cash sits in a named employee's
-- hands and the cash pages are built on that. Correcting Cash to Visa must
-- take the money out of their hands; correcting Visa to Cash must put it in.
-- update_visit_payment_in_expenses already cleared the credit when moving off
-- cash, but moving TO cash left it empty - so the money appeared in the
-- brand's cash with nobody holding it. Repaired here.

create table if not exists payment_method_corrections (
  id uuid primary key default gen_random_uuid(),
  payment_id uuid not null references visit_payments(id) on delete cascade,
  visit_id uuid,
  old_method text not null,
  new_method text not null,
  reason text not null,
  corrected_by_id uuid,
  corrected_by_name text,
  corrected_at timestamptz not null default now()
);

create index if not exists idx_pmc_payment on payment_method_corrections(payment_id);

-- moving TO cash has to name the hands the money is now in
create or replace function update_visit_payment_in_expenses() returns trigger
language plpgsql as $$
declare
  v_method text;
  v_employee_id uuid;
begin
  v_method := lower(regexp_replace(new.payment_method, '\s+', '_', 'g'));
  if v_method = 'vodafone_cash' then v_method := 'wallet'; end if;
  if v_method not in ('cash', 'visa', 'instapay', 'wallet') then v_method := 'cash'; end if;

  if v_method = 'cash' then
    select e.id into v_employee_id
      from expense_transactions x
      join employees e on e.id = x.to_employee_id
     where x.source_payment_id = new.id
     limit 1;

    if v_employee_id is null and new.created_by_id is not null then
      select e.id into v_employee_id
        from employees e
        join staff_profiles s on lower(s.email) = lower(e.staff_account_email)
       where s.id = new.created_by_id
       limit 1;
    end if;
  end if;

  update expense_transactions
     set amount = new.amount,
         payment_method = v_method,
         entry_date = (new.paid_at at time zone 'utc')::date,
         to_employee_id = case when v_method = 'cash' then v_employee_id else null end
   where source_payment_id = new.id;
  return new;
end;
$$;

create or replace function correct_payment_method(
  p_payment_id uuid, p_new_method text, p_reason text,
  p_staff_id uuid, p_staff_name text
) returns json
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_old text;
  v_visit uuid;
  v_is_admin boolean;
begin
  select (role = 'admin') into v_is_admin from staff_profiles where id = p_staff_id;
  if not coalesce(v_is_admin, false) then
    raise exception 'Only an admin can correct a payment method.';
  end if;

  if coalesce(trim(p_reason), '') = '' or length(trim(p_reason)) < 5 then
    raise exception 'Please give a reason for the correction.';
  end if;

  if p_new_method not in ('Cash', 'Visa', 'InstaPay', 'Wallet') then
    raise exception 'Not a payment method this clinic takes.';
  end if;

  select payment_method, visit_id into v_old, v_visit
    from visit_payments where id = p_payment_id;
  if v_old is null then raise exception 'That payment no longer exists.'; end if;
  if v_old = p_new_method then raise exception 'That is already the method on this payment.'; end if;

  update visit_payments set payment_method = p_new_method where id = p_payment_id;

  insert into payment_method_corrections
    (payment_id, visit_id, old_method, new_method, reason, corrected_by_id, corrected_by_name)
  values (p_payment_id, v_visit, v_old, p_new_method, trim(p_reason), p_staff_id, p_staff_name);

  return json_build_object('payment_id', p_payment_id, 'from', v_old, 'to', p_new_method);
end;
$$;
