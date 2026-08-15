-- ---------------------------------------------------------------------------
-- consultation_notes_update was left at `using (is_clinic_member(clinic_id))`
-- when 20260815000001_role_model_and_visit_rls.sql scoped the equivalent
-- visits policy to "your own visits, or an admin's" -- so a therapist can no
-- longer edit a colleague's billing row (visits_update) but could still
-- overwrite a colleague's clinical note, a medico-legal record. Brings
-- consultation_notes_update in line with visits_update's shape: any clinic
-- member can still read and insert notes clinic-wide (continuity of care --
-- a patient is routinely seen by more than one therapist), but only the
-- note's own therapist_id or an admin can update an existing row.
--
-- Matches visits_update precedent exactly: the ownership check is a `using`
-- clause only (which existing rows can be touched), not a `with check` on
-- therapist_id, so an admin reassigning a note's therapist_id isn't blocked
-- by this policy. The `can_use_module` entitlement gate moves to `with
-- check` as a result (still enforced on every write, same as before).
-- ---------------------------------------------------------------------------
drop policy consultation_notes_update on public.consultation_notes;

create policy consultation_notes_update on public.consultation_notes
  for update
  using (is_clinic_admin(clinic_id) or is_own_therapist(clinic_id, therapist_id))
  with check (can_use_module(clinic_id, 'consultation_notes'));
