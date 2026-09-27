-- Non-admin self-updates: allowlist (reset immutable / audit columns from OLD).

create or replace function public.guard_therapists_self_update()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  if is_clinic_admin(new.clinic_id) then
    return new;
  end if;

  if tg_op = 'UPDATE' and old.user_id = auth.uid() then
    new.id := old.id;
    new.clinic_id := old.clinic_id;
    new.user_id := old.user_id;
    new.active := old.active;
    new.created_by := old.created_by;
  end if;

  return new;
end;
$$;
