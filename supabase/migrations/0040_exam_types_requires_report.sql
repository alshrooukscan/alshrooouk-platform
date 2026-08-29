-- Whether a scan needs a report tracked at all. Defaults to true since every
-- existing scan type has always implicitly needed one - this only matters
-- going forward for scans that explicitly should NOT show up in the
-- pending-reports tracking (Phase 5).
alter table exam_types add column if not exists requires_report boolean not null default true;
