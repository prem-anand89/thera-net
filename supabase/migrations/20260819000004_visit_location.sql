-- ---------------------------------------------------------------------------
-- Where a visit happened (clinic vs. patient's home). Domiciliary/homecare
-- billing generally needs this recorded explicitly and separately
-- justified for a TPA. Nullable, no default -- older rows read as unset
-- (the app treats missing as 'clinic', the overwhelming majority case).
-- ---------------------------------------------------------------------------
alter table public.visits add column if not exists location text;
