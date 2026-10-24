-- Who collects patient payments, and a default payment method.
--
-- A partner (e.g. a hospital) can be the one who collects the patient's money at its own counter and
-- settles with the clinic at month end. That is recorded as a payment with method 'partner': it settles
-- the visit (no dues) but is not cash in the clinic's drawer. Clinics that collect themselves are unchanged.
--
-- clinics.partner_collects: the clinic's default for who collects (only meaningful with a partner).
-- clinics.default_payment_method: what New Visit / Take payment / Record advance preselect.
-- Widening the two method checks is non-destructive.
alter table public.payments drop constraint if exists payments_method_check;
alter table public.payments add constraint payments_method_check
  check (method in ('cash', 'upi', 'card', 'bank_transfer', 'cheque', 'partner'));

alter table public.patient_advances drop constraint if exists patient_advances_method_check;
alter table public.patient_advances add constraint patient_advances_method_check
  check (method in ('cash', 'upi', 'card', 'bank_transfer', 'cheque', 'partner'));

alter table public.clinics
  add column if not exists partner_collects boolean not null default false,
  add column if not exists default_payment_method text
    check (default_payment_method is null
           or default_payment_method in ('cash', 'upi', 'card', 'bank_transfer', 'cheque', 'partner'));
