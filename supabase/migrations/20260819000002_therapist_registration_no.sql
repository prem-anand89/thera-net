-- ---------------------------------------------------------------------------
-- Therapist registration/license number (state physiotherapy council or
-- equivalent), printed on invoices. What insurers/TPAs actually check to
-- confirm the treating therapist is a registered practitioner — a bare
-- name alone doesn't establish that.
-- ---------------------------------------------------------------------------
alter table public.therapists add column if not exists registration_no text;
