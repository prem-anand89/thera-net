-- A visit can only be attached to a stay that still exists (not soft-deleted).
--
-- 20261108120000 checked the patient and clinic of a visit's stay but not whether the stay had been deleted. A device that
-- was offline while a mistaken stay was deleted could then sync a session onto it, and that session would belong to a stay
-- no list shows. The trigger fires only when admission_id, patient_id or clinic_id is written, so a stay deleted AFTER its
-- visits were attached (which check_admission already refuses while live visits exist) is unaffected.
-- Discharged stays are not refused here: a late session may be legitimate bookkeeping on the server side; the app refuses
-- sessions dated after the discharge.
create or replace function public.check_visit_admission() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.admission_id is not null and not exists (
    select 1 from admissions a
    where a.id = new.admission_id and a.clinic_id = new.clinic_id and a.patient_id = new.patient_id and not a.deleted
  ) then
    raise exception 'A visit''s stay must be the same patient''s, in the same clinic, and not deleted.' using errcode = '23514';
  end if;
  return new;
end $$;
