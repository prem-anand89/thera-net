-- Clinical notes: who can read them, and a completed note can't be rewritten.
--
-- 1. Front desk never reads or writes clinical notes. Until now any clinic member could select them, so
--    sync copied every note onto front-desk devices and only the screens hid them. Admins and therapists
--    are unchanged. (The app also deletes notes already cached on a front-desk device.)
-- 2. A completed note is final on the server too, not just on screen: its clinical content, patient,
--    episode and mode can no longer change. Still allowed: linking it to the visit or appointment it
--    belongs to (a note started before the visit existed), reassigning the therapist, and archiving it.
--    The error uses SQLSTATE 42501, which the app treats as permanent and reverts the local copy.
-- 3. Front desk issues bills, and the bill's "Clinical details" were pre-filled from the note on the
--    device. get_invoice_referral returns only the referral block (diagnosis, referring physician and
--    registration number) for one visit, so the bill keeps its pre-fill without the note itself.

drop policy if exists consultation_notes_select on public.consultation_notes;
create policy consultation_notes_select on public.consultation_notes
  for select using (is_clinic_member(clinic_id) and not is_front_desk(clinic_id));

drop policy if exists consultation_notes_insert on public.consultation_notes;
create policy consultation_notes_insert on public.consultation_notes
  for insert with check (
    is_clinic_member(clinic_id) and not is_front_desk(clinic_id)
    and can_use_module(clinic_id, 'consultation_notes')
  );

create or replace function public.consultation_notes_completed_lock() returns trigger
language plpgsql as $$
begin
  if old.status = 'completed' and (
       new.status not in ('completed', 'archived')
    or new.notes_text is distinct from old.notes_text
    or new.assessment_payload is distinct from old.assessment_payload
    or new.note_mode is distinct from old.note_mode
    or new.nrs_score is distinct from old.nrs_score
    or new.psfs_mean is distinct from old.psfs_mean
    or new.red_flag_count is distinct from old.red_flag_count
    or new.authorized_session_count is distinct from old.authorized_session_count
    or new.patient_id is distinct from old.patient_id
    or new.enrollment_id is distinct from old.enrollment_id
    or new.clinic_id is distinct from old.clinic_id
  ) then
    raise exception 'This note is completed and can no longer be changed.' using errcode = '42501';
  end if;
  return new;
end $$;

drop trigger if exists consultation_notes_completed_lock on public.consultation_notes;
create trigger consultation_notes_completed_lock
  before update on public.consultation_notes
  for each row execute function public.consultation_notes_completed_lock();

-- The referral block for a bill: the visit's own full note if it has one, else the patient's most recently
-- updated completed full note that does. Any member of the visit's clinic may call it (billing is checked
-- again when the bill is issued).
create or replace function public.get_invoice_referral(p_visit_id uuid)
returns jsonb
language plpgsql stable security definer set search_path = public
as $$
declare
  v_visit record;
  v_referral jsonb;
begin
  select clinic_id, patient_id into v_visit from visits where id = p_visit_id;
  if not found or not is_clinic_member(v_visit.clinic_id) then
    return null;
  end if;

  select assessment_payload -> 'referral' into v_referral
    from consultation_notes
    where visit_id = p_visit_id and clinic_id = v_visit.clinic_id
      and note_mode <> 'session' and assessment_payload ? 'referral'
    order by updated_at desc
    limit 1;

  if v_referral is null then
    select assessment_payload -> 'referral' into v_referral
      from consultation_notes
      where patient_id = v_visit.patient_id and clinic_id = v_visit.clinic_id
        and status = 'completed' and note_mode in ('initial', 'followup')
        and assessment_payload ? 'referral'
      order by updated_at desc
      limit 1;
  end if;

  if v_referral is null then
    return null;
  end if;
  return jsonb_build_object(
    'diagnosis', v_referral -> 'diagnosis',
    'referringPhysician', v_referral -> 'referringPhysician',
    'physicianRegistrationNo', v_referral -> 'physicianRegistrationNo'
  );
end $$;

revoke execute on function public.get_invoice_referral(uuid) from public, anon;
grant execute on function public.get_invoice_referral(uuid) to authenticated;
