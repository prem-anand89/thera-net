-- A colleague who helped with a package session can be given part of that session's share.
--
-- On a package line (the purchase or a session), session_share_therapist_id names the helper and
-- session_share_pct (1-99) the part of the session's package share they get; the line's own deliverer (the
-- runner) keeps the rest. Both are set or both are null. The money moves only through package attribution
-- (payBase), never through the visit's revenue shares, and only while the clinic's therapist split is on.
-- A line that never had a helper keeps both columns null, so every existing row and every closed month
-- reproduces unchanged.
--
-- The helper must belong to the line's clinic and must not be the runner (the line's assistant, else the
-- visit's therapist). A deleted line is exempt from the runner check, like the assistant check, so a line
-- left behind by a change of primary can still be removed. Not part of the invoiced freeze (who is paid is
-- internal, not on the invoice): protect_invoiced_visit_items compares a fixed column list that does not
-- include these two.

alter table public.visit_items
  add column if not exists session_share_therapist_id uuid references public.therapists (id),
  add column if not exists session_share_pct smallint;

alter table public.visit_items drop constraint if exists visit_items_session_share_check;
alter table public.visit_items add constraint visit_items_session_share_check check (
  (session_share_therapist_id is null and session_share_pct is null)
  or (session_share_therapist_id is not null and session_share_pct between 1 and 99 and is_package_line)
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
      raise exception 'The therapist sharing a session must belong to the visit''s clinic.' using errcode = '23514';
    end if;
    if not new.deleted
       and new.session_share_therapist_id = coalesce(new.assisting_therapist_id, v_visit.therapist_id) then
      raise exception 'A session can''t be shared with the therapist who ran it.' using errcode = '23514';
    end if;
  end if;
  return new;
end $$;
