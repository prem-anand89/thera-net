-- New clinics start with "Start times every" = 30 minutes. With 60-minute appointments and no step set, times start on
-- the hour, so a break or an appointment that ends at :30 strands half an hour that nobody can book.
--
-- Only the default for NEW rows changes. Existing clinics keep whatever they have (null = same as the appointment
-- length), so no schedule changes under anyone; Settings → Hours & closures shows a hint to switch it. Idempotent.

alter table public.clinics alter column start_step_minutes set default 30;
