alter table public.therapists add column if not exists email_appointment_updates boolean not null default true;
