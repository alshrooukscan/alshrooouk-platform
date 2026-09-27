-- Deleting a visit now asks the gateway to remove that visit's Orthanc
-- worklist entry: visits/[id]/route.js logs 'worklist_delete_requested',
-- /api/gateway/worklist-deletions hands those to the gateway, and the gateway
-- confirms each with 'worklist_deleted'. gateway_sync_log.event_type is
-- limited by a check constraint (0106_dicom_gateway_integration.sql) that
-- allows neither value. Both inserts ignore their errors, so without this
-- migration the deletion requests are dropped and never reach the gateway.
alter table gateway_sync_log drop constraint if exists gateway_sync_log_event_type_check;
alter table gateway_sync_log add constraint gateway_sync_log_event_type_check
  check (event_type in (
    'worklist_created', 'worklist_push_failed',
    'study_received', 'study_matched', 'study_unmatched',
    'unmatched_resolved',
    'worklist_delete_requested', 'worklist_deleted'
  ));
