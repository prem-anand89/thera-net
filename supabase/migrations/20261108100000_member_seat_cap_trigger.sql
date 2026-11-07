-- The login-seat limit (clinic_plans.max_members) is now enforced on the clinic_members table itself.
--
-- Until now only the invite-therapist function counted logins against the plan. But the table's own insert policy
-- (members_insert) lets any clinic admin add a row directly through the API, which skipped the limit. This trigger is the
-- same rule where it cannot be skipped:
--   * a new login row is refused while the clinic already has max_members rows (every row counts, as the function counts);
--   * nothing is checked while platform_config.tier_enforcement_enabled is off (the pilot switch), or while the clinic has
--     no plan row (a creator becomes the first admin before the plan row is seeded, and a data gap must not lock anyone out);
--   * a row that already exists passes (the invite function re-links an account, and an upsert fires BEFORE INSERT first);
--   * only inserts are checked: a clinic already over its limit (moved to a smaller plan) keeps its members, edits and
--     removals untouched, and just cannot add another.
-- The invite function keeps its own check for the friendlier message and the read-only-plan refusal.
--
-- Idempotent.

create or replace function public.enforce_member_seat_cap()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_cap int;
  v_used int;
begin
  if not tier_enforcement_enabled() then
    return new;
  end if;
  if exists (select 1 from clinic_members where clinic_id = new.clinic_id and user_id = new.user_id) then
    return new;
  end if;

  select max_members into v_cap from clinic_plans where clinic_id = new.clinic_id;
  if v_cap is null then
    return new;
  end if;

  select count(*) into v_used from clinic_members where clinic_id = new.clinic_id;
  if v_used >= v_cap then
    raise exception 'This clinic''s plan allows up to % team login%. Upgrade to add more.', v_cap, case when v_cap = 1 then '' else 's' end;
  end if;
  return new;
end $$;

revoke all on function public.enforce_member_seat_cap() from public, anon, authenticated;

drop trigger if exists clinic_members_enforce_seat_cap on public.clinic_members;
create trigger clinic_members_enforce_seat_cap
  before insert on public.clinic_members
  for each row execute function public.enforce_member_seat_cap();
