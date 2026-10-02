-- ---------------------------------------------------------------------------
-- Phase 6.3: show the clinic's logo on the public /f/$token feedback form,
-- same branding treatment the public booking form already got
-- (get_booking_clinic_info). Return type changes text -> jsonb, so drop
-- before recreate.
-- ---------------------------------------------------------------------------
drop function if exists public.get_feedback_request_by_token(text);

create or replace function public.get_feedback_request_by_token(p_token text)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_req record;
begin
  perform public.check_public_rpc_rate_limit('get_feedback_request_by_token', 20, 60);

  select fr.status, fr.expires_at, c.name as clinic_name, c.logo_path, c.enable_patient_comms
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

  return jsonb_build_object('clinicName', v_req.clinic_name, 'logoPath', v_req.logo_path);
end $$;

grant execute on function public.get_feedback_request_by_token(text) to anon, authenticated;
