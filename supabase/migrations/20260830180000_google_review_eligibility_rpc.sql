-- ---------------------------------------------------------------------------
-- Patient Communications: front-desk Google-review-nudge parity.
--
-- feedback_responses_select is deliberately is_clinic_admin()-only (see
-- 20260830120000_patient_comms_foundation.sql) — front desk and therapists
-- get zero visibility into ratings/comments, full stop, by explicit product
-- decision. But HANDOFF-patient-comms.md's role table says front_desk
-- should still be able to send the "Ask for a Google review" nudge on a
-- 4-5* response from the visit row — they just never get to see the rating
-- itself. Slice 3 only wired the nudge for admins, who get `rating` for
-- free via the synced, RLS-filtered feedback_responses table; front_desk's
-- local Dexie never receives that table at all, so the nudge silently never
-- appeared for them. This closes that gap with a role-blind eligibility
-- check: any clinic member can ask "which requests currently qualify",
-- getting back request_ids only — never a rating value, never a comment.
--
-- security definer (unlike rotate_feedback_request_token, which stays
-- invoker): this function's entire point is to answer a question RLS
-- itself refuses to answer for a front_desk caller, so it must bypass RLS
-- deliberately and re-implement its own narrower check in the body instead
-- — a plain membership check, not "is this the visit's own therapist" or
-- any other row-scoped rule, since eligibility here carries no clinical
-- detail worth restricting further.
-- ---------------------------------------------------------------------------
create or replace function public.list_google_review_eligible_requests(p_clinic_id uuid)
returns setof uuid
language plpgsql stable security definer set search_path = public as $$
begin
  if not is_clinic_member(p_clinic_id) then
    raise exception 'not authorized';
  end if;
  return query
    select request_id from feedback_responses
    where clinic_id = p_clinic_id and rating >= 4;
end $$;

-- Same explicit revoke-then-grant discipline as rotate_feedback_request_token:
-- Postgres auto-grants EXECUTE on new public-schema functions to `public`
-- (the pseudo-role every real role inherits from) AND separately to
-- anon/authenticated directly at creation time — two distinct mechanisms,
-- so revoking only one leaves the other standing. This function is
-- authenticated-staff-only (an anon caller has no auth.uid(), so
-- is_clinic_member() would reject it anyway, but explicit beats relying on
-- that incidentally working).
revoke execute on function public.list_google_review_eligible_requests(uuid) from public, anon;
grant execute on function public.list_google_review_eligible_requests(uuid) to authenticated;
