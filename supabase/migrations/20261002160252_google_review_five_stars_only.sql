-- ---------------------------------------------------------------------------
-- Raise the Google review bar from 4-5* to 5* only. Two independent RPCs
-- gate this, both from the same original "4-5*" decision in
-- 20260830170000_google_review_nudge.sql / 20260830180000_
-- google_review_eligibility_rpc.sql — they must move together, or staff
-- would see the front-desk "Ask for Google review" nudge light up for a
-- 4-star response that the patient's own thank-you page never offered the
-- Google link for in the first place.
-- ---------------------------------------------------------------------------

-- Same signature as the version it replaces — no drop needed.
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

  if p_rating = 5 then
    return v_req.google_review_url;
  end if;
  return null;
end $$;

grant execute on function public.submit_feedback_response(text, int, text) to anon, authenticated;

-- Front-desk's role-blind eligibility check (data.googleReviewUrl nudge
-- button) must agree with the threshold above.
create or replace function public.list_google_review_eligible_requests(p_clinic_id uuid)
returns setof uuid
language plpgsql stable security definer set search_path = public as $$
begin
  if not is_clinic_member(p_clinic_id) then
    raise exception 'not authorized';
  end if;
  return query
    select request_id from feedback_responses
    where clinic_id = p_clinic_id and rating = 5;
end $$;

revoke execute on function public.list_google_review_eligible_requests(uuid) from public, anon;
grant execute on function public.list_google_review_eligible_requests(uuid) to authenticated;
