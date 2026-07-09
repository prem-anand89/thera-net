-- ---------------------------------------------------------------------------
-- RLS/security review follow-up: issue_invoice() is SECURITY DEFINER but,
-- unlike hard_delete_patient() and admin_wipe_clinic_data(), never had its
-- EXECUTE privilege explicitly revoked from anon. It already refuses
-- unauthenticated callers via its own is_clinic_member() check (auth.uid()
-- is null for anon, so the check fails), so this is defense-in-depth only —
-- no behavior change for real (authenticated) callers.
-- ---------------------------------------------------------------------------
revoke execute on function public.issue_invoice(uuid, text, jsonb, jsonb, bigint, text, uuid, uuid[]) from anon;
