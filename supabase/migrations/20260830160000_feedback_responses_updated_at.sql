-- ---------------------------------------------------------------------------
-- Patient Communications, Slice 2: admin-only Requests → Feedback page.
--
-- feedback_responses had no updated_at column (rows are insert-only, never
-- updated, via submit_feedback_response()'s SECURITY DEFINER path) — but
-- this app's offline-first sync engine hardcodes updated_at as the delta
-- column for every synced table (`.gt('updated_at', cursor)`, and
-- rowToDomain requires it on every row). Rather than build a bespoke
-- online-only fetch path for this one table, add the column so
-- feedback_responses can join the normal synced-but-not-client-writable
-- set (same shape as `invoices`: pulled, never pushed). Since responses are
-- immutable, updated_at is just a permanent alias for created_at, not a
-- real "last modified" signal — there's nothing to modify.
-- ---------------------------------------------------------------------------
alter table public.feedback_responses
  add column updated_at timestamptz not null default now();

update public.feedback_responses set updated_at = created_at;
