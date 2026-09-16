-- 0103: the database refuses a wrong id instead of accepting it silently.
--
-- The Visa deduction rule wrote a staff login id into a column that expects an
-- employee record. It was found weeks later, and only because the rule was run
-- by hand - it had failed silently until then. Thirty-three identity links had
-- no key at all, so nothing in the database could have caught it.
--
-- These are the ones where the relationship is genuinely single-target and
-- every existing value resolves. Checked one at a time rather than assumed:
-- every populated created_by_id in the platform points at staff_profiles,
-- 100 percent, across seven tables - and every code path that writes one does
-- so from a staff session. No portal route touches them.
--
-- ON DELETE SET NULL, not CASCADE. A staff member leaving must never delete the
-- payments they recorded; the record stays and loses its author.
--
-- Deliberately NOT added:
--
--   counter_sales.customer_id - all fifteen rows point at a doctor today, but
--   the column is polymorphic by design and carries a customer_type beside it.
--   A key to doctors would work until the first sale to a clinic and then stop
--   the till.
--
--   customer_ar_ledger.customer_id - polymorphic for the same reason, and it
--   now holds clinic ids after counter sales were moved onto the clinic.
--
--   visits.visit_group_id - resolves to nothing because it is not a pointer. It
--   is a shared value that ties split visits together, so there is no parent
--   row for it to reference.

alter table visit_payments
  add constraint visit_payments_created_by_fk
  foreign key (created_by_id) references staff_profiles(id) on delete set null;

alter table counter_sales
  add constraint counter_sales_created_by_fk
  foreign key (created_by_id) references staff_profiles(id) on delete set null;

alter table expense_transactions
  add constraint expense_transactions_created_by_fk
  foreign key (created_by_id) references staff_profiles(id) on delete set null;

alter table customer_ar_ledger
  add constraint customer_ar_ledger_created_by_fk
  foreign key (created_by_id) references staff_profiles(id) on delete set null;

alter table invoices
  add constraint invoices_created_by_fk
  foreign key (created_by_id) references staff_profiles(id) on delete set null;

alter table vendor_requests
  add constraint vendor_requests_created_by_fk
  foreign key (created_by_id) references staff_profiles(id) on delete set null;

-- Named assigned_to_employee_id but holding a staff login id, which is exactly
-- the confusion that caused the original fault. The key states which one it is.
alter table reports
  add constraint reports_assigned_to_staff_fk
  foreign key (assigned_to_employee_id) references staff_profiles(id) on delete set null;

alter table paymob_verification_reviews
  add constraint paymob_reviews_visit_fk
  foreign key (visit_id) references visits(id) on delete cascade;

alter table payment_method_corrections
  add constraint payment_method_corrections_visit_fk
  foreign key (visit_id) references visits(id) on delete cascade;
