-- Doctors could not place any order at all:
--   "Could not choose the best candidate function between:
--    place_dental_order(p_doctor_id, p_payment_method, p_items, p_pay_later),
--    place_dental_order(p_doctor_id, p_payment_method, p_pay_later, p_items)"
--
-- My fault. The backorder rewrite in 0051 declared the same parameters in a
-- different ORDER than the version it was meant to replace. CREATE OR REPLACE
-- matches on the argument type list, so a different order is a different
-- signature: Postgres created a NEW overload and left both older ones in place.
--
-- The caller passes named arguments, which every overload could satisfy, so
-- Postgres refused to guess and rejected the call. Nothing was broken in the
-- new function itself - it just could no longer be reached.
--
-- Dropping the superseded signatures explicitly. Only the four-argument version
-- with p_pay_later before p_items carries the backorder logic; the other two
-- still reject a basket outright when any item is short, which is the very
-- behaviour 0051 removed.
drop function if exists public.place_dental_order(uuid, text, jsonb);
drop function if exists public.place_dental_order(uuid, text, jsonb, boolean);
