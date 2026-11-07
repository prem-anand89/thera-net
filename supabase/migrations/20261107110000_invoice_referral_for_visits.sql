-- The referral block (diagnosis, ICD code, referring physician, registration number) for an invoice, read on the server for
-- people who cannot read clinical notes themselves (front desk), from ALL the visits on the invoice.
--
-- Replaces the one-visit get_invoice_referral for the invoice dialog. It differs in three ways:
--   * it takes every visit on the invoice, and requires them to be one clinic and one patient;
--   * it returns the ICD code too (the old one dropped it, so a front-desk bill lost its code);
--   * it picks the note that fits the visits: a completed note written for one of them (latest visit first), else the
--     latest completed initial/follow-up note updated on or before the last visit's date, else the latest completed one
--     overall. This is the same rule as pickReferralNote in src/domain/invoiceClinical.ts.
-- A session note, a draft, or a note with no referral block is never used, and nothing but the four referral fields leaves
-- the function. get_invoice_referral stays for older app versions.

create or replace function public.get_invoice_referral_for_visits(p_visit_ids uuid[])
returns jsonb
language plpgsql stable security definer set search_path = pg_catalog, public as $$
declare
  v_clinic uuid;
  v_patient uuid;
  v_last date;
  v_groups int;
  v_ref jsonb;
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
       and n.updated_at::date <= v_last
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
