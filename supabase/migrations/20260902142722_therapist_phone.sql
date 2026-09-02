-- ---------------------------------------------------------------------------
-- Therapist phone number, so the WhatsApp Business API can send therapist
-- notifications/confirmations directly instead of always falling back to
-- the manual share sheet (bookingService.shareTherapistNotify had no
-- recipient number to give the Business API before this).
-- ---------------------------------------------------------------------------
alter table public.therapists add column if not exists phone text;
