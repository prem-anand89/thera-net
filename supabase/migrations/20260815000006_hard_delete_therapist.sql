-- ---------------------------------------------------------------------------
-- A therapist who left the org could only be deactivated -- there was no
-- delete option, even for a roster entry with zero history (added by
-- mistake, or someone who left before ever seeing a patient). Mirrors
-- hard_delete_patient()'s exact shape: admin-only, blocked if any dependent
-- record exists (so real clinical/financial history is never at risk of
-- being silently orphaned or cascade-deleted), friendly exception naming
-- the count otherwise. A therapist with any history must still go through
-- the existing Deactivate action.
-- ---------------------------------------------------------------------------
create or replace function public.hard_delete_therapist(p_therapist_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_clinic uuid;
  v_records int;
begin
  select clinic_id into v_clinic from therapists where id = p_therapist_id;
  if v_clinic is null then
    raise exception 'therapist not found';
  end if;
  if not is_clinic_admin(v_clinic) then
    raise exception 'only clinic admins can permanently delete a therapist';
  end if;

  select
    (select count(*) from visits where therapist_id = p_therapist_id or shared_therapist_id = p_therapist_id)
    + (select count(*) from consultation_notes where therapist_id = p_therapist_id)
    + (select count(*) from invoices where therapist_id = p_therapist_id)
  into v_records;

  if v_records > 0 then
    raise exception 'therapist has % linked record(s); deactivate instead of deleting', v_records;
  end if;

  delete from therapists where id = p_therapist_id;
end $$;
