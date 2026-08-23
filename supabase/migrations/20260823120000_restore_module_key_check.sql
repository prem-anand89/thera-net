-- Phase 0 (tier-based subscriptions plan), step 1: restore a constraint on
-- module_key. The `modules` reference table that clinic_module_settings.
-- module_key and clinic_entitlements.module_key both had an FK to was
-- dropped in 20260821022542_drop_unused_modules_table.sql; CASCADE removed
-- both FKs with it. Since then module_key has been unconstrained free text
-- on both tables. A CHECK against the same seven keys the `modules` table
-- used to hold is the lighter fix — no reference table needed unless
-- advanced modules become genuinely data-driven later.
--
-- Verified no existing row violates this before adding it: clinic_entitlements
-- is currently empty (fail-open default in effect for every clinic) and
-- clinic_module_settings only has rows for the six module-registry keys
-- (no 'invoicing' rows exist there today, but it's a valid key on both
-- tables per the original modules seed, so it's included in both CHECKs).
alter table public.clinic_module_settings
  add constraint clinic_module_settings_module_key_check
  check (module_key in (
    'gut_screening', 'return_to_sport', 'scoliosis_screening',
    'face_scale', 'facial_palsy', 'consultation_notes', 'invoicing'
  ));

alter table public.clinic_entitlements
  add constraint clinic_entitlements_module_key_check
  check (module_key in (
    'gut_screening', 'return_to_sport', 'scoliosis_screening',
    'face_scale', 'facial_palsy', 'consultation_notes', 'invoicing'
  ));
