-- Named document uploads for employees (hiring paperwork) and branches
-- (legal documents), sharing one table since the shape is identical: a
-- custom file name, a Drive file, who uploaded it and when. entity_type
-- distinguishes which kind of record it belongs to.
create table if not exists entity_documents (
  id uuid primary key default gen_random_uuid(),
  entity_type text not null check (entity_type in ('employee','branch')),
  entity_id uuid not null,
  file_name text not null,
  drive_file_id text not null,
  mime_type text,
  uploaded_by_id uuid,
  uploaded_by_name text,
  created_at timestamptz not null default now()
);
create index if not exists entity_documents_entity_idx on entity_documents (entity_type, entity_id);
alter table entity_documents enable row level security;
drop policy if exists staff_all on public.entity_documents;
create policy staff_all on public.entity_documents for all to authenticated using (true) with check (true);

-- Extend drive_folder_index to also cache the per-employee documents folder
-- (was patient/doctor only) - found this constraint before it could fail
-- silently on first real use.
alter table drive_folder_index drop constraint if exists drive_folder_index_entity_type_check;
alter table drive_folder_index add constraint drive_folder_index_entity_type_check check (entity_type in ('patient','doctor','employee_documents'));
