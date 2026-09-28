ALTER TABLE public.clinics
  ADD COLUMN IF NOT EXISTS slot_duration_minutes integer NOT NULL DEFAULT 30
  CHECK (slot_duration_minutes IN (15, 30, 45, 60));
