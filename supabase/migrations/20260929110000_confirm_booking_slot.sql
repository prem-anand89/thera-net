-- supabase/migrations/20260929110000_confirm_booking_slot.sql

-- Unified RPC to replace create_appointment_staff and confirm_appointment_request
-- Adds strict server-side overlap validation using clinic.slot_duration_minutes

CREATE OR REPLACE FUNCTION public.confirm_booking_slot(
  p_clinic_id uuid,
  p_name text,
  p_phone text,
  p_therapist_id uuid,
  p_scheduled_at timestamptz,
  p_patient_id uuid DEFAULT NULL,
  p_request_id uuid DEFAULT NULL
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_appointment_id uuid;
  v_slot_duration_minutes int;
  v_overlap_count int;
  v_start_time timestamptz;
  v_end_time timestamptz;
BEGIN
  IF NOT (is_clinic_admin(p_clinic_id) OR is_front_desk(p_clinic_id)) THEN
    RAISE EXCEPTION 'Not authorized.';
  END IF;

  IF trim(p_name) = '' THEN
    RAISE EXCEPTION 'Name is required.';
  END IF;
  IF trim(p_phone) = '' THEN
    RAISE EXCEPTION 'Phone is required.';
  END IF;
  
  IF p_patient_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM patients WHERE id = p_patient_id AND clinic_id = p_clinic_id) THEN
    RAISE EXCEPTION 'Patient not found in this clinic.';
  END IF;

  IF p_therapist_id IS NOT NULL THEN
    IF NOT EXISTS (SELECT 1 FROM clinic_members WHERE clinic_id = p_clinic_id AND user_id = p_therapist_id) THEN
      RAISE EXCEPTION 'Therapist is not a member of this clinic.';
    END IF;
  ELSE
    RAISE EXCEPTION 'Therapist selection is required to book a slot.';
  END IF;

  IF p_request_id IS NOT NULL THEN
    IF NOT EXISTS (SELECT 1 FROM appointment_requests WHERE id = p_request_id AND clinic_id = p_clinic_id AND status = 'pending') THEN
      RAISE EXCEPTION 'Booking request not found or already actioned.';
    END IF;
  END IF;

  -- Overlap validation
  SELECT slot_duration_minutes INTO v_slot_duration_minutes
  FROM clinics
  WHERE id = p_clinic_id;

  v_slot_duration_minutes := COALESCE(v_slot_duration_minutes, 30);
  v_start_time := p_scheduled_at;
  v_end_time := p_scheduled_at + (v_slot_duration_minutes || ' minutes')::interval;

  SELECT count(*) INTO v_overlap_count
  FROM appointments a
  WHERE a.clinic_id = p_clinic_id
    AND a.therapist_id = p_therapist_id
    AND a.status != 'cancelled'
    AND a.scheduled_at < v_end_time
    AND (a.scheduled_at + (v_slot_duration_minutes || ' minutes')::interval) > v_start_time;

  IF v_overlap_count > 0 THEN
    RAISE EXCEPTION 'This therapist already has an appointment scheduled at this time.';
  END IF;

  -- Insert appointment
  INSERT INTO appointments (
    clinic_id, patient_id, patient_name, patient_phone, therapist_id, scheduled_at, request_id
  ) VALUES (
    p_clinic_id, p_patient_id, trim(p_name), trim(p_phone), p_therapist_id, p_scheduled_at, p_request_id
  ) RETURNING id INTO v_appointment_id;

  -- Update request if it exists
  IF p_request_id IS NOT NULL THEN
    UPDATE appointment_requests
      SET status = 'confirmed', appointment_id = v_appointment_id
      WHERE id = p_request_id AND clinic_id = p_clinic_id;
  END IF;

  RETURN v_appointment_id;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.confirm_booking_slot(uuid, text, text, uuid, timestamptz, uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.confirm_booking_slot(uuid, text, text, uuid, timestamptz, uuid, uuid) TO authenticated;
