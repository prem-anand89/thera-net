-- ---------------------------------------------------------------------------
-- Patient communications module — Phase 0 (foundation).
-- Spec: docs/HANDOFF-patient-comms.md. This slice ships only the hardest
-- security surface: the module flag, the feedback schema, and the public
-- (anonymous, no login) token-based read/submit RPCs behind /f/$token. The
-- staff-side "Ask for feedback" trigger UI is Phase 1, not this file.
--
-- This is the first genuinely anonymous *write* path in the app. Every other
-- table in this schema is is_clinic_member-gated (see init.sql: "Patient/
-- visit data is health data — no anonymous access anywhere"); feedback
-- responses are the one deliberate exception, scoped as narrowly as possible:
-- a single-use, 256-bit token is the entire authorization, nothing else
-- about the clinic is ever exposed or writable by an anonymous caller.
-- ---------------------------------------------------------------------------

-- ---------------------------------------------------------------------------
-- Module flag + patient opt-out. Same optional-boolean-with-explicit-default
-- pattern as clinicalDocsEnabled/enableExpectedToday elsewhere in this schema.
-- ---------------------------------------------------------------------------
alter table public.clinics add column if not exists enable_patient_comms boolean not null default false;
alter table public.patients add column if not exists do_not_message boolean not null default false;

-- ---------------------------------------------------------------------------
-- URL-safe token generator: 256 bits of entropy, base64url (no padding).
-- Used as a column default so token generation is server-authoritative —
-- the client never supplies or influences the value.
-- ---------------------------------------------------------------------------
create or replace function public.generate_url_safe_token(p_bytes int default 32)
returns text language sql volatile as $$
  select rtrim(translate(encode(gen_random_bytes(p_bytes), 'base64'), '+/', '-_'), '=');
$$;

-- ---------------------------------------------------------------------------
-- feedback_requests: one row per "ask this patient for feedback" action.
-- therapist_id is denormalized from the visit (not just reachable via a
-- join) so RLS can check is_own_therapist() directly, same pattern as
-- visits/consultation_notes.
-- ---------------------------------------------------------------------------
create table public.feedback_requests (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references public.clinics (id) on delete cascade,
  visit_id uuid not null references public.visits (id) on delete cascade,
  patient_id uuid not null references public.patients (id),
  therapist_id uuid not null references public.therapists (id),
  token text not null unique default public.generate_url_safe_token(),
  status text not null default 'pending' check (status in ('pending', 'responded', 'expired')),
  expires_at timestamptz not null default (now() + interval '21 days'),
  created_by uuid references auth.users (id),
  updated_by uuid references auth.users (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- One pending request per visit — resend rotates/replaces the existing
-- pending row's token rather than stacking a second one (per HANDOFF doc).
create unique index feedback_requests_one_pending_per_visit
  on public.feedback_requests (visit_id) where status = 'pending';

create index feedback_requests_clinic_idx on public.feedback_requests (clinic_id);

create trigger feedback_requests_set_updated_at
  before update on public.feedback_requests
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- feedback_responses: the patient's actual submission. clinic_id is
-- denormalized here too (not just reachable via request_id) purely so the
-- admin-only RLS check below doesn't need a join.
-- ---------------------------------------------------------------------------
create table public.feedback_responses (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null unique references public.feedback_requests (id) on delete cascade,
  clinic_id uuid not null references public.clinics (id) on delete cascade,
  rating smallint not null check (rating between 1 and 5),
  comment text,
  created_at timestamptz not null default now()
);

create index feedback_responses_clinic_idx on public.feedback_responses (clinic_id);

-- ---------------------------------------------------------------------------
-- message_log: shared audit trail for every send action across all four
-- patient-comms workflows (feedback links, booking confirmations, therapist
-- notifications, Google review nudges, re-engagement reminders). Append-only.
-- ---------------------------------------------------------------------------
create table public.message_log (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references public.clinics (id) on delete cascade,
  kind text not null check (kind in (
    'feedback_request', 'booking_confirmation', 'therapist_notify',
    'google_review', 'reminder_stale_package', 'reminder_single_visit'
  )),
  recipient_patient_id uuid references public.patients (id),
  recipient_phone text,
  channel text not null check (channel in ('wa_share', 'wa_business_api')),
  sent_by uuid references auth.users (id),
  sent_at timestamptz not null default now()
);

create index message_log_clinic_idx on public.message_log (clinic_id);

-- ---------------------------------------------------------------------------
-- RLS: staff-side tables are member-gated, same as the rest of the schema.
-- feedback_responses is the one exception within that — SELECT is
-- admin-only, full stop (front desk AND therapists get zero visibility into
-- ratings/comments, per explicit product decision — not just a UI hide).
-- Nothing INSERTs/UPDATEs/DELETEs feedback_responses via RLS at all; the
-- only writer is submit_feedback_response() below, which bypasses RLS as a
-- SECURITY DEFINER function.
-- ---------------------------------------------------------------------------
alter table public.feedback_requests enable row level security;
alter table public.feedback_responses enable row level security;
alter table public.message_log enable row level security;

-- Request existence/status ("was this sent, is it still pending") carries no
-- rating/comment content, so it's visible clinic-wide — only the response
-- content is restricted below.
create policy feedback_requests_select on public.feedback_requests
  for select using (is_clinic_member(clinic_id));

-- Who can trigger/resend a request: admin, front_desk, or the visit's own
-- therapist — matches the "Ask for feedback from a visit" role row in the
-- handoff doc (Yes / Yes / Own visits).
create policy feedback_requests_insert on public.feedback_requests
  for insert with check (
    is_clinic_admin(clinic_id)
    or is_own_therapist(clinic_id, therapist_id)
    or exists (
      select 1 from clinic_members cm
      where cm.clinic_id = feedback_requests.clinic_id
        and cm.user_id = auth.uid()
        and cm.role = 'front_desk'
    )
  );

create policy feedback_requests_update on public.feedback_requests
  for update using (
    is_clinic_admin(clinic_id)
    or is_own_therapist(clinic_id, therapist_id)
    or exists (
      select 1 from clinic_members cm
      where cm.clinic_id = feedback_requests.clinic_id
        and cm.user_id = auth.uid()
        and cm.role = 'front_desk'
    )
  );

create policy feedback_responses_select on public.feedback_responses
  for select using (is_clinic_admin(clinic_id));

create policy message_log_select on public.message_log
  for select using (is_clinic_member(clinic_id));
create policy message_log_insert on public.message_log
  for insert with check (is_clinic_member(clinic_id));

-- ---------------------------------------------------------------------------
-- Public RPC rate limiting. Lightweight, self-pruning (no cron dependency):
-- every insert opportunistically deletes its own stale rows first, so the
-- table never grows unbounded. Keyed by client IP (from PostgREST's
-- forwarded-for header) + which function was called.
-- ---------------------------------------------------------------------------
create table public.public_rpc_rate_limit (
  id bigserial primary key,
  fn_name text not null,
  client_ip text not null,
  called_at timestamptz not null default now()
);

create index public_rpc_rate_limit_lookup on public.public_rpc_rate_limit (fn_name, client_ip, called_at);

-- No RLS needed: this table is never selected from the client, and the only
-- writer is the internal helper below (called only from other SECURITY
-- DEFINER functions, so it inherits their elevated privileges already).
-- Revoke everything from anon/authenticated directly as defense-in-depth.
alter table public.public_rpc_rate_limit enable row level security;
revoke all on public.public_rpc_rate_limit from anon, authenticated;

create or replace function public.check_public_rpc_rate_limit(
  p_fn text,
  p_max_calls int,
  p_window_seconds int
) returns void language plpgsql security definer set search_path = public as $$
declare
  v_ip text := coalesce(
    nullif(split_part(current_setting('request.headers', true)::json ->> 'x-forwarded-for', ',', 1), ''),
    'unknown'
  );
  v_count int;
begin
  delete from public_rpc_rate_limit where called_at < now() - interval '1 day';

  select count(*) into v_count
    from public_rpc_rate_limit
    where fn_name = p_fn and client_ip = v_ip
      and called_at > now() - make_interval(secs => p_window_seconds);

  if v_count >= p_max_calls then
    raise exception 'Too many attempts — please try again shortly.';
  end if;

  insert into public_rpc_rate_limit (fn_name, client_ip) values (p_fn, v_ip);
end $$;

-- ---------------------------------------------------------------------------
-- Public RPCs. Both return/raise the same generic "invalid or expired" error
-- regardless of the actual reason (token not found vs. expired vs. already
-- responded vs. module disabled) — deliberately not distinguishing, so the
-- endpoint can't be used as an oracle to enumerate which tokens exist.
-- ---------------------------------------------------------------------------
create or replace function public.get_feedback_request_by_token(p_token text)
returns text
language plpgsql security definer set search_path = public as $$
declare
  v_req record;
begin
  perform public.check_public_rpc_rate_limit('get_feedback_request_by_token', 20, 60);

  select fr.status, fr.expires_at, c.name as clinic_name, c.enable_patient_comms
    into v_req
    from feedback_requests fr
    join clinics c on c.id = fr.clinic_id
    where fr.token = p_token;

  if not found
     or v_req.status <> 'pending'
     or v_req.expires_at < now()
     or v_req.enable_patient_comms is not true
  then
    raise exception 'This link is invalid or has expired.';
  end if;

  return v_req.clinic_name;
end $$;

create or replace function public.submit_feedback_response(
  p_token text,
  p_rating int,
  p_comment text
) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_req record;
begin
  perform public.check_public_rpc_rate_limit('submit_feedback_response', 10, 60);

  if p_rating < 1 or p_rating > 5 then
    raise exception 'This link is invalid or has expired.';
  end if;

  select fr.id, fr.clinic_id, fr.status, fr.expires_at, c.enable_patient_comms
    into v_req
    from feedback_requests fr
    join clinics c on c.id = fr.clinic_id
    where fr.token = p_token
    for update of fr;

  if not found
     or v_req.status <> 'pending'
     or v_req.expires_at < now()
     or v_req.enable_patient_comms is not true
  then
    raise exception 'This link is invalid or has expired.';
  end if;

  insert into feedback_responses (request_id, clinic_id, rating, comment)
  values (v_req.id, v_req.clinic_id, p_rating, nullif(trim(both from p_comment), ''));

  update feedback_requests set status = 'responded' where id = v_req.id;
end $$;

-- The whole point of these two — explicit, not relying on Postgres's
-- anon-gets-EXECUTE-by-default behavior (see rls_hardening.sql, which
-- revokes that default for sensitive functions elsewhere in this schema).
grant execute on function public.get_feedback_request_by_token(text) to anon, authenticated;
grant execute on function public.submit_feedback_response(text, int, text) to anon, authenticated;
