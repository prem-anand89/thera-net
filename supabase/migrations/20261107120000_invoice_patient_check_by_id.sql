-- Three corrections to the invoice checks of 20261107100000 and 20261107110000.
--
-- 1. An invoice's patient was checked by comparing the Patient ID (mrno) on its snapshot with the patient's current one. The
--    Patient ID can be edited, and an amendment resends the original bill's frozen snapshot, so any bill whose patient's ID had
--    changed could never be amended (two live bills were in that state), and issuing failed while an ID edit was still syncing.
--    Now the permanent id decides:
--      * an amendment's visits must belong to the patient the original bill's visits belong to;
--      * a snapshot carrying `patientId` (the app now sends it) must name the visits' patient;
--      * only a call with neither (an older app version issuing) still compares the Patient ID.
--    check_invoice_matches_visits gains a parameter; issue_invoice does not change, and resolves to it through the default.
--
-- 2. Nobody but the two definer functions needs the check: service_role loses its execute too.
--
-- 3. get_invoice_referral_for_visits decided "on or before the last visit" with the note's date in the server's zone (UTC),
--    against a visit date that is the clinic's. It now uses the clinic's zone, as pickReferralNote does.

drop function public.check_invoice_matches_visits(uuid, uuid[], bigint, jsonb, jsonb);

create function public.check_invoice_matches_visits(
  p_clinic_id uuid,
  p_visit_ids uuid[],
  p_total_paise bigint,
  p_line_items jsonb,
  p_patient_snapshot jsonb,
  p_original_patient_id uuid default null
) returns void
language plpgsql stable security definer set search_path = pg_catalog, public as $$
declare
  v_visits int;
  v_patients int;
  v_patient uuid;
  v_bills bigint;
  v_lines bigint;
begin
  select count(*), count(distinct patient_id), (array_agg(patient_id))[1], coalesce(sum(actual_bill_paise), 0)
    into v_visits, v_patients, v_patient, v_bills
    from visits
   where id = any (coalesce(p_visit_ids, '{}')) and clinic_id = p_clinic_id and not deleted;

  if v_visits = 0 then
    raise exception 'No visits on this invoice';
  end if;
  if v_patients <> 1 then
    raise exception 'All visits on one invoice must belong to the same patient';
  end if;

  if p_original_patient_id is not null and p_original_patient_id <> v_patient then
    raise exception 'The patient on this invoice does not match its visits';
  end if;
  if p_patient_snapshot ? 'patientId' then
    if p_patient_snapshot ->> 'patientId' is distinct from v_patient::text then
      raise exception 'The patient on this invoice does not match its visits';
    end if;
  elsif p_original_patient_id is null then
    if p_patient_snapshot ->> 'mrno' is distinct from (select p.mrno from patients p where p.id = v_patient) then
      raise exception 'The patient on this invoice does not match its visits';
    end if;
  end if;

  if p_total_paise <= 0 then
    raise exception 'Nothing to bill: these visits have no charge';
  end if;
  if p_total_paise <> v_bills then
    raise exception 'The invoice total does not match the visits'' bills';
  end if;

  select coalesce(sum((l ->> 'totalPaise')::bigint), 0) into v_lines
    from jsonb_array_elements(coalesce(p_line_items, '[]'::jsonb)) l;
  if v_lines <> p_total_paise then
    raise exception 'The invoice lines do not add up to its total';
  end if;
end $$;

revoke all on function public.check_invoice_matches_visits(uuid, uuid[], bigint, jsonb, jsonb, uuid)
  from public, anon, authenticated, service_role;

create or replace function public.amend_invoice(
  p_original_invoice_id uuid,
  p_clinic_id uuid,
  p_fy_label text,
  p_patient_snapshot jsonb,
  p_line_items jsonb,
  p_total_paise bigint,
  p_payment_mode text,
  p_therapist_id uuid,
  p_visit_ids uuid[],
  p_clinical_snapshot jsonb default null
)
 returns invoices
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_seq int;
  v_prefix text;
  v_billing_enabled boolean;
  v_invoicing_access text;
  v_caller_role text;
  v_invoice public.invoices;
  v_stamped int;
  v_original_clinic_id uuid;
  v_original_patient uuid;
begin
  if not is_clinic_member(p_clinic_id) then
    raise exception 'not a member of this clinic';
  end if;

  select clinic_id into v_original_clinic_id from invoices where id = p_original_invoice_id;
  if v_original_clinic_id is null or v_original_clinic_id <> p_clinic_id then
    raise exception 'original invoice not found for this clinic';
  end if;

  if not coalesce(
    (select entitled from clinic_entitlements
     where clinic_id = p_clinic_id and module_key = 'invoicing'),
    true
  ) then
    raise exception 'clinic is not entitled to invoicing';
  end if;

  select invoice_prefix, billing_enabled, invoicing_access
    into v_prefix, v_billing_enabled, v_invoicing_access
    from clinics where id = p_clinic_id;

  if not v_billing_enabled then
    raise exception 'billing is turned off for this clinic';
  end if;

  if v_invoicing_access = 'billing_staff' then
    select role into v_caller_role from clinic_members
      where clinic_id = p_clinic_id and user_id = auth.uid();
    if v_caller_role not in ('admin', 'front_desk') then
      raise exception 'only front desk or an admin can issue invoices at this clinic';
    end if;
  end if;

  insert into invoice_counters (clinic_id, fy_label)
  values (p_clinic_id, p_fy_label)
  on conflict (clinic_id, fy_label) do nothing;

  update invoice_counters
  set next_seq = next_seq + 1
  where clinic_id = p_clinic_id and fy_label = p_fy_label
  returning next_seq - 1 into v_seq;

  insert into invoices (
    clinic_id, invoice_no, fy_label, seq, patient_snapshot, line_items,
    total_paise, payment_mode, therapist_id, supersedes_invoice_id, clinical_snapshot
  ) values (
    p_clinic_id,
    v_prefix || '/' || p_fy_label || '/' || lpad(v_seq::text, 4, '0'),
    p_fy_label, v_seq, p_patient_snapshot, p_line_items,
    p_total_paise, p_payment_mode, p_therapist_id, p_original_invoice_id, p_clinical_snapshot
  ) returning * into v_invoice;

  -- Read before the visits are re-pointed: this is who the bill being amended was for.
  select patient_id into v_original_patient
    from visits
   where invoice_id = p_original_invoice_id and clinic_id = p_clinic_id
   limit 1;

  perform set_config('app.allow_invoice_amendment', 'true', true);
  update visits
  set invoice_id = v_invoice.id
  where id = any (p_visit_ids)
    and clinic_id = p_clinic_id
    and (invoice_id is null or invoice_id = p_original_invoice_id)
    and not deleted;
  get diagnostics v_stamped = row_count;
  if v_stamped <> coalesce(array_length(p_visit_ids, 1), 0) then
    raise exception 'one or more visits are missing, deleted, or invoiced elsewhere';
  end if;

  perform public.check_invoice_matches_visits(
    p_clinic_id, p_visit_ids, p_total_paise, p_line_items, p_patient_snapshot, v_original_patient
  );

  return v_invoice;
end $function$;

create or replace function public.get_invoice_referral_for_visits(p_visit_ids uuid[])
returns jsonb
language plpgsql stable security definer set search_path = pg_catalog, public as $$
declare
  v_clinic uuid;
  v_patient uuid;
  v_last date;
  v_groups int;
  v_ref jsonb;
  v_zone text;
begin
  select count(*) into v_groups from (
    select distinct clinic_id, patient_id from visits where id = any (coalesce(p_visit_ids, '{}')) and not deleted
  ) g;
  if v_groups <> 1 then
    return null;
  end if;

  select clinic_id, patient_id, max(visit_date) into v_clinic, v_patient, v_last
    from visits
   where id = any (p_visit_ids) and not deleted
   group by clinic_id, patient_id;

  if not is_clinic_member(v_clinic) then
    return null;
  end if;

  select coalesce(timezone, 'Asia/Kolkata') into v_zone from clinics where id = v_clinic;

  select n.assessment_payload -> 'referral' into v_ref
    from consultation_notes n
    join visits v on v.id = n.visit_id
   where n.visit_id = any (p_visit_ids) and n.clinic_id = v_clinic
     and n.status = 'completed' and n.note_mode <> 'session' and n.assessment_payload ? 'referral'
   order by v.visit_date desc, n.updated_at desc
   limit 1;

  if v_ref is null then
    select n.assessment_payload -> 'referral' into v_ref
      from consultation_notes n
     where n.patient_id = v_patient and n.clinic_id = v_clinic
       and n.status = 'completed' and n.note_mode in ('initial', 'followup') and n.assessment_payload ? 'referral'
       and (n.updated_at at time zone v_zone)::date <= v_last
     order by n.updated_at desc
     limit 1;
  end if;

  if v_ref is null then
    select n.assessment_payload -> 'referral' into v_ref
      from consultation_notes n
     where n.patient_id = v_patient and n.clinic_id = v_clinic
       and n.status = 'completed' and n.note_mode in ('initial', 'followup') and n.assessment_payload ? 'referral'
     order by n.updated_at desc
     limit 1;
  end if;

  if v_ref is null then
    return null;
  end if;
  return jsonb_build_object(
    'diagnosis', v_ref -> 'diagnosis',
    'diagnosisIcdCode', v_ref -> 'diagnosisIcdCode',
    'referringPhysician', v_ref -> 'referringPhysician',
    'physicianRegistrationNo', v_ref -> 'physicianRegistrationNo'
  );
end $$;

revoke execute on function public.get_invoice_referral_for_visits(uuid[]) from public, anon;
grant execute on function public.get_invoice_referral_for_visits(uuid[]) to authenticated;
