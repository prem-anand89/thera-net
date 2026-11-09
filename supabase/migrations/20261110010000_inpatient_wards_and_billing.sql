-- Preset wards / rehab units and inpatient billing mode (whether the hospital/partner bills IP patients
-- or the clinic/rehab centre bills IP stays at discharge).
alter table public.clinics
  add column if not exists wards text[] null,
  add column if not exists ip_billed_by_partner boolean null;

