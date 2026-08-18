-- Backfill cash_ledger from real migrated visit payments, so the P&L dashboard
-- reflects genuine historical revenue instead of showing zero for pre-migration activity.
-- Only visits with an actual amount_paid > 0 generate an entry (matches real cash collected,
-- not amount_due, which can include unpaid/partial amounts).

insert into cash_ledger (source_stream, direction, amount, branch_id, reference_type, reference_id, entry_date)
select 'scans', 'in', v.amount_paid, v.branch_id, 'visit_migration', v.id, coalesce(v.exam_date, current_date)
from visits v
where v.amount_paid > 0
and not exists (
  select 1 from cash_ledger cl where cl.reference_type = 'visit_migration' and cl.reference_id = v.id
);
