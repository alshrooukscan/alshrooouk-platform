-- Phase 5: cash_ledger policy + auto-wiring triggers from invoices, stock, payroll

drop policy if exists staff_all on public.cash_ledger;
create policy staff_all on public.cash_ledger for all to authenticated using (true) with check (true);

alter table cash_ledger drop constraint if exists cash_ledger_source_stream_check;
alter table cash_ledger add constraint cash_ledger_source_stream_check check (source_stream in ('scans','el3awama','stock','payroll'));

create or replace function trg_invoice_cash_in() returns trigger as $$
declare
  v_branch uuid;
begin
  select branch_id into v_branch from visits where id = new.visit_id;
  insert into cash_ledger (source_stream, direction, amount, branch_id, reference_type, reference_id, entry_date)
  values ('scans', 'in', new.amount, v_branch, 'invoice', new.id, coalesce(new.exam_date, current_date));
  return new;
end;
$$ language plpgsql security definer;

drop trigger if exists on_invoice_insert on invoices;
create trigger on_invoice_insert after insert on invoices
for each row execute function trg_invoice_cash_in();

create or replace function trg_stock_txn_cash() returns trigger as $$
declare
  v_category text;
  v_stream text;
  v_direction text;
begin
  select category into v_category from stock_items where id = new.item_id;
  v_stream := case when v_category = 'el3awama' then 'el3awama' else 'stock' end;
  v_direction := case when new.type = 'sale' then 'in' else 'out' end;
  insert into cash_ledger (source_stream, direction, amount, reference_type, reference_id, entry_date)
  values (v_stream, v_direction, new.total, 'stock_transaction', new.id, coalesce(new.transaction_date, current_date));
  return new;
end;
$$ language plpgsql security definer;

drop trigger if exists on_stock_txn_insert on stock_transactions;
create trigger on_stock_txn_insert after insert on stock_transactions
for each row execute function trg_stock_txn_cash();

create or replace function trg_payroll_cash_out() returns trigger as $$
begin
  insert into cash_ledger (source_stream, direction, amount, reference_type, reference_id, entry_date)
  values ('payroll', 'out', new.net_total, 'payroll_run', new.id, current_date);
  return new;
end;
$$ language plpgsql security definer;

drop trigger if exists on_payroll_insert on payroll_runs;
create trigger on_payroll_insert after insert on payroll_runs
for each row execute function trg_payroll_cash_out();
