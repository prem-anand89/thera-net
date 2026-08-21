-- The modules/module_registry table was dead infrastructure: RLS enabled
-- with no policies, no client code in src/ ever queried it. Dropping with
-- CASCADE removes the two FK constraints that referenced it
-- (clinic_module_settings.module_key, clinic_entitlements.module_key) --
-- those two tables are also unused by the app but are left in place,
-- since removing them wasn't asked for.
drop table if exists public.modules cascade;
