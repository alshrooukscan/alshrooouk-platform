-- Every one of these functions serves double duty: it creates first-time
-- credentials AND it resets a password for an existing account. Both paths
-- issue a staff-generated temporary password that travels to the person over
-- WhatsApp, so both must land the account back in "you have to set your own
-- password" state.
--
-- They only ever wrote password_hash. So once someone had set their own
-- password and cleared the flag, a later staff reset handed them a temp
-- password they were never asked to replace - leaving a credential that had
-- been sent through a messaging app as their permanent password.
--
-- Setting must_change_password = true on every issue closes that for all four
-- portals at once, including the "customer texted us, employee re-sent their
-- password" flow.

create or replace function public.create_patient_credentials(p_patient_id uuid, p_username text)
returns text language plpgsql security definer as $$
declare
  pwd text;
begin
  pwd := generate_temp_password();
  insert into patient_auth (patient_id, username, password_hash, must_change_password)
  values (p_patient_id, p_username, crypt(pwd, gen_salt('bf')), true)
  on conflict (patient_id) do update
    set password_hash = excluded.password_hash,
        username = excluded.username,
        must_change_password = true;
  return pwd;
end;
$$;

create or replace function public.create_doctor_credentials(p_doctor_id uuid, p_username text)
returns text language plpgsql security definer as $$
declare
  pwd text;
begin
  pwd := generate_temp_password();
  update doctors
     set username = p_username,
         password_hash = crypt(pwd, gen_salt('bf')),
         must_change_password = true
   where id = p_doctor_id;
  return pwd;
end;
$$;

create or replace function public.create_employee_credentials(p_employee_id uuid, p_username text)
returns text language plpgsql security definer as $$
declare
  pwd text;
begin
  pwd := generate_temp_password();
  update employees
     set username = p_username,
         password_hash = crypt(pwd, gen_salt('bf')),
         must_change_password = true
   where id = p_employee_id;
  return pwd;
end;
$$;

create or replace function public.create_client_credentials(p_client_id uuid, p_username text)
returns text language plpgsql security definer as $$
declare
  pwd text;
begin
  pwd := generate_temp_password();
  update clients
     set username = p_username,
         password_hash = crypt(pwd, gen_salt('bf')),
         must_change_password = true
   where id = p_client_id;
  return pwd;
end;
$$;
