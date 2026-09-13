-- =====================================================================
-- 0097 · W2 · a renamed step no longer hides what it writes
--
-- The three built-in steps can be renamed but not deleted, because years
-- of visits store their completion in dedicated columns on the visit.
-- Six have been renamed. Five are harmless: "Image Uploaded" still means
-- raw data uploaded.
--
-- One is not. On Ceph Profile (Orthodontic Study) the Report Done step was
-- renamed to "Photos Captured" and moved to third position. Staff tick a
-- button labelled Photos Captured and the platform records the report as
-- delivered. The report bonus counts exactly that column, so the next step
-- after this would have been paying someone for a report nobody wrote.
--
-- Renaming stays. What changes is that a renamed step now carries, and
-- shows, what it actually stores.
-- =====================================================================

ALTER TABLE public.exam_type_steps
  ADD COLUMN IF NOT EXISTS canonical_name text;

COMMENT ON COLUMN public.exam_type_steps.canonical_name IS
  'For the three built-in steps, what this step really writes on the visit, '
  'regardless of what it has been renamed to. Surfaced in the UI so a renamed '
  'step can never quietly mean something else.';

UPDATE public.exam_type_steps
   SET canonical_name = CASE legacy_field
         WHEN 'scanned' THEN 'Scanned'
         WHEN 'raw_data_uploaded' THEN 'Raw Data Uploaded'
         WHEN 'report_done' THEN 'Report Done'
       END
 WHERE legacy_field IS NOT NULL;

-- The dangerous one. The label goes back to what it stores, and the photos
-- step the clinic clearly wanted is created properly beside it, where it
-- lands in visit_step_progress instead of on the report column.
UPDATE public.exam_type_steps
   SET name = 'Report Done', sort_order = 6, target_minutes = 1440
 WHERE id = 'e9287eb6-dc5e-4178-bd59-70206244c39c';

INSERT INTO public.exam_type_steps (exam_type_id, name, sort_order, target_minutes, legacy_field, is_active)
SELECT '03141e30-4604-40c4-9c72-0121c0c692e2', 'Photos Captured', 3, 30, NULL, true
WHERE NOT EXISTS (
  SELECT 1 FROM public.exam_type_steps
   WHERE exam_type_id = '03141e30-4604-40c4-9c72-0121c0c692e2'
     AND name = 'Photos Captured' AND legacy_field IS NULL);

-- Two steps on one exam type writing the same column would make one of them
-- silently overwrite the other.
CREATE UNIQUE INDEX IF NOT EXISTS uq_exam_step_legacy_field
  ON public.exam_type_steps (exam_type_id, legacy_field)
  WHERE legacy_field IS NOT NULL AND is_active;
