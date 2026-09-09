-- 0064: the three money ledgers become read-only to the browser.
--
-- expense_transactions, customer_ar_ledger and cash_ledger each carried a
-- single policy of qual 'true' for cmd 'ALL', so any signed-in member of staff
-- could rewrite any row from the browser console - including cash entries
-- attributed to somebody else. None of these tables is written from the
-- browser: every row arrives through a trigger or an RPC. Reading stays open;
-- writing goes back to the functions that were always supposed to do it.
--
-- Five of those functions ran as the caller, so locking the tables would have
-- broken them. They are the sanctioned write paths, so they now run with the
-- rights of their owner, each pinned to an explicit search_path so the name
-- resolution cannot be redirected by a caller-set path.

alter function record_ar_charge(p_customer_type text, p_customer_id uuid, p_brand text, p_amount numeric, p_reference_type text, p_reference_id uuid, p_note text, p_staff_id uuid, p_staff_name text, p_override_limit boolean) security definer set search_path = public, pg_temp;
alter function record_counter_sale(p_brand text, p_sale_type text, p_items jsonb, p_payment_method text, p_customer_type text, p_customer_id uuid, p_employee_id uuid, p_tab_pin text, p_collected_by uuid, p_staff_id uuid, p_staff_name text, p_note text) security definer set search_path = public, pg_temp;
alter function record_debt_payment(p_customer_type text, p_customer_id uuid, p_brand text, p_amount numeric, p_payment_method text, p_staff_id uuid, p_staff_name text, p_employee_id uuid, p_cash_acknowledged boolean, p_note text) security definer set search_path = public, pg_temp;
alter function record_internal_purchase(p_buyer_brand text, p_seller_brand text, p_amount numeric, p_payment_method text, p_employee_id uuid, p_cost_amount numeric, p_note text, p_staff_id uuid, p_staff_name text) security definer set search_path = public, pg_temp;
alter function settle_dental_order(p_order_id uuid, p_amount numeric, p_payment_method text, p_staff_id uuid, p_staff_name text, p_employee_id uuid) security definer set search_path = public, pg_temp;

drop policy if exists staff_all on expense_transactions;
drop policy if exists staff_all on customer_ar_ledger;
drop policy if exists staff_all on cash_ledger;

create policy staff_read on expense_transactions for select to authenticated using (true);
create policy staff_read on customer_ar_ledger  for select to authenticated using (true);
create policy staff_read on cash_ledger         for select to authenticated using (true);
