-- A worklist entry pushed to Orthanc is a one-time snapshot of the patient's
-- name/birthdate at push time. If staff correct that patient's demographic
-- data afterward, nothing previously re-synced the already-pushed entry -
-- the machine (and the resulting scan's DICOM tags) kept showing the old
-- data. This never affected matching, which is keyed on
-- dicom_study_uid/dicom_accession_number, never on name or DOB - but it is
-- a real display/metadata bug worth fixing.
--
-- 'needs_resync' is a new transient state: set on a visit whose worklist
-- entry was already confirmed created ('worklist_created') when its
-- patient's name or DOB changes. worklist-queue/route.js now also picks up
-- 'needs_resync' visits (alongside brand-new ones), reusing their existing
-- dicom_study_uid/dicom_accession_number rather than issuing new ones, and
-- flags the entry as a resync so the gateway knows to delete the stale
-- Orthanc worklist item (by AccessionNumber) before pushing the corrected
-- one - never two worklist items for what is really the same booking.
alter table visits drop constraint if exists visits_dicom_worklist_status_check;
alter table visits add constraint visits_dicom_worklist_status_check
  check (dicom_worklist_status in ('pending', 'worklist_created', 'needs_resync', 'matched', 'unmatched'));
