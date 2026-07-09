-- ---------------------------------------------------------------------------
-- Multi-clinic: make the revenue-split labels configurable per clinic.
--
-- "BM" (the clinic's own share) and "HV" (the partner hospital's share) are
-- Beyond Mechanics / Health Valley specific. A second clinic with a different
-- partner needs its own abbreviations on the monthly report, CSV, and
-- dashboard. Nullable — the app falls back to 'BM'/'HV', so the existing
-- clinic's hospital-facing documents are unchanged until it sets these.
-- ---------------------------------------------------------------------------
alter table public.clinics
  add column own_share_label text,
  add column partner_share_label text;
