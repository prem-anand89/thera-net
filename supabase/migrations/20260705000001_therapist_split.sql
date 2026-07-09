-- ---------------------------------------------------------------------------
-- Therapist revenue split ("Shared" attribution).
--
-- The hospital reconciles by billed amount + date, so the billed figure and
-- the therapist it sits under must never move. Instead a visit can carry an
-- optional internal split: a share of that visit's billed amount is credited
-- to a second (assisting) therapist in reporting only. It nets to zero across
-- the clinic and does not touch any billed/BM/Post-Tax/HV/TDS total.
--
-- These columns are intentionally left OUT of protect_invoiced_visit()'s
-- frozen-field list: the billed amount stays frozen once invoiced, but the
-- internal attribution can still be corrected afterward (the assist is often
-- realised later). The trigger is column-selective, so an update touching
-- only shared_* passes.
-- ---------------------------------------------------------------------------
alter table public.visits
  add column shared_therapist_id uuid references public.therapists (id),
  add column shared_pct numeric(5, 2) check (shared_pct is null or (shared_pct > 0 and shared_pct <= 100));
