-- Wires every NEW visit payment into Expenses Management automatically, so
-- a cash-paid patient shows up in Scan Cash immediately with no separate
-- manual step. Deliberately attached only after the historical backfill of
-- existing visits into visit_payments (migration 0038) - so years of old
-- payments don't flood today's cash figures with fabricated transactions.
-- Auto-confirmed on insert, the same way stock_sale already is - a routine
-- payment being logged isn't a risk event requiring admin sign-off the way
-- Cash Out or a Brand Transfer is.
create or replace function sync_visit_payment_to_expenses()
returns trigger
language plpgsql
as $$
declare
  v_method text;
begin
  v_method := lower(regexp_replace(new.payment_method, '\s+', '_', 'g'));
  if v_method = 'wallet' then
    v_method := 'vodafone_cash'; -- "Wallet" on the visit form means the same mobile-wallet method Expenses Management calls Vodafone Cash
  end if;
  if v_method not in ('cash', 'visa', 'instapay', 'vodafone_cash') then
    v_method := 'cash'; -- safe fallback for any unexpected/legacy value, never silently drop the entry
  end if;

  insert into expense_transactions (
    type, brand, amount, payment_method, entry_date, status,
    created_by_id, created_by_name, confirmed_by_id, confirmed_by_name, confirmed_at,
    note
  ) values (
    'visit_collection', 'scan', new.amount, v_method, (new.paid_at at time zone 'utc')::date, 'confirmed',
    new.created_by_id, new.created_by_name, new.created_by_id, new.created_by_name, now(),
    'Auto-logged from a visit payment'
  );
  return new;
end;
$$;

drop trigger if exists trg_visit_payment_to_expenses on visit_payments;
create trigger trg_visit_payment_to_expenses
  after insert on visit_payments
  for each row execute function sync_visit_payment_to_expenses();
