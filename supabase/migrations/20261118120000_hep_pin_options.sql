-- HEP PIN usability (Options A + B):
--   A) Store staff-viewable 4-digit pin_code (never granted to anon; readable only via get_patient_hep_pin)
--      while generating random 4-digit PINs for new links when no custom PIN is supplied.
--   B) Add clinics.hep_require_pin (default true). When false for a clinic, patient portal links open without a PIN.

alter table public.clinics
  add column if not exists hep_require_pin boolean not null default true;

alter table public.patient_hep_access
  add column if not exists pin_code text;

-- 1. Staff-only RPC to read a patient's existing 4-digit HEP PIN without resetting it.
create or replace function public.get_patient_hep_pin(p_patient_id uuid)
returns text
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_clinic uuid;
  v_pin text;
begin
  select clinic_id into v_clinic from public.patients where id = p_patient_id;
  if v_clinic is null or not public.is_hep_staff(v_clinic) then
    raise exception 'Not a member of this clinic.';
  end if;
  select pin_code into v_pin from public.patient_hep_access where patient_id = p_patient_id;
  return v_pin;
end;
$$;

revoke all on function public.get_patient_hep_pin(uuid) from public, anon;
grant execute on function public.get_patient_hep_pin(uuid) to authenticated;

-- 2. reset_hep_pin also stores pin_code so therapists can view it later.
create or replace function public.reset_hep_pin(p_patient_id uuid) returns text
language plpgsql security definer set search_path = pg_catalog, public, extensions as $$
declare v_clinic uuid; v_pin text;
begin
  select clinic_id into v_clinic from public.patients where id = p_patient_id;
  if v_clinic is null or not public.is_hep_staff(v_clinic) then
    raise exception 'Not a member of this clinic.';
  end if;
  v_pin := lpad(((get_byte(extensions.gen_random_bytes(2), 0) * 256 + get_byte(extensions.gen_random_bytes(2), 1)) % 10000)::text, 4, '0');
  update public.patient_hep_access
     set pin_hash = extensions.crypt(v_pin, extensions.gen_salt('bf')),
         pin_code = v_pin,
         failed_attempts = 0, locked_until = null, updated_at = now()
   where patient_id = p_patient_id;
  if not found then
    raise exception 'This patient has no exercise link yet.';
  end if;
  delete from public.hep_device_sessions where patient_id = p_patient_id;
  return v_pin;
end;
$$;
revoke all on function public.reset_hep_pin(uuid) from public, anon;
grant execute on function public.reset_hep_pin(uuid) to authenticated;

-- 3. create_program defaults initial PIN to the last 4 digits of the patient's phone when present, and stores pin_code.
create or replace function public.create_program(
  p_clinic_id uuid,
  p_patient_id uuid,
  p_therapist_id uuid default null,
  p_title text default '',
  p_items jsonb default '[]'::jsonb,
  p_custom_pin text default null,
  p_source_template_id uuid default null,
  p_today date default null,
  p_settings jsonb default '{}'::jsonb
) returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, platform_admin, extensions
as $$
declare
  v_active_count int;
  v_resolved_patient_id uuid := p_patient_id;
  v_pin text;
  v_needs_pin boolean;
  v_revoked boolean;
  v_program_id uuid := gen_random_uuid();
  v_token text;
  v_item jsonb;
  v_idx smallint := 0;
  v_spd smallint;
  v_today date;
begin
  if not public.is_hep_staff(p_clinic_id) then
    raise exception 'Not a member of this clinic.';
  end if;
  v_today := coalesce(p_today, platform_admin.clinic_today(p_clinic_id));

  if p_therapist_id is not null
     and not exists (select 1 from public.therapists t where t.id = p_therapist_id and t.clinic_id = p_clinic_id) then
    raise exception 'Therapist does not belong to this clinic.';
  end if;
  if not public.hep_item_keys_ok(p_clinic_id, p_items) then
    raise exception 'Picture does not belong to this clinic.';
  end if;

  if not exists (
    select 1 from public.patients
     where id = v_resolved_patient_id
       and clinic_id = p_clinic_id
       and deleted_at is null
  ) then
    raise exception 'Patient does not belong to this clinic.';
  end if;

  if not public.clinic_has_unlimited_hep(p_clinic_id) then
    select count(*) into v_active_count
      from public.programs
     where clinic_id = p_clinic_id and status = 'active';
    if v_active_count >= (select l.active_programs from public.hep_tier_limits('lite') l) then
      raise exception 'You have reached the free-plan limit of % active programs. Visit theranet.in to upgrade.',
        (select l.active_programs from public.hep_tier_limits('lite') l);
    end if;
  end if;

  insert into public.programs (
    id, clinic_id, patient_id, therapist_id, source_template_id, title, status, start_date,
    duration_days, target_pct, checkin_on, feedback_default, sessions_per_day
  ) values (
    v_program_id, p_clinic_id, v_resolved_patient_id, p_therapist_id, p_source_template_id,
    btrim(p_title), 'active', v_today,
    case when coalesce(p_settings, '{}'::jsonb) ? 'durationDays' then nullif(p_settings->>'durationDays', '')::smallint else 7 end,
    coalesce(nullif(p_settings->>'targetPct', '')::smallint, 70),
    v_today + case when coalesce(p_settings, '{}'::jsonb) ? 'checkinDays'
      then nullif(p_settings->>'checkinDays', '')::int else 7 end,
    coalesce(nullif(p_settings->>'feedbackDefault', ''), 'pain'),
    coalesce(nullif(p_settings->>'sessionsPerDay', '')::smallint, 1)
  );

  for v_item in select * from jsonb_array_elements(coalesce(p_items, '[]'::jsonb)) loop
    v_spd := coalesce((v_item->>'sessionsPerDay')::smallint, 1);
    insert into public.program_items (
      program_id, source_exercise_id, title, body_region, phase, instructions,
      media_type, media_keys, sets, reps, hold_seconds, sessions_per_day,
      sessions_schedule, side, stop_if, special_instructions, sort_order, added_on,
      equipment, dose_type, duration_seconds, rest_seconds, media_captions, optional
    ) values (
      v_program_id,
      nullif(v_item->>'sourceExerciseId', '')::uuid,
      btrim(coalesce(v_item->>'title', '')),
      coalesce(nullif(btrim(v_item->>'bodyRegion'), ''), 'General'),
      coalesce(nullif(btrim(v_item->>'phase'), ''), 'other'),
      coalesce(v_item->>'instructions', ''),
      coalesce(v_item->>'mediaType', 'none'),
      coalesce(array(select jsonb_array_elements_text(coalesce(v_item->'mediaKeys', '[]'::jsonb))), '{}'::text[]),
      coalesce((v_item->>'sets')::smallint, 3),
      nullif(v_item->>'reps', '')::smallint,
      nullif(v_item->>'holdSeconds', '')::smallint,
      v_spd,
      jsonb_build_array(jsonb_build_object('from', v_today::text, 'sessionsPerDay', v_spd)),
      coalesce(v_item->>'side', 'none'),
      coalesce(v_item->>'stopIf', ''),
      coalesce(v_item->>'specialInstructions', ''),
      v_idx,
      v_today,
      coalesce(array(select jsonb_array_elements_text(coalesce(v_item->'equipment', '[]'::jsonb))), '{}'::text[]),
      coalesce(nullif(v_item->>'doseType', ''), 'reps'),
      nullif(v_item->>'durationSeconds', '')::smallint,
      coalesce(nullif(v_item->>'restSeconds', '')::smallint, 30),
      coalesce(array(select jsonb_array_elements_text(coalesce(v_item->'mediaCaptions', '[]'::jsonb))), '{}'::text[]),
      coalesce((v_item->>'optional')::boolean, false)
    );
    v_idx := v_idx + 1;
  end loop;

  if p_custom_pin is not null and btrim(p_custom_pin) <> '' then
    if btrim(p_custom_pin) !~ '^[0-9]{4}$' then
      raise exception 'PIN must be exactly 4 digits.';
    end if;
    v_pin := btrim(p_custom_pin);
  end if;

  insert into public.patient_hep_access (patient_id, clinic_id)
  values (v_resolved_patient_id, p_clinic_id)
  on conflict (patient_id) do nothing;

  select (pin_hash is null), (link_revoked_at is not null) into v_needs_pin, v_revoked
    from public.patient_hep_access where patient_id = v_resolved_patient_id
     for update;

  if v_revoked then
    update public.patient_hep_access
       set token = public.generate_url_safe_token(),
           link_revoked_at = null,
           failed_attempts = 0, locked_until = null,
           updated_at = now()
     where patient_id = v_resolved_patient_id;
    delete from public.hep_device_sessions where patient_id = v_resolved_patient_id;
    v_needs_pin := true;
  end if;

  if v_pin is null and v_needs_pin then
    v_pin := lpad(((get_byte(extensions.gen_random_bytes(2), 0) * 256 + get_byte(extensions.gen_random_bytes(2), 1)) % 10000)::text, 4, '0');
  end if;
  if v_pin is not null then
    update public.patient_hep_access
       set pin_hash = extensions.crypt(v_pin, extensions.gen_salt('bf')),
           pin_code = v_pin,
           failed_attempts = 0, locked_until = null,
           updated_at = now()
     where patient_id = v_resolved_patient_id;
  end if;

  select token into v_token from public.patient_hep_access where patient_id = v_resolved_patient_id;

  return jsonb_build_object('programId', v_program_id, 'patientId', v_resolved_patient_id, 'token', v_token, 'pin', v_pin);
end;
$$;

revoke all on function public.create_program(uuid, uuid, uuid, text, jsonb, text, uuid, date, jsonb) from public, anon;
grant execute on function public.create_program(uuid, uuid, uuid, text, jsonb, text, uuid, date, jsonb) to authenticated;

-- 4. update_program keeps pin_code in sync when p_custom_pin is updated.
create or replace function public.update_program(
  p_program_id uuid,
  p_title text,
  p_status text,
  p_items jsonb,
  p_custom_pin text default null,
  p_today date default null,
  p_settings jsonb default null
) returns void
language plpgsql
security definer
set search_path = pg_catalog, public, platform_admin, extensions
as $$
declare
  v_prog public.programs;
  v_active_count int;
  v_item jsonb;
  v_item_id uuid;
  v_existing public.program_items;
  v_kept_ids uuid[] := '{}'::uuid[];
  v_idx smallint := 0;
  v_new_spd smallint;
  v_today_spd smallint;
  v_sched jsonb;
  v_today date;
  v_today_str text;
  v_tomorrow text;
begin
  select * into v_prog from public.programs where id = p_program_id for update;
  if not found then
    raise exception 'Program not found.';
  end if;
  if not public.is_hep_staff(v_prog.clinic_id) then
    raise exception 'Not a member of this clinic.';
  end if;
  if not public.hep_item_keys_ok(v_prog.clinic_id, p_items) then
    raise exception 'Picture does not belong to this clinic.';
  end if;
  v_today := coalesce(p_today, platform_admin.clinic_today(v_prog.clinic_id));
  v_today_str := v_today::text;
  v_tomorrow := (v_today + 1)::text;

  if p_status = 'active' and v_prog.status <> 'active' then
    if not public.clinic_has_unlimited_hep(v_prog.clinic_id) then
      select count(*) into v_active_count
        from public.programs
       where clinic_id = v_prog.clinic_id and status = 'active' and id <> p_program_id;
      if v_active_count >= (select l.active_programs from public.hep_tier_limits('lite') l) then
        raise exception 'You have reached the free-plan limit of % active programs. Visit theranet.in to upgrade.',
          (select l.active_programs from public.hep_tier_limits('lite') l);
      end if;
    end if;
  end if;

  update public.programs
     set title = btrim(p_title),
         status = p_status,
         duration_days = case when p_settings ? 'durationDays'
                              then nullif(p_settings->>'durationDays', '')::smallint else duration_days end,
         target_pct = coalesce(nullif(p_settings->>'targetPct', '')::smallint, target_pct),
         checkin_on = case when p_settings ? 'checkinOn'
                           then nullif(p_settings->>'checkinOn', '')::date else checkin_on end,
         feedback_default = coalesce(nullif(p_settings->>'feedbackDefault', ''), feedback_default),
         sessions_per_day = coalesce(nullif(p_settings->>'sessionsPerDay', '')::smallint, sessions_per_day),
         updated_at = now()
   where id = p_program_id;

  for v_item in select * from jsonb_array_elements(coalesce(p_items, '[]'::jsonb)) loop
    v_item_id := nullif(v_item->>'id', '')::uuid;
    v_new_spd := coalesce((v_item->>'sessionsPerDay')::smallint, 1);

    if v_item_id is not null then
      select * into v_existing
        from public.program_items
       where id = v_item_id and program_id = p_program_id;
    else
      v_existing := null;
    end if;

    if v_existing.id is not null then
      select coalesce(
        (
          select (e->>'sessionsPerDay')::smallint
            from jsonb_array_elements(coalesce(v_existing.sessions_schedule, '[]'::jsonb)) with ordinality as t(e, ord)
           where (e->>'from') <= v_today_str
           order by (e->>'from') desc, ord desc
           limit 1
        ),
        v_existing.sessions_per_day
      ) into v_today_spd;

      select coalesce(
        jsonb_agg(e order by (e->>'from') asc, ord asc),
        jsonb_build_array(jsonb_build_object('from', v_existing.added_on::text, 'sessionsPerDay', v_today_spd))
      )
      into v_sched
      from jsonb_array_elements(coalesce(v_existing.sessions_schedule, '[]'::jsonb)) with ordinality as t(e, ord)
      where (e->>'from') <> v_tomorrow;

      if v_new_spd <> v_today_spd then
        v_sched := v_sched || jsonb_build_array(
          jsonb_build_object('from', v_tomorrow, 'sessionsPerDay', v_new_spd)
        );
      end if;

      update public.program_items
         set title = btrim(coalesce(v_item->>'title', v_existing.title)),
             instructions = coalesce(v_item->>'instructions', v_existing.instructions),
             sets = coalesce((v_item->>'sets')::smallint, v_existing.sets),
             dose_type = coalesce(nullif(v_item->>'doseType', ''), v_existing.dose_type),
             reps = nullif(v_item->>'reps', '')::smallint,
             hold_seconds = nullif(v_item->>'holdSeconds', '')::smallint,
             duration_seconds = nullif(v_item->>'durationSeconds', '')::smallint,
             rest_seconds = coalesce(nullif(v_item->>'restSeconds', '')::smallint, v_existing.rest_seconds),
             equipment = case when v_item ? 'equipment'
                              then coalesce(array(select jsonb_array_elements_text(v_item->'equipment')), '{}'::text[])
                              else v_existing.equipment end,
             optional = coalesce((v_item->>'optional')::boolean, v_existing.optional),
             media_captions = case when v_item ? 'mediaCaptions'
                              then coalesce(array(select jsonb_array_elements_text(v_item->'mediaCaptions')), '{}'::text[])
                              else v_existing.media_captions end,
             sessions_per_day = v_today_spd,
             sessions_schedule = v_sched,
             side = coalesce(v_item->>'side', v_existing.side),
             stop_if = coalesce(v_item->>'stopIf', v_existing.stop_if),
             special_instructions = coalesce(v_item->>'specialInstructions', v_existing.special_instructions),
             sort_order = v_idx,
             removed_on = null
       where id = v_existing.id;

      v_kept_ids := array_append(v_kept_ids, v_existing.id);
    else
      v_item_id := gen_random_uuid();
      insert into public.program_items (
        id, program_id, source_exercise_id, title, body_region, phase, instructions,
        media_type, media_keys, sets, reps, hold_seconds, sessions_per_day,
        sessions_schedule, side, stop_if, special_instructions, sort_order, added_on,
        equipment, dose_type, duration_seconds, rest_seconds, media_captions, optional
      ) values (
        v_item_id,
        p_program_id,
        nullif(v_item->>'sourceExerciseId', '')::uuid,
        btrim(coalesce(v_item->>'title', '')),
        coalesce(nullif(btrim(v_item->>'bodyRegion'), ''), 'General'),
        coalesce(nullif(btrim(v_item->>'phase'), ''), 'other'),
        coalesce(v_item->>'instructions', ''),
        coalesce(v_item->>'mediaType', 'none'),
        coalesce(array(select jsonb_array_elements_text(coalesce(v_item->'mediaKeys', '[]'::jsonb))), '{}'::text[]),
        coalesce((v_item->>'sets')::smallint, 3),
        nullif(v_item->>'reps', '')::smallint,
        nullif(v_item->>'holdSeconds', '')::smallint,
        v_new_spd,
        jsonb_build_array(jsonb_build_object('from', v_today::text, 'sessionsPerDay', v_new_spd)),
        coalesce(v_item->>'side', 'none'),
        coalesce(v_item->>'stopIf', ''),
        coalesce(v_item->>'specialInstructions', ''),
        v_idx,
        v_today,
        coalesce(array(select jsonb_array_elements_text(coalesce(v_item->'equipment', '[]'::jsonb))), '{}'::text[]),
        coalesce(nullif(v_item->>'doseType', ''), 'reps'),
        nullif(v_item->>'durationSeconds', '')::smallint,
        coalesce(nullif(v_item->>'restSeconds', '')::smallint, 30),
        coalesce(array(select jsonb_array_elements_text(coalesce(v_item->'mediaCaptions', '[]'::jsonb))), '{}'::text[]),
        coalesce((v_item->>'optional')::boolean, false)
      );
      v_kept_ids := array_append(v_kept_ids, v_item_id);
    end if;

    v_idx := v_idx + 1;
  end loop;

  update public.program_items
     set removed_on = v_today
   where program_id = p_program_id
     and removed_on is null
     and not (id = any(v_kept_ids));

  if p_custom_pin is not null and btrim(p_custom_pin) <> '' then
    if btrim(p_custom_pin) !~ '^[0-9]{4}$' then
      raise exception 'PIN must be exactly 4 digits.';
    end if;
    update public.patient_hep_access
       set pin_hash = extensions.crypt(btrim(p_custom_pin), extensions.gen_salt('bf')),
           pin_code = btrim(p_custom_pin),
           failed_attempts = 0, locked_until = null,
           updated_at = now()
     where patient_id = v_prog.patient_id;
  end if;
end;
$$;

revoke all on function public.update_program(uuid, text, text, jsonb, text, date, jsonb) from public, anon;
grant execute on function public.update_program(uuid, text, text, jsonb, text, date, jsonb) to authenticated;

-- 5. hep_verify honours clinics.hep_require_pin: when false, valid unrevoked tokens open without a PIN.
create or replace function public.hep_verify(p_token text, p_pin text, p_device text default null)
returns table (patient_id uuid, outcome text, attempts_left int)
language plpgsql
security definer
set search_path = pg_catalog, public, extensions
as $$
declare
  v_access public.patient_hep_access;
  v_require_pin boolean := true;
  v_ok boolean;
  v_new smallint;
  v_dev uuid;
begin
  select a.* into v_access
    from public.patient_hep_access a
    join public.patients p on p.id = a.patient_id and p.deleted_at is null
   where a.token = btrim(coalesce(p_token, ''))
     and a.link_revoked_at is null
   for update of a;

  if not found then
    return query select null::uuid, 'unavailable'::text, 0;
    return;
  end if;

  select coalesce(c.hep_require_pin, true) into v_require_pin
    from public.clinics c
    join public.patients p on p.clinic_id = c.id
   where p.id = v_access.patient_id;

  if not v_require_pin then
    if v_access.failed_attempts > 0 or v_access.locked_until is not null then
      update public.patient_hep_access ha
         set failed_attempts = 0, locked_until = null, updated_at = now()
       where ha.patient_id = v_access.patient_id;
    end if;
    return query select v_access.patient_id, 'ok'::text, 5;
    return;
  end if;

  if p_device is not null and btrim(p_device) <> '' then
    select d.id into v_dev
      from public.hep_device_sessions d
     where d.patient_id = v_access.patient_id
       and d.token_hash = encode(extensions.digest(btrim(p_device), 'sha256'), 'hex')
       and d.expires_at > now()
       and d.created_at > now() - interval '180 days';
    if v_dev is not null then
      update public.hep_device_sessions
         set last_used_at = now(), expires_at = now() + interval '30 days'
       where id = v_dev;
      return query select v_access.patient_id, 'ok'::text, 5;
      return;
    end if;
  end if;

  if v_access.locked_until is not null and v_access.locked_until > now() then
    return query select null::uuid, 'locked'::text, 0;
    return;
  end if;

  if p_pin is null or btrim(p_pin) = '' then
    return query select null::uuid, 'pin_needed'::text, 5 - v_access.failed_attempts::int;
    return;
  end if;

  v_ok := v_access.pin_hash is not null
          and btrim(coalesce(p_pin, '')) ~ '^[0-9]{4}$'
          and v_access.pin_hash = extensions.crypt(btrim(p_pin), v_access.pin_hash);

  if not v_ok then
    v_new := v_access.failed_attempts + 1;
    update public.patient_hep_access ha
       set failed_attempts = case when v_new >= 5 then 0 else v_new end,
           locked_until = case when v_new >= 5 then now() + interval '15 minutes' else null end,
           updated_at = now()
     where ha.patient_id = v_access.patient_id;
    if v_new >= 5 then
      return query select null::uuid, 'locked'::text, 0;
    else
      return query select null::uuid, 'wrong_pin'::text, (5 - v_new)::int;
    end if;
    return;
  end if;

  if v_access.failed_attempts > 0 or v_access.locked_until is not null then
    update public.patient_hep_access ha
       set failed_attempts = 0, locked_until = null, updated_at = now()
     where ha.patient_id = v_access.patient_id;
  end if;

  return query select v_access.patient_id, 'ok'::text, 5;
end;
$$;

revoke all on function public.hep_verify(text, text, text) from public, anon, authenticated;
