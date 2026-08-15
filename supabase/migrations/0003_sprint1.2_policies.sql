-- Sprint 1.2 prep: RLS policies (staff = any authenticated user for now) + credential-generation functions

alter table patient_auth add constraint patient_auth_patient_id_key unique (patient_id);

do $$
declare t text;
begin
  for t in select unnest(array[
    'patients','doctors','visits','branches','exam_types','invoices',
    'whatsapp_log','drive_folder_index'
  ])
  loop
    execute format('drop policy if exists staff_all on public.%I;', t);
    execute format(
      'create policy staff_all on public.%I for all to authenticated using (true) with check (true);', t
    );
  end loop;
end $$;

create or replace function generate_temp_password() returns text as $$
  select substr(md5(random()::text || clock_timestamp()::text), 1, 10);
$$ language sql volatile;

create or replace function create_patient_credentials(p_patient_id uuid, p_username text)
returns text as $$
declare
  pwd text;
begin
  pwd := generate_temp_password();
  insert into patient_auth (patient_id, username, password_hash)
  values (p_patient_id, p_username, crypt(pwd, gen_salt('bf')))
  on conflict (patient_id) do update set password_hash = excluded.password_hash, username = excluded.username;
  return pwd;
end;
$$ language plpgsql security definer;

grant execute on function create_patient_credentials(uuid, text) to authenticated;
grant execute on function generate_temp_password() to authenticated;
