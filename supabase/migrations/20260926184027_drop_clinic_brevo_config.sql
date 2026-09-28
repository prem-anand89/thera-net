drop function if exists public.get_brevo_config_status(uuid);
drop function if exists public.set_brevo_config(uuid, text, text, boolean);
drop trigger if exists clinic_brevo_config_set_updated_at on public.clinic_brevo_config;
drop table if exists public.clinic_brevo_config cascade;