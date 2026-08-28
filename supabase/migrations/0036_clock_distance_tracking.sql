-- Always store the computed distance from the clinic, not just raw lat/lng -
-- this makes "was this an out-of-range confirmed sign-in" directly queryable
-- later (distance_from_clinic_meters > 250) without recomputing anything,
-- and is exactly the kind of record that matters if a clock-in is ever
-- disputed for payroll purposes.
alter table timeclock_events add column if not exists distance_from_clinic_meters numeric;
