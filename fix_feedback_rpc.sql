create or replace function public.create_feedback_request(p_visit_id uuid)
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
language plpgsql
security definer
set search_path = public
as $$
#variable_conflict use_column
declare
  v_clinic_id uuid;
  v_patient_id uuid;
  v_therapist_id uuid;
begin
  select v.clinic_id, v.patient_id, v.therapist_id
    into v_clinic_id, v_patient_id, v_therapist_id
    from visits v
    where v.id = p_visit_id;

  if v_clinic_id is null then
    raise exception 'Visit not found.';
  end if;

  if not is_clinic_member(v_clinic_id) then
    raise exception 'not a member of this clinic';
  end if;

  if not (
    is_clinic_admin(v_clinic_id)
    or is_front_desk(v_clinic_id)
    or is_own_therapist(v_clinic_id, v_therapist_id)
  ) then
    raise exception 'Not authorized.';
  end if;

  if not exists (
    select 1 from clinics c
    where c.id = v_clinic_id and c.enable_patient_comms is true
  ) then
    raise exception 'Patient communications is not enabled for this clinic.';
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
end;
$$;
