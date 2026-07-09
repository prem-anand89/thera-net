-- Run this ONCE in the Supabase SQL editor after creating the two auth users
-- (Authentication → Users → Add user). Replace the emails below with the
-- real login emails for Prem and Aishwarya.

insert into public.clinic_members (clinic_id, user_id, role)
select '11111111-1111-4111-8111-111111111111', id, 'admin'
from auth.users
where email in ('beyondmechanicspt@gmail.com', 'aishwaryarani31@gmail.com')
on conflict do nothing;

-- Optional: link auth users to their therapist records (enables per-user
-- attribution in future phases).
-- update public.therapists set user_id = (select id from auth.users where email = 'prem@example.com')
--   where id = '22222222-2222-4222-8222-222222222221';
-- update public.therapists set user_id = (select id from auth.users where email = 'aishwarya@example.com')
--   where id = '22222222-2222-4222-8222-222222222222';
