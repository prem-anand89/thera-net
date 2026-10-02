-- ---------------------------------------------------------------------------
-- Two offline-multi-device races found during a financial-correctness audit,
-- neither reachable by the single-device, normal-use flow (the client's own
-- "openPackages"/"advanceBalance" checks already prevent both there) --
-- these are server-side backstops for the case where two devices each make
-- the same commitment offline before either has seen the other's write.
-- Same reasoning as visits_enforce_plan (20260823130000_tier_enforcement_
-- phase2.sql) and the schedule overlap guard (20260930110000_schedule_
-- overlap_guards.sql): catch it at the server, fail the second writer's
-- sync rather than silently over-committing.
-- ---------------------------------------------------------------------------

-- 1. A package can't end up with more logged sessions than it was sold for.
-- Scoped to INSERT only (not UPDATE) -- this guards new-session creation,
-- the actual race; it must not fire on an unrelated edit (notes, condition)
-- to a visit that's already a legitimate member of a full package.
create or replace function public.enforce_package_session_limit()
returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_existing int;
begin
  if new.package_group_id is not null and new.package_total is not null and new.package_total > 0 then
    select count(*) into v_existing
      from visits
      where package_group_id = new.package_group_id
        and not deleted;
    if v_existing >= new.package_total then
      raise exception 'This package already has % of % sessions logged -- nothing left to add.', v_existing, new.package_total;
    end if;
  end if;
  return new;
end $$;

drop trigger if exists visits_enforce_package_limit on public.visits;
create trigger visits_enforce_package_limit
  before insert on public.visits
  for each row
  execute function public.enforce_package_session_limit();

-- 2. A patient advance can't be drawn down past its own balance. Unlike
-- recordInvoicePayment's ceiling (an in-app check against a single read),
-- this is the one check that's actually race-proof: two offline devices
-- drawing down the same advance will each pass their own local check, but
-- only the first payment row to actually reach the server can pass this
-- one -- the second's sync fails loudly (an outbox/sync error the staff
-- must resolve) instead of silently over-drawing the advance.
create or replace function public.enforce_advance_balance()
returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_advance_amount bigint;
  v_drawn_down bigint;
begin
  if new.advance_id is not null then
    select amount_paise into v_advance_amount
      from patient_advances where id = new.advance_id;
    if v_advance_amount is null then
      raise exception 'Advance not found for this payment.';
    end if;

    select coalesce(sum(amount_paise), 0) into v_drawn_down
      from payments
      where advance_id = new.advance_id and id <> new.id;

    if v_drawn_down + new.amount_paise > v_advance_amount then
      raise exception 'This payment (paise: %) would draw down more than the advance''s remaining balance (paise: % of % already used).',
        new.amount_paise, v_drawn_down, v_advance_amount;
    end if;
  end if;
  return new;
end $$;

drop trigger if exists payments_enforce_advance_balance on public.payments;
create trigger payments_enforce_advance_balance
  before insert or update of amount_paise, advance_id on public.payments
  for each row
  execute function public.enforce_advance_balance();
