-- =====================================================================
-- 0090 · Clinical skill library (client answer, question 9)
--
-- The client listed: Cash Keeper, Scan & Raw data uploader, Report maker,
-- Dental Photographer, Photo Editor, dental stock admin, F&B admin.
--
-- "Cash Keeper" stays split across three streams rather than becoming one
-- skill. Cash is held per business, and the payroll sweep exemption is
-- decided per business, so a single Cash Keeper skill would exempt a
-- person from a sweep for money they never handle. The three already exist
-- and are already driving live behaviour.
--
-- material_admin is renamed to the client's own wording rather than being
-- replaced, so the existing assignment and its delivery-order routing are
-- not broken.
-- =====================================================================

UPDATE public.skills
   SET label = 'Dental Stock Admin',
       description = 'Holds Dental Supply stock. Receives delivery orders automatically, '
                     'and carries stock liability for the categories they cover on an audit date.'
 WHERE key = 'material_admin';

INSERT INTO public.skills (key, label, category, description) VALUES
  ('scan_raw_uploader', 'Scan & Raw Data Uploader', 'clinical',
   'Performs the patient scan and uploads the raw data. Scan commission is '
   'attributed to whoever is recorded on the scan step.'),
  ('report_maker', 'Report Maker', 'clinical',
   'Writes patient reports. Eligible for the per-report bonus on reports beyond '
   'the daily threshold and on reports completed off shift.'),
  ('dental_photographer', 'Dental Photographer', 'clinical',
   'Captures clinical photography for the patient file.'),
  ('photo_editor', 'Photo Editor', 'clinical',
   'Edits and finalises clinical photography before it reaches the report.'),
  ('fnb_admin', 'F&B Admin', 'operations',
   'Holds El3awama F&B stock and carries stock liability for it on an audit date.')
ON CONFLICT (key) DO UPDATE
  SET label = EXCLUDED.label,
      category = EXCLUDED.category,
      description = EXCLUDED.description;
