-- A colleague who helped can be given a percentage of ANY service, not only a package session.
--
-- session_share_therapist_id / session_share_pct (added in 20261026100000) now mean "share of this service".
-- On a package line the money still moves through package attribution (payBase); on any other line it
-- moves through the visit's revenue shares (autoCredits). The columns keep their names (no sync churn).
-- Existing rows are unaffected: only package lines carry a share today, and they still satisfy the check.

alter table public.visit_items drop constraint if exists visit_items_session_share_check;
alter table public.visit_items add constraint visit_items_session_share_check check (
  (session_share_therapist_id is null and session_share_pct is null)
  or (session_share_therapist_id is not null and session_share_pct between 1 and 99)
);

create or replace function public.check_visit_item() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_visit record;
begin
  select clinic_id, therapist_id into v_visit from visits where id = new.visit_id;
  if not found then
    raise exception 'Visit not found.' using errcode = '23503';
  end if;
  if new.clinic_id is distinct from v_visit.clinic_id then
    raise exception 'A service line must belong to its visit''s clinic.' using errcode = '23514';
  end if;
  if new.assisting_therapist_id is not null and not exists (
    select 1 from therapists where id = new.assisting_therapist_id and clinic_id = new.clinic_id
  ) then
    raise exception 'The assisting therapist must belong to the visit''s clinic.' using errcode = '23514';
  end if;
  if not new.deleted and new.assisting_therapist_id = v_visit.therapist_id then
    raise exception 'The assisting therapist must be someone other than the visit''s therapist.'
      using errcode = '23514';
  end if;
  if new.session_share_therapist_id is not null then
    if not exists (
      select 1 from therapists where id = new.session_share_therapist_id and clinic_id = new.clinic_id
    ) then
      raise exception 'The therapist sharing a service must belong to the visit''s clinic.' using errcode = '23514';
    end if;
    if not new.deleted
       and new.session_share_therapist_id = coalesce(new.assisting_therapist_id, v_visit.therapist_id) then
      raise exception 'A service can''t be shared with the therapist who did it.' using errcode = '23514';
    end if;
  end if;
  return new;
end $$;
