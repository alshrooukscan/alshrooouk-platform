-- 0068: restore staff writes to expense_transactions. My 0064 broke them.
--
-- 0064 locked three money ledgers to read-only on the strength of a check that
-- found no browser writes to them. That check was wrong: it looked for the
-- write on the same line as the table name, and every one of these is a
-- multi-line chain - .from("expense_transactions") on one line, .update() four
-- lines below. Seven real write paths went unseen.
--
-- The result was the worst kind of failure. A row blocked by RLS matches
-- nothing and raises nothing, so "I received this" in Action Center returned
-- success and changed nothing at all. Nourhan reported it against a cash
-- transfer she could not confirm. Reproduced exactly before this fix: zero
-- rows affected, status unchanged, no error shown.
--
-- Broken by it: confirming a cash collection, confirming a received transfer,
-- creating a brand transfer, and three cash-out paths in Brands Cash.
--
-- expense_transactions goes back to being writable by signed-in staff. This
-- restores the day-to-day work first; moving these writes behind RPCs is the
-- right end state and is a separate, tested piece of work, not something to
-- attempt while cash handling is broken.
--
-- cash_ledger and customer_ar_ledger stay read-only. The same corrected scan
-- confirms they genuinely have no browser writes - every row reaches them
-- through a trigger or an RPC.

create policy staff_write_expenses on expense_transactions
  for insert to authenticated with check (true);

create policy staff_update_expenses on expense_transactions
  for update to authenticated using (true) with check (true);
