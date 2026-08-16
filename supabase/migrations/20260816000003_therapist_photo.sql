-- ---------------------------------------------------------------------------
-- Therapist profile photo. Stored the same way the clinic/partner logos
-- already are -- a path into the existing public `clinic-assets` bucket,
-- not the image itself -- so no new storage bucket or RLS policy is
-- needed (clinic_assets_write/_update/_delete already scope by
-- is_clinic_member() on the first path segment, which an upload path of
-- `${clinicId}/therapist-${therapistId}-...` satisfies the same way
-- `${clinicId}/logo-...` does today).
-- ---------------------------------------------------------------------------
alter table public.therapists add column photo_path text;
