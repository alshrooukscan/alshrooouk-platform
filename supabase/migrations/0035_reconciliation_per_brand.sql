-- Today's Cash Reconciliation now covers all three brands, not just Scan -
-- each brand's cash is physically separate, so each gets its own row and
-- its own confirmation, not one shared button covering money nobody
-- actually counted together.
alter table cash_reconciliation add column if not exists brand text not null default 'scan' check (brand in ('scan','dental_stock','el3awama_stock'));
alter table cash_reconciliation drop constraint if exists cash_reconciliation_entry_date_key;
alter table cash_reconciliation add constraint cash_reconciliation_entry_date_brand_key unique (entry_date, brand);
