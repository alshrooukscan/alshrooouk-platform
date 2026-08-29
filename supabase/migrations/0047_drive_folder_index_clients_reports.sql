alter table drive_folder_index drop constraint drive_folder_index_entity_type_check;
alter table drive_folder_index add constraint drive_folder_index_entity_type_check
  check (entity_type = any (array['patient', 'doctor', 'employee_documents', 'client', 'report']));
