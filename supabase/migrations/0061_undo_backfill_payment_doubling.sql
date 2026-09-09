-- 0061: undo the payment doubling left by the 29 Aug 2026 backfill.
--
-- 375 visits carried a payment of exactly twice their charge. The charge was
-- never wrong: 3D CBCT Both Arch lists at 1950, less the 20% discount, is the
-- 1560 recorded - it is the payment beside it, 3120, that is wrong.
--
-- All 375 come from a single backfill that wrote 4,309 payment rows at
-- 2026-08-29 15:05:01.403904, every one of them without a staff name. No
-- payment entered through the app has ever doubled, and since migration 0056
-- the over-collection trigger refuses one, so this is closed history rather
-- than a live fault.
--
-- The payment comes down to meet the charge. Recorded revenue falls by
-- 363,100 EGP - money that was never taken and should not have been counted.
-- Cash figures do not move: none of these payments has an expense row.
--
-- Every original value is kept in payment_doubling_backup_0061 so this is
-- reversible.

create table if not exists payment_doubling_backup_0061 (
  pay_id uuid primary key,
  visit_id uuid not null,
  old_amount numeric not null,
  new_amount numeric not null,
  old_visit_amount_paid numeric not null,
  backed_up_at timestamptz not null default now()
);

insert into payment_doubling_backup_0061 (pay_id, visit_id, old_amount, new_amount, old_visit_amount_paid)
select p.id, v.id, p.amount, v.amount_due, v.amount_paid
from visit_payments p join visits v on v.id = p.visit_id
where v.amount_due > 0 and v.amount_paid = v.amount_due * 2
on conflict (pay_id) do nothing;

update visit_payments p
set amount = b.new_amount
from payment_doubling_backup_0061 b
where p.id = b.pay_id and p.amount = b.old_amount;
