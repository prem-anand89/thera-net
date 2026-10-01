-- ---------------------------------------------------------------------------
-- Invoice policy: how a clinic wants bills handled after a visit.
--
-- A payment (money received, by method and date) is always recorded; an
-- invoice is a separate, numbered, immutable document. Not every patient
-- wants one, so the clinic chooses what the app nudges:
--   on_request  (default) — a "Give bill" button on the saved-visit screen;
--                           the Needs receipt list stays.
--   always                — the bill step opens straight after a visit saved
--                           as paid.
--   never_nag             — the Needs receipt list and its badge are hidden;
--                           an invoice can still be issued from any visit.
-- Display-level only: issue_invoice() is unchanged and enforces nothing here.
-- ---------------------------------------------------------------------------
alter table public.clinics
  add column if not exists invoice_policy text not null default 'on_request'
  check (invoice_policy in ('on_request', 'always', 'never_nag'));
