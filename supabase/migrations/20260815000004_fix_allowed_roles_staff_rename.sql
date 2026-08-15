-- ---------------------------------------------------------------------------
-- Fix: clinic_module_settings.allowed_roles still says 'staff' after
-- 20260815000001_role_model_and_visit_rls.sql renamed every clinic_members
-- role from 'staff' to 'therapist' and dropped 'staff' from the role check
-- constraint entirely. allowed_roles defaults to array['admin','staff']
-- (module_registry.sql) and every existing row -- including every clinic's
-- 'consultation_notes' row, seeded true for all clinics in
-- entitlements_audit_log.sql -- relies on that default, since none of the
-- seed inserts specify allowed_roles explicitly.
--
-- can_use_module() checks m.role = any(s.allowed_roles), and
-- consultation_notes_insert/update require can_use_module(clinic_id,
-- 'consultation_notes'). Since no clinic_members row has ever had role =
-- 'staff' since that migration ran, every non-admin (now 'therapist')
-- attempting to insert or update a consultation note has been silently
-- rejected by RLS -- clinical documentation, an actively-used feature
-- since PR 2, not the still-client-unwired assessment modules this table
-- was originally built for. Fixes both existing rows and the column
-- default so this doesn't recur for any module seeded after this point.
-- ---------------------------------------------------------------------------
update public.clinic_module_settings
set allowed_roles = array(
  select case when r = 'staff' then 'therapist' else r end
  from unnest(allowed_roles) as r
)
where 'staff' = any (allowed_roles);

alter table public.clinic_module_settings
  alter column allowed_roles set default array['admin', 'therapist'];
