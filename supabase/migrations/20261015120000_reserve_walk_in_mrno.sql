-- Walk-in patient IDs (W26-0001) were minted from each device's local list, so two
-- devices that were offline (or not yet synced) could mint the same one; the
-- later push then hit the unique (clinic_id, mrno) key. When online, the app now
-- reserves the number from the server instead. The reservation is persistent
-- (a per-clinic counter), so two reservations made before either patient has
-- synced still get different numbers. The offline fallback and the sync engine's
-- re-issue on collision stay as the safety net.

create table if not exists public.walk_in_mrno_counters (
  clinic_id uuid not null references public.clinics(id) on delete cascade,
  prefix text not null,
  yy text not null,
  last_seq integer not null default 0,
  primary key (clinic_id, prefix, yy)
);
alter table public.walk_in_mrno_counters enable row level security;
-- No policies: only the security-definer function below touches it.

create or replace function public.reserve_walk_in_mrno(
  p_clinic_id uuid,
  p_prefix text,
  p_yy text
) returns text
language plpgsql security definer set search_path = public as $$
declare
  v_stem text := p_prefix || p_yy || '-';
  v_max integer;
  v_seq integer;
begin
  if not is_clinic_member(p_clinic_id) then
    raise exception 'Not authorized.';
  end if;
  if p_yy !~ '^[0-9]{2}$' or length(p_prefix) not between 1 and 8 then
    raise exception 'Invalid prefix or year.';
  end if;

  -- Highest number already used by an existing patient (hidden ones included),
  -- so the counter never hands out a taken number.
  select coalesce(max(substr(mrno, length(v_stem) + 1)::integer), 0) into v_max
    from patients
    where clinic_id = p_clinic_id
      and left(mrno, length(v_stem)) = v_stem
      and substr(mrno, length(v_stem) + 1) ~ '^[0-9]+$';

  insert into walk_in_mrno_counters (clinic_id, prefix, yy, last_seq)
    values (p_clinic_id, p_prefix, p_yy, v_max + 1)
    on conflict (clinic_id, prefix, yy)
    do update set last_seq = greatest(walk_in_mrno_counters.last_seq, v_max) + 1
    returning last_seq into v_seq;

  return v_stem || lpad(v_seq::text, 4, '0');
end $$;

revoke execute on function public.reserve_walk_in_mrno(uuid, text, text) from public, anon;
grant execute on function public.reserve_walk_in_mrno(uuid, text, text) to authenticated;
