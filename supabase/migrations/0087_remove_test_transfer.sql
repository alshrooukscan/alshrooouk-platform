-- 0087: remove the 20,000 EGP test transfer.
--
-- Logged by Mohamed Said at 19:10 on 12 September while testing, from Doaa
-- Tarek Mohamed to Nourhan Ahmed Saleh. Confirmed with him as a test rather
-- than a real movement.
--
-- Safe to remove outright: it never left pending, so it never touched anybody's
-- balance, and nothing else refers to it - no cash ledger row, no payment
-- behind it. Deleting a confirmed transfer would be a different matter
-- entirely and is not what this does.
--
-- Removing it also unblocks the two genuine transfers beside it. Doaa holds
-- 6,070 EGP against 26,040 EGP pending; with this gone, 6,040 remains pending
-- and both can be confirmed normally.
--
-- Kept in removed_transactions_backup_0087 so the row can be read back if
-- anybody asks what became of it.

create table if not exists removed_transactions_backup_0087 as
  select t.*, now() as removed_at, 'Test entry, confirmed with Mohamed Said'::text as reason
  from expense_transactions t where false;

insert into removed_transactions_backup_0087
select t.*, now(), 'Test entry, confirmed with Mohamed Said'
from expense_transactions t
where t.id = 'c47a4e18-8b0f-46d1-bc55-2f6dda57866a'
  and t.status = 'pending'
  and t.amount = 20000;

delete from expense_transactions t
where t.id = 'c47a4e18-8b0f-46d1-bc55-2f6dda57866a'
  and t.status = 'pending'
  and t.amount = 20000;
