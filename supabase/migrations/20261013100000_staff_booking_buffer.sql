-- How many hours before opening / after closing staff may book in the booking sheet (0 = clinic hours only).
alter table public.clinics
  add column if not exists staff_booking_buffer_hours smallint not null default 3
    check (staff_booking_buffer_hours between 0 and 12);
