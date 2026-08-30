-- ---------------------------------------------------------------------------
-- Patient Communications, Slice 3: Google review nudge on 4-5* feedback.
-- Per docs/HANDOFF-patient-comms.md's Feedback UX section: "Thank-you page:
-- if 4-5* and clinic has googleReviewUrl, show 'Leave a Google review'.
-- Staff also get 'Ask for a Google review' on 4-5* responses." 1-3* never
-- gets a Google button, anywhere.
-- ---------------------------------------------------------------------------
alter table public.clinics add column google_review_url text;

-- submit_feedback_response now returns the clinic's google_review_url when
-- the rating qualifies (4-5*) and one is configured, null otherwise — the
-- public thank-you page conditions the "Leave a Google review" button on
-- this return value rather than a second round trip. Return type changes
-- (void -> text), so drop before recreate.
drop function if exists public.submit_feedback_response(text, int, text);

create or replace function public.submit_feedback_response(
  p_token text,
  p_rating int,
  p_comment text
) returns text
language plpgsql security definer set search_path = public as $$
declare
  v_req record;
begin
  perform public.check_public_rpc_rate_limit('submit_feedback_response', 10, 60);

  if p_rating < 1 or p_rating > 5 then
    raise exception 'This link is invalid or has expired.';
  end if;

  select fr.id, fr.clinic_id, fr.status, fr.expires_at, c.enable_patient_comms,
         c.google_review_url
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

  if p_rating >= 4 then
    return v_req.google_review_url;
  end if;
  return null;
end $$;

-- Explicit, not relying on Postgres's anon-gets-EXECUTE-by-default
-- behavior — same reasoning the original grant on this function used
-- (dropping the function drops its grants too, so this must be re-stated).
grant execute on function public.submit_feedback_response(text, int, text) to anon, authenticated;
