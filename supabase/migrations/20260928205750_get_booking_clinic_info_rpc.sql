CREATE OR REPLACE FUNCTION public.get_booking_clinic_info(p_slug text)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_row record;
BEGIN
  PERFORM public.check_public_rpc_rate_limit('get_booking_clinic_info', 30, 60);

  SELECT name, logo_path, enable_patient_comms, slot_duration_minutes
    INTO v_row
    FROM clinics WHERE booking_slug = p_slug;

  IF NOT FOUND OR v_row.enable_patient_comms IS NOT TRUE THEN
    RAISE EXCEPTION 'This booking page is not available.';
  END IF;

  RETURN jsonb_build_object(
    'name', v_row.name,
    'logoPath', v_row.logo_path,
    'slotDurationMinutes', v_row.slot_duration_minutes
  );
END;
$$;
