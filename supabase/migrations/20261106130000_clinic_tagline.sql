-- An optional one-line description printed under the clinic's name on its letterhead (bills, receipts and, later,
-- clinical notes). Null = none; clinics without one look as they did.
alter table public.clinics
  add column if not exists tagline text;

alter table public.clinics drop constraint if exists clinics_tagline_length;
alter table public.clinics add constraint clinics_tagline_length check (char_length(tagline) <= 60);
