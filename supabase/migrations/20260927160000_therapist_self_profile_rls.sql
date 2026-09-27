-- Linked therapists may update their own roster row (name, registration no., phone)
-- for the post-invite profile onboarding step. Admins retain therapists_update.

create policy therapists_update_self on public.therapists
  for update
  using (user_id = auth.uid() and is_clinic_member(clinic_id))
  with check (user_id = auth.uid() and is_clinic_member(clinic_id));
