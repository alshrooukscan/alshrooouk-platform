-- Visits have always stored their scan types as an array of NAME strings.
-- That made the edit form re-match those names against exam_types by string
-- every time it opened, and any rename or deactivation in Settings silently
-- broke every past visit that used the old name: the scan checkboxes came up
-- empty and the amount recalculated from zero. 851 of 4894 visits (17%) were
-- already in that state.
--
-- exam_type_ids is the durable link. scan_types stays exactly as it is - it is
-- the human-readable label shown across the dashboard, portals, invoices,
-- WhatsApp messages and analytics, and it is also the only record of what a
-- visit was when its scan type no longer exists at all. The id array is
-- additive, not a replacement.
alter table visits add column if not exists exam_type_ids uuid[];

comment on column visits.exam_type_ids is
  'Durable exam_types references, positionally aligned with scan_types where a match exists. scan_types remains the display label and the system of record for legacy names that map to no current exam type. Written alongside scan_types on create and edit.';

-- Backfill on a normalized name match: case, whitespace and punctuation are
-- ignored, so "3D CBCT Endo one tooth" resolves to "3D CBCT Endo One Tooth"
-- and "2D Panoramic +Ceph Image" to "2D Panoramic + Ceph Image". Inactive
-- exam types are eligible on purpose - a visit that used a since-retired scan
-- type should still resolve to it. Where two rows normalize alike, the active
-- one wins, then the older one, so the result is deterministic.
--
-- Positions with no match are left as NULL rather than skipped, so index N of
-- exam_type_ids always corresponds to index N of scan_types. Collapsing them
-- would silently shift every id after the gap onto the wrong name.
with m as (
  select distinct on (lower(regexp_replace(name, '[^a-zA-Z0-9]+', ' ', 'g')))
    lower(regexp_replace(name, '[^a-zA-Z0-9]+', ' ', 'g')) as k, id
  from exam_types
  order by 1, is_active desc, created_at asc
),
resolved as (
  select v.id as vid,
         array_agg(m.id order by s.ord) as ids
  from visits v
  cross join lateral unnest(coalesce(v.scan_types, '{}')) with ordinality as s(sname, ord)
  left join m on m.k = lower(regexp_replace(s.sname, '[^a-zA-Z0-9]+', ' ', 'g'))
  group by v.id
)
update visits v
set exam_type_ids = r.ids
from resolved r
where r.vid = v.id and v.exam_type_ids is null;

create index if not exists visits_exam_type_ids_idx on visits using gin (exam_type_ids);
