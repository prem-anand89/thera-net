-- Clinics that already logged home visits (the old always-visible Home toggle) keep Home on after care_locations arrived.
update public.clinics c
set care_locations = array['clinic', 'home']::text[]
where not ('home' = any (c.care_locations))
  and exists (select 1 from public.visits v where v.clinic_id = c.id and v.location = 'home');
