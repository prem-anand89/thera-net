-- ---------------------------------------------------------------------------
-- Patient Communications: fix "no share option on Ask for feedback". The
-- original design had askForFeedback() go through the normal Dexie/outbox
-- path (an upsert relying on the token column's default to fire on INSERT
-- and the value syncing back down on the next pull) before anything could
-- be shared. In practice that meant the very first "+ Feedback" click never
-- opened a WhatsApp share at all -- only rotate_feedback_request_token(),
-- used by Resend, does that -- and Resend itself was hidden behind a 3-day
-- cooldown measured from creation time, so a brand-new request had no way
-- to be shared for 3 days after being asked for.
--
-- This RPC mirrors rotate_feedback_request_token(): one online round trip
-- that creates (or, if a pending request already exists for this visit --
-- e.g. a double-click race -- rotates) the row and returns the full row
-- immediately, so the client can write it straight into Dexie and open the
-- share sheet without waiting on a sync pull. security invoker, same as
-- rotate_feedback_request_token(): the existing feedback_requests_insert
-- RLS policy already gates who may create a request correctly.
--
-- clinic_id/patient_id/therapist_id are derived from the visit row rather
-- than trusted from the client, closing off a request for a visit the
-- caller doesn't actually have RLS-visible access to.
-- ---------------------------------------------------------------------------
create function public.create_feedback_request(p_visit_id uuid)
returns table (
  id uuid,
  clinic_id uuid,
  visit_id uuid,
  patient_id uuid,
  therapist_id uuid,
  token text,
  status text,
  expires_at timestamptz,
  updated_at timestamptz,
  created_by uuid,
  updated_by uuid
)
language plpgsql as $$
declare
  v_clinic_id uuid;
  v_patient_id uuid;
  v_therapist_id uuid;
begin
  select v.clinic_id, v.patient_id, v.therapist_id
    into v_clinic_id, v_patient_id, v_therapist_id
    from visits v where v.id = p_visit_id;

  if v_clinic_id is null then
    raise exception 'Visit not found.';
  end if;

  return query
  insert into feedback_requests (clinic_id, visit_id, patient_id, therapist_id)
  values (v_clinic_id, p_visit_id, v_patient_id, v_therapist_id)
  on conflict (visit_id) where status = 'pending'
    do update set token = public.generate_url_safe_token(),
                  expires_at = now() + interval '21 days',
                  status = 'pending',
                  updated_at = now()
  returning feedback_requests.id, feedback_requests.clinic_id, feedback_requests.visit_id,
            feedback_requests.patient_id, feedback_requests.therapist_id,
            feedback_requests.token, feedback_requests.status,
            feedback_requests.expires_at, feedback_requests.updated_at,
            feedback_requests.created_by, feedback_requests.updated_by;
end $$;

revoke execute on function public.create_feedback_request(uuid) from public, anon;
grant execute on function public.create_feedback_request(uuid) to authenticated;
