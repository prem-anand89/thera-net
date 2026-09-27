-- Therapist profile onboarding (cross-device) + restrict self-updates to safe columns.

alter table public.therapists
  add column if not exists profile_confirmed_at timestamptz;

-- Existing linked roster rows are treated as already confirmed.
update public.therapists
set profile_confirmed_at = coalesce(profile_confirmed_at, updated_at, now())
where user_id is not null
  and profile_confirmed_at is null;

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
    if new.user_id is distinct from old.user_id
       or new.clinic_id is distinct from old.clinic_id
       or new.active is distinct from old.active then
      raise exception 'therapists may only update name, registration_no, phone, photo_path, and profile_confirmed_at on their own row';
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists therapists_guard_self_update on public.therapists;

create trigger therapists_guard_self_update
  before update on public.therapists
  for each row execute function public.guard_therapists_self_update();
