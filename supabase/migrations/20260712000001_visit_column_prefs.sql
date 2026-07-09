-- ---------------------------------------------------------------------------
-- Per-clinic show/hide for the optional Visits-table columns (Condition,
-- Treatment, Adjustment). Stored as jsonb like { "adjustment": true }; missing
-- keys fall back to the app's defaults (condition/treatment on, adjustment
-- off). Nullable — existing clinics get the defaults until they change them
-- in Setup.
-- ---------------------------------------------------------------------------
alter table public.clinics add column visit_column_prefs jsonb;
