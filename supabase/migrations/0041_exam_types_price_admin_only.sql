-- Real, server-side enforcement that only an admin can change a scan type's
-- price - the client-side disabled input is a courtesy, not a guarantee.
-- Name, category, requires_report, and is_active stay editable by any staff
-- member with access to this page; only price is gated here.
create or replace function enforce_exam_type_price_admin_only()
returns trigger
language plpgsql
as $$
declare
  v_role text;
begin
  if new.price is distinct from old.price then
    select role into v_role from staff_profiles where id = auth.uid();
    if v_role is distinct from 'admin' then
      raise exception 'Only an admin can change a scan type''s price.';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_exam_type_price_admin_only on exam_types;
create trigger trg_exam_type_price_admin_only
  before update on exam_types
  for each row execute function enforce_exam_type_price_admin_only();
