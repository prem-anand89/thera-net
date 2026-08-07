-- patient_module_enrollments.module_type's CHECK constraint only allowed
-- the other (frontend-unwired) assessment modules — gut_screening,
-- return_to_sport, scoliosis_screening, face_scale, facial_palsy.
-- consultation_notes wasn't in the list, so an enrollment row for Core
-- Assessment (which reuses the existing consultation_notes module rather
-- than introducing a new one — see docs/CORE-ASSESSMENT-PORT-PLAN.md §3)
-- would have been rejected by the database. Widen it to include
-- consultation_notes rather than dropping the constraint entirely, so it
-- still catches typos/unknown module keys.

alter table public.patient_module_enrollments
  drop constraint patient_module_enrollments_module_type_check;

alter table public.patient_module_enrollments
  add constraint patient_module_enrollments_module_type_check
  check (module_type = any (array[
    'gut_screening', 'return_to_sport', 'scoliosis_screening',
    'face_scale', 'facial_palsy', 'consultation_notes'
  ]));
