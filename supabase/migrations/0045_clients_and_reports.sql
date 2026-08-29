-- Clients Management: a new portal login type mirroring doctors/patients -
-- external parties who log in, upload requests, and see the status and
-- results of past ones. Replaces "External Vendors" as a concept, though
-- the old vendors/vendor_requests tables are left in place untouched rather
-- than deleted, since they still hold real historical data.
create table if not exists clients (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  username text unique,
  password_hash text,
  contact_phone text,
  contact_email text,
  drive_folder_id text,
  is_pseudo boolean not null default false,
  branch_id uuid references branches(id),
  created_at timestamptz not null default now()
);

create or replace function create_client_credentials(p_client_id uuid, p_username text)
returns text
language plpgsql
security definer
as $$
declare
  pwd text;
begin
  pwd := generate_temp_password();
  update clients set username = p_username, password_hash = crypt(pwd, gen_salt('bf')) where id = p_client_id;
  return pwd;
end;
$$;

-- One pseudo-client per branch, named after the branch itself - internal
-- report requests (direct or doctor-referred patients) are attributed here,
-- so every report - internal or from a real external client - lives in one
-- unified list rather than two separate systems.
insert into clients (name, is_pseudo, branch_id)
select name, true, id from branches
where not exists (select 1 from clients c where c.branch_id = branches.id and c.is_pseudo);

-- Every report request, whichever source it came from. previous_values-style
-- snapshotting isn't needed here since a report is created once and only
-- transitions pending -> completed, not edited back and forth.
create table if not exists reports (
  id uuid primary key default gen_random_uuid(),
  source_type text not null check (source_type in ('internal', 'client')),
  client_id uuid not null references clients(id),
  patient_id uuid references patients(id),
  visit_id uuid references visits(id),
  scan_name text not null,
  date_required date not null default current_date,
  status text not null default 'pending' check (status in ('pending', 'completed')),
  assigned_to_employee_id uuid,
  assigned_to_name text,
  client_uploaded_file_url text,
  client_uploaded_file_name text,
  report_file_url text,
  report_file_name text,
  drive_folder_id text,
  created_by_id uuid,
  created_by_name text,
  created_at timestamptz not null default now(),
  completed_at timestamptz
);
create index if not exists reports_status_idx on reports (status);
create index if not exists reports_client_idx on reports (client_id);

alter table clients enable row level security;
alter table reports enable row level security;
drop policy if exists staff_all on public.clients;
create policy staff_all on public.clients for all to authenticated using (true) with check (true);
drop policy if exists staff_all on public.reports;
create policy staff_all on public.reports for all to authenticated using (true) with check (true);

-- Automatically creates a pending internal report whenever a new visit
-- includes at least one scan type that's flagged as requiring a report in
-- Branch Management - matching "if marked yes it appears in the status box"
-- rather than needing staff to remember to create the request by hand.
create or replace function auto_create_report_for_visit()
returns trigger
language plpgsql
as $$
declare
  v_branch_client_id uuid;
  v_requiring_scans text[];
begin
  if new.scan_types is null or array_length(new.scan_types, 1) is null then
    return new;
  end if;

  select array_agg(name) into v_requiring_scans
  from exam_types
  where name = any(new.scan_types) and requires_report = true;

  if v_requiring_scans is null or array_length(v_requiring_scans, 1) is null then
    return new;
  end if;

  select id into v_branch_client_id from clients where branch_id = new.branch_id and is_pseudo = true limit 1;
  if v_branch_client_id is null then
    return new; -- visit has no branch set - nothing sensible to attribute this to
  end if;

  insert into reports (source_type, client_id, patient_id, visit_id, scan_name, date_required)
  values ('internal', v_branch_client_id, new.patient_id, new.id, array_to_string(v_requiring_scans, ', '), coalesce(new.exam_date, current_date));

  return new;
end;
$$;

drop trigger if exists trg_auto_create_report on visits;
create trigger trg_auto_create_report
  after insert on visits
  for each row execute function auto_create_report_for_visit();
