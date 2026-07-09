-- ---------------------------------------------------------------------------
-- Billing mode: make the hospital revenue-split model optional per clinic.
--
-- 'hospital_split' is the Beyond Mechanics / Health Valley model (clinic-share
-- vs partner-hospital-share, TDS, Post-Tax). 'simple' is a plain physio clinic
-- that just bills a visit and tracks paid/outstanding — no share/tax/HV
-- columns. The visits table is unchanged: in simple mode the split columns
-- simply degenerate (split=100%, tax=0 → share=bill, post-tax=bill, tds=0,
-- hv=0), so stored data stays valid and reports still reconcile.
--
-- enable_therapist_split is independent — a group clinic with no hospital may
-- still want to attribute a visit's revenue between therapists, or not.
--
-- Defaults are 'hospital_split' / true so the EXISTING clinic row and its
-- behavior are unchanged; provision_clinic.sql sets newly-provisioned clinics
-- to the general 'simple' default instead.
-- ---------------------------------------------------------------------------
alter table public.clinics
  add column billing_mode text not null default 'hospital_split'
    check (billing_mode in ('simple', 'hospital_split')),
  add column enable_therapist_split boolean not null default true;
