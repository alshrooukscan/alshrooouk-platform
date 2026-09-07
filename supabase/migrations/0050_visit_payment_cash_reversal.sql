-- A visit payment mirrors itself into expense_transactions so the cash shows
-- up in the collector's custody. That mirror was INSERT-only: deleting a visit
-- removed the payment but left the cash entry standing forever, so a duplicate
-- visit that staff deleted kept inflating the balance. A receptionist settled
-- her cash and the screen still showed 960 EGP more than she held.
--
-- It could not even be repaired automatically, because the mirror row carried
-- no reference back to the payment that created it. This adds that link first,
-- then keeps the two in step on update and delete.

alter table expense_transactions add column if not exists source_payment_id uuid;

comment on column expense_transactions.source_payment_id is
  'The visit_payments row this cash entry mirrors. Set by sync_visit_payment_to_expenses so the entry can be corrected or reversed when the payment changes or is deleted.';

create index if not exists expense_transactions_source_payment_idx
  on expense_transactions (source_payment_id) where source_payment_id is not null;

-- Backfill only where a payment matches unambiguously on both the trigger
-- timestamp and the amount. Historical rows imported in bulk share one
-- created_at and cannot be paired this way, so they are deliberately left
-- unlinked rather than guessed at - a wrong link would let a future delete
-- reverse the wrong money.
update expense_transactions et
set source_payment_id = vp.id
from visit_payments vp
where et.type = 'visit_collection'
  and et.note = 'Auto-logged from a visit payment'
  and et.source_payment_id is null
  and vp.paid_at = et.created_at
  and vp.amount::numeric = et.amount
  and (select count(*) from visit_payments v2
       where v2.paid_at = et.created_at and v2.amount::numeric = et.amount) = 1;

create or replace function public.sync_visit_payment_to_expenses()
returns trigger language plpgsql security definer as $$
declare
  v_method text;
  v_employee_id uuid;
begin
  v_method := lower(regexp_replace(new.payment_method, '\s+', '_', 'g'));
  -- 'wallet' is the canonical key platform-wide; vodafone_cash is the retired
  -- name for the same method and is folded into it, not the other way round.
  if v_method = 'vodafone_cash' then
    v_method := 'wallet';
  end if;
  if v_method not in ('cash', 'visa', 'instapay', 'wallet') then
    v_method := 'cash';
  end if;

  -- Cash in hand must only move for CASH. Visa, InstaPay and wallet payments
  -- never pass through anyone's pocket, so crediting the employee for them
  -- would show them holding money they never received and can't hand over.
  --
  -- created_by_id is a staff_profiles id; the cash ledger is keyed on employees.
  -- staff_account_email is the link between the two.
  if v_method = 'cash' and new.created_by_id is not null then
    select e.id into v_employee_id
    from employees e
    join staff_profiles s on lower(s.email) = lower(e.staff_account_email)
    where s.id = new.created_by_id
    limit 1;
  end if;

  insert into expense_transactions (
    type, brand, amount, payment_method, entry_date, status,
    created_by_id, created_by_name, confirmed_by_id, confirmed_by_name, confirmed_at,
    to_employee_id, note, source_payment_id
  ) values (
    'visit_collection', 'scan', new.amount, v_method, (new.paid_at at time zone 'utc')::date, 'confirmed',
    new.created_by_id, new.created_by_name, new.created_by_id, new.created_by_name, now(),
    v_employee_id, 'Auto-logged from a visit payment', new.id
  );
  return new;
end;
$$;

-- The mirror is a copy of the payment, not a record in its own right: when the
-- payment goes, so must it. Only rows this trigger created are touched -
-- source_payment_id is what proves that.
create or replace function public.remove_visit_payment_from_expenses()
returns trigger language plpgsql security definer as $$
begin
  delete from expense_transactions where source_payment_id = old.id;
  return old;
end;
$$;

drop trigger if exists trg_visit_payment_expenses_delete on visit_payments;
create trigger trg_visit_payment_expenses_delete
  after delete on visit_payments
  for each row execute function remove_visit_payment_from_expenses();

-- A corrected amount or payment method has to reach the cash entry too,
-- otherwise editing a payment leaves custody reflecting the old figure.
create or replace function public.update_visit_payment_in_expenses()
returns trigger language plpgsql security definer as $$
declare
  v_method text;
begin
  v_method := lower(regexp_replace(new.payment_method, '\s+', '_', 'g'));
  if v_method = 'vodafone_cash' then v_method := 'wallet'; end if;
  if v_method not in ('cash', 'visa', 'instapay', 'wallet') then v_method := 'cash'; end if;

  update expense_transactions
     set amount = new.amount,
         payment_method = v_method,
         entry_date = (new.paid_at at time zone 'utc')::date,
         -- Cash is the only method that sits in someone's hands. If a payment
         -- is corrected from cash to card, the custody credit has to go with it.
         to_employee_id = case when v_method = 'cash' then to_employee_id else null end
   where source_payment_id = new.id;
  return new;
end;
$$;

drop trigger if exists trg_visit_payment_expenses_update on visit_payments;
create trigger trg_visit_payment_expenses_update
  after update on visit_payments
  for each row execute function update_visit_payment_in_expenses();
