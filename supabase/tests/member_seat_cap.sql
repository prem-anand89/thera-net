-- Checks for the login-seat trigger on clinic_members. Runs entirely in a transaction that is rolled back: nothing is kept.
-- Uses the "demo clinic" (change the id in `cfg` to use another). Every row's `ok` must be true.
begin;

create temp table cfg as select
  'f3919f75-815d-4f59-9bda-89bbceb2dbd2'::uuid as clinic_id,
  (select id from auth.users where id not in (select user_id from public.clinic_members) order by id limit 1) as outsider_a,
  (select id from auth.users where id not in (select user_id from public.clinic_members) order by id offset 1 limit 1) as outsider_b;

create temp table res (n serial, name text, expected text, got text, ok boolean);

create function pg_temp.attempt(p_name text, p_expected text, p_sql text) returns void language plpgsql as $$
declare v_got text;
begin
  begin
    execute p_sql;
    v_got := 'ok';
  exception when others then
    v_got := sqlerrm;
  end;
  insert into res (name, expected, got, ok)
    values (p_name, p_expected, v_got, case when p_expected = 'ok' then v_got = 'ok' else position(p_expected in v_got) > 0 end);
end $$;

create function pg_temp.add_member(p_user text) returns text language sql as $$
  select format($f$insert into public.clinic_members (clinic_id, user_id, role) select clinic_id, %s, 'therapist' from cfg$f$, p_user)
$$;

-- demo clinic: Lite, one seat, and already two members (over its limit)
select pg_temp.attempt('at or over the limit, a new login is refused', 'allows up to 1 team login', pg_temp.add_member('(select outsider_a from cfg)'));

update public.clinic_plans set max_members = 3 where clinic_id = (select clinic_id from cfg);
select pg_temp.attempt('under the limit, a new login is allowed', 'ok', pg_temp.add_member('(select outsider_a from cfg)'));
select pg_temp.attempt('now at the limit (3 of 3), the next is refused', 'allows up to 3 team logins', pg_temp.add_member('(select outsider_b from cfg)'));
select pg_temp.attempt('a row that already exists passes at the limit (re-link / upsert)',
  'ok', $q$insert into public.clinic_members (clinic_id, user_id, role) select clinic_id, outsider_a, 'therapist' from cfg on conflict do nothing$q$);

update public.platform_config set tier_enforcement_enabled = false;
select pg_temp.attempt('with the pilot switch off, nothing is enforced', 'ok', pg_temp.add_member('(select outsider_b from cfg)'));
update public.platform_config set tier_enforcement_enabled = true;

delete from public.clinic_members where user_id = (select outsider_b from cfg) and clinic_id = (select clinic_id from cfg);
delete from public.clinic_plans where clinic_id = (select clinic_id from cfg);
select pg_temp.attempt('a clinic with no plan row is not locked out', 'ok', pg_temp.add_member('(select outsider_b from cfg)'));

do $$ begin raise exception 'RESULTS %', (select json_agg(json_build_object('n', n, 'name', name, 'ok', ok, 'got', case when ok then null else got end) order by n) from res); end $$;
rollback;
