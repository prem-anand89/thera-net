-- HEP refinements: photo consent on exercises, a "Hide pictures in lists" flag, that flag on the patient page's items,
-- and the patient Home tab's data (get_public_hep_home). Earlier HEP migrations are live and are not edited.

-- 1. Exercise columns. Existing rows keep their pictures with no consent recorded; save_exercise asks for consent
--    the next time such an exercise is saved with pictures.
alter table public.exercises
  add column if not exists picture_consent_by uuid references auth.users (id),
  add column if not exists picture_consent_at timestamptz,
  add column if not exists hide_pictures_in_lists boolean not null default false;

-- 2. save_exercise gains p_picture_consent and p_hide_pictures_in_lists; drop the 25-argument version
--    (20261114200000_hep_exercise_positions.sql) so only one overload exists. Body otherwise unchanged.
drop function if exists public.save_exercise(uuid, uuid, text, text, text, text[], text[], text, text, text[], smallint, smallint, smallint, smallint, text, text, boolean, text, smallint, smallint, text[], boolean, text[], text, text[]);

create or replace function public.save_exercise(
  p_clinic_id uuid,
  p_id uuid default null,
  p_title text default '',
  p_body_region text default 'General',
  p_phase text default 'other',
  p_also_regions text[] default '{}'::text[],
  p_equipment text[] default '{}'::text[],
  p_instructions text default '',
  p_media_type text default 'none',
  p_media_keys text[] default '{}'::text[],
  p_default_sets smallint default 3,
  p_default_reps smallint default 10,
  p_default_hold_seconds smallint default null,
  p_default_sessions_per_day smallint default 1,
  p_side text default 'none',
  p_stop_if text default '',
  p_deleted boolean default false,
  p_dose_type text default 'reps',
  p_default_duration_seconds smallint default null,
  p_default_rest_seconds smallint default 30,
  p_media_captions text[] default '{}'::text[],
  p_active boolean default true,
  p_other_names text[] default '{}'::text[],
  p_thumb_key text default null,
  p_positions text[] default '{}'::text[],
  p_picture_consent boolean default false,
  p_hide_pictures_in_lists boolean default false
) returns uuid
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_count int;
  v_id uuid := coalesce(p_id, gen_random_uuid());
  v_exists boolean;
  v_has_media boolean := cardinality(coalesce(p_media_keys, '{}'::text[])) > 0;
  v_old_consent_at timestamptz;
  v_old_keys text[];
  v_record_consent boolean;
begin
  if not public.is_hep_staff(p_clinic_id) then
    raise exception 'Not a member of this clinic.';
  end if;

  -- Pictures must sit inside this clinic's own prefix (the hep-media function also checks this before it signs anything).
  if exists (
       select 1 from unnest(coalesce(p_media_keys, '{}'::text[]) || coalesce(array[p_thumb_key], '{}'::text[])) k
        where k is not null and (k not like 'clinics/' || p_clinic_id::text || '/exercises/%' or position('..' in k) > 0)
     ) then
    raise exception 'Picture does not belong to this clinic.';
  end if;

  select exists (select 1 from public.exercises where id = v_id and clinic_id = p_clinic_id)
    into v_exists;

  -- Photo consent: a row that will show pictures needs consent, either already recorded or ticked now. Archive and
  -- delete never ask (they only hide the row). Existing pictures without consent keep showing until the next save.
  if v_exists then
    select e.picture_consent_at, e.media_keys into v_old_consent_at, v_old_keys
      from public.exercises e
     where e.id = v_id and e.clinic_id = p_clinic_id;
  end if;
  if v_has_media and not coalesce(p_deleted, false) and coalesce(p_active, true)
     and v_old_consent_at is null and not coalesce(p_picture_consent, false) then
    raise exception 'Consent is needed for these pictures.';
  end if;
  -- Recorded when ticked and not yet recorded, or when the pictures themselves changed.
  v_record_consent := v_has_media and coalesce(p_picture_consent, false)
                      and (v_old_consent_at is null or v_old_keys is distinct from coalesce(p_media_keys, '{}'::text[]));

  if not v_exists and not p_deleted then
    if not public.clinic_has_unlimited_hep(p_clinic_id) then
      select count(*) into v_count
        from public.exercises
       where clinic_id = p_clinic_id and not deleted;
      if v_count >= (select l.exercises from public.hep_tier_limits('lite') l) then
        raise exception 'You have reached the free-plan limit of % exercises. Visit theranet.in to upgrade.',
          (select l.exercises from public.hep_tier_limits('lite') l);
      end if;
    end if;

    insert into public.exercises (
      id, clinic_id, title, body_region, phase, also_regions, equipment, instructions, media_type, media_keys,
      default_sets, default_reps, default_hold_seconds, default_sessions_per_day,
      side, stop_if, deleted,
      dose_type, default_duration_seconds, default_rest_seconds, media_captions, active, other_names, thumb_key, positions,
      hide_pictures_in_lists
    ) values (
      v_id, p_clinic_id, btrim(p_title), btrim(p_body_region), coalesce(nullif(btrim(p_phase), ''), 'other'), coalesce(p_also_regions, '{}'::text[]), coalesce(p_equipment, '{}'::text[]), coalesce(p_instructions, ''),
      p_media_type, coalesce(p_media_keys, '{}'::text[]),
      p_default_sets, p_default_reps, p_default_hold_seconds, p_default_sessions_per_day,
      p_side, coalesce(p_stop_if, ''), false,
      coalesce(nullif(btrim(p_dose_type), ''), 'reps'), p_default_duration_seconds,
      coalesce(p_default_rest_seconds, 30), coalesce(p_media_captions, '{}'::text[]), coalesce(p_active, true), coalesce(p_other_names, '{}'::text[]), p_thumb_key, coalesce(p_positions, '{}'::text[]),
      coalesce(p_hide_pictures_in_lists, false)
    );
  else
    update public.exercises
       set title = btrim(p_title),
           body_region = btrim(p_body_region),
           phase = coalesce(nullif(btrim(p_phase), ''), 'other'),
           also_regions = coalesce(p_also_regions, '{}'::text[]),
           equipment = coalesce(p_equipment, '{}'::text[]),
           instructions = coalesce(p_instructions, ''),
           media_type = p_media_type,
           media_keys = coalesce(p_media_keys, '{}'::text[]),
           default_sets = p_default_sets,
           default_reps = p_default_reps,
           default_hold_seconds = p_default_hold_seconds,
           default_sessions_per_day = p_default_sessions_per_day,
           side = p_side,
           stop_if = coalesce(p_stop_if, ''),
           deleted = coalesce(p_deleted, false),
           dose_type = coalesce(nullif(btrim(p_dose_type), ''), 'reps'),
           default_duration_seconds = p_default_duration_seconds,
           default_rest_seconds = coalesce(p_default_rest_seconds, 30),
           media_captions = coalesce(p_media_captions, '{}'::text[]),
           active = coalesce(p_active, true),          -- false = archived (amendment 74)
           other_names = coalesce(p_other_names, '{}'::text[]),
           thumb_key = p_thumb_key,
           positions = coalesce(p_positions, '{}'::text[]),
           hide_pictures_in_lists = coalesce(p_hide_pictures_in_lists, false),
           version = version + 1,
           updated_at = now()
     where id = v_id and clinic_id = p_clinic_id;
  end if;

  if v_record_consent then
    update public.exercises
       set picture_consent_by = auth.uid(),
           picture_consent_at = now()
     where id = v_id and clinic_id = p_clinic_id;
  end if;

  return v_id;
end;
$$;

revoke all on function public.save_exercise(uuid, uuid, text, text, text, text[], text[], text, text, text[], smallint, smallint, smallint, smallint, text, text, boolean, text, smallint, smallint, text[], boolean, text[], text, text[], boolean, boolean) from public, anon;
grant execute on function public.save_exercise(uuid, uuid, text, text, text, text[], text[], text, text, text[], smallint, smallint, smallint, smallint, text, text, boolean, text, smallint, smallint, text[], boolean, text[], text, text[], boolean, boolean) to authenticated;

-- 3. get_public_hep (from 20261113200000_hep_module.sql): the same signature, grants and payload, plus each item's
--    hidePicturesInLists from the exercise it was copied from (false when it has none).
create or replace function public.get_public_hep(
  p_token text,
  p_pin text,
  p_device text default null,
  p_program_id uuid default null,
  p_reason text default 'open'
) returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, platform_admin
as $$
declare
  v record;
  v_patient_id uuid;
  v_clinic_id uuid;
  v_today date;
  v_clinic jsonb;
  v_programs jsonb;
  v_shown uuid;
  v_items jsonb;
  v_logs jsonb;
  v_feedback jsonb;
begin
  if not public.hep_rate_ok(p_token) then
    return jsonb_build_object('ok', false, 'reason', 'busy');
  end if;
  select * into v from public.hep_verify(p_token, p_pin, p_device);
  if v.outcome <> 'ok' then
    return jsonb_build_object('ok', false, 'reason', v.outcome, 'attemptsLeft', v.attempts_left);
  end if;
  v_patient_id := v.patient_id;

  select p.clinic_id,
         jsonb_build_object('name', c.name, 'logoPath', c.logo_path, 'phone', c.phone, 'timezone', c.timezone)
    into v_clinic_id, v_clinic
    from public.patients p
    join public.clinics c on c.id = p.clinic_id
   where p.id = v_patient_id;
  v_today := platform_admin.clinic_today(v_clinic_id);

  if coalesce(p_reason, 'open') = 'open' then
    -- The first time the patient's page shows a program (amendment 72: "Opened ✓" and "Link not opened yet").
    update public.programs set first_opened_at = now()
     where patient_id = v_patient_id and status = 'active' and first_opened_at is null
       and id = coalesce(p_program_id, (select p2.id from public.programs p2
                                         where p2.patient_id = v_patient_id and p2.status = 'active'
                                         order by p2.start_date desc, p2.created_at desc limit 1));
    update public.patient_hep_access
       set open_count = open_count + 1, last_opened_at = now()
     where patient_id = v_patient_id
       and (last_opened_at is null or last_opened_at < now() - interval '30 minutes');
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
           'id', prog.id,
           'title', prog.title,
           'startDate', prog.start_date,
           'durationDays', prog.duration_days,
           'feedbackDefault', prog.feedback_default,
           'prescribedBy', nullif(split_part(btrim(coalesce(t.name, '')), ' ', 1), '')
         ) order by prog.start_date desc, prog.created_at desc), '[]'::jsonb)
    into v_programs
    from public.programs prog
    left join public.therapists t on t.id = prog.therapist_id
   where prog.patient_id = v_patient_id and prog.status = 'active';

  select prog.id into v_shown
    from public.programs prog
   where prog.patient_id = v_patient_id
     and prog.status = 'active'
     and (p_program_id is null or prog.id = p_program_id)
   order by prog.start_date desc, prog.created_at desc
   limit 1;

  select coalesce(jsonb_agg(jsonb_build_object(
           'id', pi.id,
           'title', pi.title,
           'phase', pi.phase,
           'equipment', to_jsonb(pi.equipment),
           'instructions', pi.instructions,
           'mediaType', pi.media_type,
           'mediaKeys', to_jsonb(pi.media_keys),
           'sets', pi.sets,
           'reps', pi.reps,
           'doseType', pi.dose_type,
           'durationSeconds', pi.duration_seconds,
           'restSeconds', pi.rest_seconds,
           'mediaCaptions', to_jsonb(pi.media_captions),
           'optional', pi.optional,
           'holdSeconds', pi.hold_seconds,
           'sessionsPerDay', pi.sessions_per_day,
           'sessionsSchedule', pi.sessions_schedule,
           'side', pi.side,
           'stopIf', pi.stop_if,
           'specialInstructions', pi.special_instructions,
           'sortOrder', pi.sort_order,
           'addedOn', pi.added_on,
           'hidePicturesInLists', coalesce(ex.hide_pictures_in_lists, false)
         ) order by pi.sort_order), '[]'::jsonb)
    into v_items
    from public.program_items pi
    left join public.exercises ex on ex.id = pi.source_exercise_id
   where pi.program_id = v_shown and pi.removed_on is null;

  select coalesce(jsonb_agg(jsonb_build_object(
           'programItemId', l.program_item_id,
           'logDate', l.log_date,
           'sessionIndex', l.session_index,
           'skipped', l.skipped,
           'skipReason', l.skip_reason,
           'completedAt', l.completed_at
         )), '[]'::jsonb)
    into v_logs
    from public.program_logs l
    join public.program_items pi on pi.id = l.program_item_id
   where pi.program_id = v_shown
     and l.log_date >= v_today - 13;

  select coalesce(jsonb_agg(jsonb_build_object(
           'sessionIndex', f.session_index,
           'pain', f.pain_score,
           'effort', f.effort_score,
           'painItemIds', to_jsonb(f.pain_item_ids),
           'hardItemIds', to_jsonb(f.hard_item_ids)
         )), '[]'::jsonb)
    into v_feedback
    from public.program_session_feedback f
   where f.program_id = v_shown and f.log_date = v_today;

  return jsonb_build_object(
    'ok', true,
    'clinicId', v_clinic_id,
    'today', v_today,
    'clinic', v_clinic,
    'programs', v_programs,
    'shownProgramId', v_shown,
    'items', v_items,
    'logs', v_logs,
    'sessionFeedback', v_feedback
  );
end;
$$;

revoke all on function public.get_public_hep(text, text, text, uuid, text) from public;
grant execute on function public.get_public_hep(text, text, text, uuid, text) to anon, authenticated;

-- 4. get_public_hep_home: the patient Home tab. Same rate limit, hep_verify (PIN or remembered phone, lockout) and
--    failure shape as get_public_hep. Returns only this patient's own first name, next booking, open package progress
--    and programs, plus the clinic's booking slug for "Book a visit": never prices, notes or other patients.
create or replace function public.get_public_hep_home(p_token text, p_pin text, p_device text default null)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, platform_admin
as $$
declare
  v record;
  v_patient_id uuid;
  v_clinic_id uuid;
  v_today date;
  v_first text;
  v_slug text;
  v_next jsonb;
  v_package jsonb;
  v_programs jsonb;
begin
  if not public.hep_rate_ok(p_token) then
    return jsonb_build_object('ok', false, 'reason', 'busy');
  end if;
  select * into v from public.hep_verify(p_token, p_pin, p_device);
  if v.outcome <> 'ok' then
    return jsonb_build_object('ok', false, 'reason', v.outcome, 'attemptsLeft', v.attempts_left);
  end if;
  v_patient_id := v.patient_id;

  select p.clinic_id, nullif(split_part(btrim(coalesce(p.name, '')), ' ', 1), ''), c.booking_slug
    into v_clinic_id, v_first, v_slug
    from public.patients p
    join public.clinics c on c.id = p.clinic_id
   where p.id = v_patient_id;
  v_today := platform_admin.clinic_today(v_clinic_id);

  -- Next visit: this patient's earliest booking still to come.
  select jsonb_build_object(
           'at', a.scheduled_at,
           'therapistName', nullif(btrim(coalesce(t.name, '')), ''),
           'location', a.location
         )
    into v_next
    from public.appointments a
    left join public.therapists t on t.id = a.therapist_id
   where a.patient_id = v_patient_id
     and a.clinic_id = v_clinic_id
     and a.scheduled_at >= now()
     and a.status in ('confirmed', 'rescheduled')
   order by a.scheduled_at
   limit 1;

  -- Package: the newest open one, the same rule as groupOpenPackages / packageExpiresOn (src/domain/packageTracking.ts):
  -- live sessions of one package_group_id, still short of package_total (1 when unset), and not past its last valid
  -- day (first live visit + package_validity_days; the last valid day itself still counts). Name from the catalog only.
  select jsonb_build_object('name', sc.name, 'done', g.done, 'total', g.total, 'expiresOn', g.expires_on)
    into v_package
    from (
      select s.*,
             case when s.validity is null then null else s.first_on + s.validity end as expires_on
        from (
          select vi.package_group_id,
                 count(*)::int as done,
                 coalesce((array_agg(vi.package_total order by vi.visit_date, vi.session_index nulls last))[1], 1)::int as total,
                 max(vi.package_validity_days)::int as validity,
                 min(vi.visit_date) as first_on,
                 max(vi.visit_date) as last_on,
                 (array_agg(vi.service_catalog_id order by vi.visit_date, vi.session_index nulls last))[1] as service_catalog_id
            from public.visits vi
           where vi.patient_id = v_patient_id
             and vi.clinic_id = v_clinic_id
             and not vi.deleted
             and vi.package_group_id is not null
           group by vi.package_group_id
        ) s
    ) g
    left join public.service_catalog sc on sc.id = g.service_catalog_id
   where g.done < g.total
     and (g.expires_on is null or g.expires_on >= v_today)
   order by g.first_on desc, g.last_on desc
   limit 1;

  -- Programs: active, paused and completed, newest first, with how many exercises each holds today.
  select coalesce(jsonb_agg(jsonb_build_object(
           'id', prog.id,
           'title', prog.title,
           'status', prog.status,
           'startDate', prog.start_date,
           'durationDays', prog.duration_days,
           'itemCount', (select count(*)::int from public.program_items pi
                          where pi.program_id = prog.id and pi.removed_on is null)
         ) order by prog.start_date desc, prog.created_at desc), '[]'::jsonb)
    into v_programs
    from public.programs prog
   where prog.patient_id = v_patient_id
     and prog.clinic_id = v_clinic_id
     and prog.status in ('active', 'paused', 'completed');

  return jsonb_build_object(
    'ok', true,
    'firstName', v_first,
    'bookingSlug', v_slug,
    'nextVisit', v_next,
    'package', v_package,
    'programs', v_programs
  );
end;
$$;

revoke all on function public.get_public_hep_home(text, text, text) from public;
grant execute on function public.get_public_hep_home(text, text, text) to anon, authenticated;
