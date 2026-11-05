-- Optional package expiry (Settings refinement, Step 16c).
-- service_catalog.validity_days: "Valid for (days)" on a package service; null = no expiry.
-- visits.package_validity_days: copied onto every session of a package when it is logged, so editing the
-- catalog never changes a package a patient already holds. The expiry DATE is never stored: it is worked out
-- from the package's first visit date + these days (domain/packageTracking.ts), so correcting that date moves it.
-- Existing rows stay null: packages already sold never expire. Expiry only warns; nothing is blocked.
alter table public.service_catalog
  add column if not exists validity_days smallint
  check (validity_days between 1 and 730);

alter table public.visits
  add column if not exists package_validity_days smallint
  check (package_validity_days between 1 and 730);
