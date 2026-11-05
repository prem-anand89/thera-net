-- SQL Verification for platform_admin schema and functions.
-- Run in psql or Supabase SQL Editor as superuser / postgres.
-- Rolls back at the end so no test data remains.

begin;

-- Verify migration applies idempotently or prerequisites exist
do $$
declare
  v_clinic_id uuid;
  v_plan record;
  v_audit record;
  v_pay_id1 uuid;
  v_pay_id2 uuid;
  v_overview record;
  v_today date;
  v_locked record;
  v_err boolean;
begin
  -- Create a test clinic
  insert into public.clinics (
    name, timezone, invoice_prefix, fy_start_month
  ) values (
    'Test Platform Admin Clinic', 'Asia/Kolkata', 'TPA', 4
  ) returning id into v_clinic_id;

  v_today := platform_admin.clinic_today(v_clinic_id);

  -- 1. Check seed trigger logged audit row
  select * into v_audit from platform_admin.clinic_plans_audit
   where clinic_id = v_clinic_id and operation = 'INSERT';
  assert v_audit.id is not null, 'Expected clinic_plans_audit row on seed insert';
  assert v_audit.new_tier = 'lite', 'Expected new_tier = lite in audit';

  -- Direct update writes another audit row
  update public.clinic_plans set status = 'active' where clinic_id = v_clinic_id;
  select * into v_audit from platform_admin.clinic_plans_audit
   where clinic_id = v_clinic_id and operation = 'UPDATE'
   order by changed_at desc limit 1;
  assert v_audit.id is not null, 'Expected audit on update';

  -- 2. Upgrade: lite -> clinic (defaults 5 / null / 3)
  perform platform_admin.set_clinic_tier(v_clinic_id, 'clinic', 'active');
  select * into v_plan from public.clinic_plans where clinic_id = v_clinic_id;
  assert v_plan.plan_tier = 'clinic', 'Expected tier clinic';
  assert v_plan.max_members = 5, 'Expected 5 max_members';
  assert v_plan.visit_cap_per_month is null, 'Expected null visit_cap';
  assert v_plan.max_roster_therapists = 3, 'Expected 3 max_roster';

  -- Downgrade: clinic -> solo (real downgrade 1 / 200 / 1)
  perform platform_admin.set_clinic_tier(v_clinic_id, 'solo');
  select * into v_plan from public.clinic_plans where clinic_id = v_clinic_id;
  assert v_plan.plan_tier = 'solo', 'Expected tier solo';
  assert v_plan.max_members = 1, 'Expected 1 max_members on downgrade';
  assert v_plan.visit_cap_per_month = 200, 'Expected 200 visit_cap on downgrade';
  assert v_plan.max_roster_therapists = 1, 'Expected 1 max_roster on downgrade';

  -- 3. Custom limits preserved when p_preserve_custom_limits = true
  perform platform_admin.set_clinic_tier(v_clinic_id, 'clinic');
  update public.clinic_plans set max_roster_therapists = 100 where clinic_id = v_clinic_id;

  perform platform_admin.set_clinic_tier(v_clinic_id, 'clinic_plus', null, true);
  select * into v_plan from public.clinic_plans where clinic_id = v_clinic_id;
  assert v_plan.plan_tier = 'clinic_plus', 'Expected tier clinic_plus';
  assert v_plan.max_members = 10, 'Expected default 10 max_members';
  assert v_plan.max_roster_therapists = 100, 'Expected custom 100 max_roster preserved';

  -- When preserve = false, resets to tier default
  perform platform_admin.set_clinic_tier(v_clinic_id, 'clinic_plus', null, false);
  select * into v_plan from public.clinic_plans where clinic_id = v_clinic_id;
  assert v_plan.max_roster_therapists = 10, 'Expected reset to 10 max_roster';

  -- 4. set_clinic_tier with p_status = null leaves existing status alone
  update public.clinic_plans set status = 'read_only' where clinic_id = v_clinic_id;
  perform platform_admin.set_clinic_tier(v_clinic_id, 'solo', null);
  select * into v_plan from public.clinic_plans where clinic_id = v_clinic_id;
  assert v_plan.status = 'read_only', 'Expected status to remain read_only';

  -- 5. No payment: renewal_status = exempt_unpaid, not in renewals_due
  select * into v_overview from platform_admin.clinics_overview where clinic_id = v_clinic_id;
  assert v_overview.renewal_status = 'exempt_unpaid', 'Expected exempt_unpaid for unpaid clinic';
  assert not exists (select 1 from platform_admin.renewals_due where clinic_id = v_clinic_id), 'Unpaid clinic should not appear in renewals_due';

  -- 6. Boundary checks for renewal_status
  -- +8 -> active
  insert into platform_admin.subscription_payments (
    clinic_id, clinic_name, plan_tier, amount_paise, payment_method, paid_on, valid_until, duration_days
  ) values (
    v_clinic_id, 'Test', 'solo', 10000, 'upi', v_today, v_today + 8, 8
  );
  select * into v_overview from platform_admin.clinics_overview where clinic_id = v_clinic_id;
  assert v_overview.renewal_status = 'active', 'Expected active at +8';

  -- +7 -> renewal_due_soon
  update platform_admin.subscription_payments set valid_until = v_today + 7 where clinic_id = v_clinic_id;
  select * into v_overview from platform_admin.clinics_overview where clinic_id = v_clinic_id;
  assert v_overview.renewal_status = 'renewal_due_soon', 'Expected renewal_due_soon at +7';

  -- 0 -> renewal_due_soon
  update platform_admin.subscription_payments set valid_until = v_today where clinic_id = v_clinic_id;
  select * into v_overview from platform_admin.clinics_overview where clinic_id = v_clinic_id;
  assert v_overview.renewal_status = 'renewal_due_soon', 'Expected renewal_due_soon at 0';

  -- -1 -> in_grace_period
  update platform_admin.subscription_payments set valid_until = v_today - 1 where clinic_id = v_clinic_id;
  select * into v_overview from platform_admin.clinics_overview where clinic_id = v_clinic_id;
  assert v_overview.renewal_status = 'in_grace_period', 'Expected in_grace_period at -1';

  -- -7 -> in_grace_period
  update platform_admin.subscription_payments set valid_until = v_today - 7 where clinic_id = v_clinic_id;
  select * into v_overview from platform_admin.clinics_overview where clinic_id = v_clinic_id;
  assert v_overview.renewal_status = 'in_grace_period', 'Expected in_grace_period at -7';

  -- -8 -> overdue
  update platform_admin.subscription_payments set valid_until = v_today - 8 where clinic_id = v_clinic_id;
  select * into v_overview from platform_admin.clinics_overview where clinic_id = v_clinic_id;
  assert v_overview.renewal_status = 'overdue', 'Expected overdue at -8';

  -- 7. lock_overdue_clinics() at -8
  update public.clinic_plans set status = 'active' where clinic_id = v_clinic_id;
  select * into v_locked from platform_admin.lock_overdue_clinics(true) where clinic_id = v_clinic_id;
  assert v_locked.locked = false, 'Dry run should not lock';
  select status into v_plan from public.clinic_plans where clinic_id = v_clinic_id;
  assert v_plan.status = 'active', 'Plan status should stay active after dry run';

  select * into v_locked from platform_admin.lock_overdue_clinics(false) where clinic_id = v_clinic_id;
  assert v_locked.locked = true, 'Live run should lock';
  select status into v_plan from public.clinic_plans where clinic_id = v_clinic_id;
  assert v_plan.status = 'read_only', 'Plan status should become read_only';

  -- Clean payments for next test
  delete from platform_admin.subscription_payments where clinic_id = v_clinic_id;

  -- 8. record_subscription_payment sets active and extends
  v_pay_id1 := platform_admin.record_subscription_payment(v_clinic_id, 'clinic', 50000, 'upi', 'REF1', 30, 'First payment');
  select * into v_plan from public.clinic_plans where clinic_id = v_clinic_id;
  assert v_plan.status = 'active', 'record_subscription_payment should activate';
  assert v_plan.plan_tier = 'clinic', 'record_subscription_payment should set tier';

  -- Second payment extends
  v_pay_id2 := platform_admin.record_subscription_payment(v_clinic_id, 'clinic', 50000, 'upi', 'REF2', 30, 'Extension');
  select valid_until into v_overview from platform_admin.subscription_payments where id = v_pay_id2;
  assert v_overview.valid_until = v_today + 60, 'Second payment should extend from first validity (+60)';

  -- Duration 0 raises
  v_err := false;
  begin
    perform platform_admin.record_subscription_payment(v_clinic_id, 'clinic', 50000, 'upi', 'REF3', 0);
  exception when others then
    v_err := true;
  end;
  assert v_err, 'Duration <= 0 must raise error';

  -- 9. Voiding payment
  v_err := false;
  begin
    perform platform_admin.void_subscription_payment(v_pay_id2, '');
  exception when others then
    v_err := true;
  end;
  assert v_err, 'Voiding without reason must raise';

  perform platform_admin.void_subscription_payment(v_pay_id2, 'Customer refund');
  select max(valid_until) into v_today from platform_admin.subscription_payments where clinic_id = v_clinic_id and voided_at is null;
  assert v_today = (platform_admin.clinic_today(v_clinic_id) + 30), 'Valid until should fall back to first payment';

  -- 10. Deleting clinic leaves payments
  delete from public.clinics where id = v_clinic_id;
  assert exists (select 1 from platform_admin.subscription_payments where clinic_id = v_clinic_id), 'Payments must survive clinic deletion';
  delete from platform_admin.subscription_payments where clinic_id = v_clinic_id;
  delete from platform_admin.clinic_plans_audit where clinic_id = v_clinic_id;
end $$;

-- 11. Privilege checks for authenticated role
set local role authenticated;
do $$
declare
  v_err boolean := false;
begin
  begin
    perform * from platform_admin.clinics_overview;
  exception when insufficient_privilege then
    v_err := true;
  end;
  assert v_err, 'authenticated role must not select from platform_admin.clinics_overview';
end $$;

reset role;

rollback;
