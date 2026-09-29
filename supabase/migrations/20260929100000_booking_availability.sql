ALTER TABLE public.clinics
  ADD COLUMN closed_weekdays integer[] NOT NULL DEFAULT '{}';

CREATE TABLE public.clinic_closed_dates (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references public.clinics(id) on delete cascade,
  closed_date date not null,
  label text,
  created_at timestamptz not null default now()
);
CREATE INDEX clinic_closed_dates_clinic_id_idx ON public.clinic_closed_dates (clinic_id, closed_date);

CREATE OR REPLACE FUNCTION public.get_booking_availability(
  p_slug text,
  p_start_date date,
  p_end_date date
)
RETURNS json
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_clinic_id uuid;
  v_enabled boolean;
  v_closed_weekdays integer[];
  v_closed_dates json;
  v_booked_slots json;
BEGIN
  -- Rate limiting
  PERFORM public.check_public_rpc_rate_limit('get_booking_availability', 60, 60);

  SELECT c.id, c.enable_patient_comms, c.closed_weekdays 
  INTO v_clinic_id, v_enabled, v_closed_weekdays
  FROM public.clinics c 
  WHERE c.booking_slug = p_slug;

  IF NOT FOUND OR v_enabled IS NOT TRUE THEN
    RAISE EXCEPTION 'This booking page is not available.';
  END IF;

  -- Get closed dates
  SELECT COALESCE(json_agg(
    json_build_object('date', d.closed_date, 'label', d.label)
  ), '[]'::json)
  INTO v_closed_dates
  FROM public.clinic_closed_dates d
  WHERE d.clinic_id = v_clinic_id
    AND d.closed_date >= p_start_date
    AND d.closed_date <= p_end_date;

  -- Get booked slots from confirmed appointments
  SELECT COALESCE(json_agg(
    json_build_object(
      'scheduled_at', a.scheduled_at,
      'therapist_id', a.therapist_id
    )
  ), '[]'::json)
  INTO v_booked_slots
  FROM public.appointments a
  WHERE a.clinic_id = v_clinic_id
    AND a.scheduled_at >= p_start_date::timestamp
    AND a.scheduled_at < (p_end_date + interval '1 day')::timestamp;

  RETURN json_build_object(
    'closedWeekdays', v_closed_weekdays,
    'closedDates', v_closed_dates,
    'appointments', v_booked_slots
  );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.get_booking_availability(text, date, date) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.get_booking_availability(text, date, date) TO anon, authenticated;
