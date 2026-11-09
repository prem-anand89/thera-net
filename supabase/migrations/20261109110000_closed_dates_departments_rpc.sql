-- Accept optional departments filter on clinic closures
create or replace function public.set_clinic_closed_dates(
  p_clinic_id uuid,
  p_from date,
  p_to date,
  p_label text default null,
  p_departments text[] default null
) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not (is_clinic_admin(p_clinic_id) or is_front_desk(p_clinic_id)) then
    raise exception 'Not authorized.';
  end if;
  if p_from is null or p_to is null or p_to < p_from then
    raise exception 'Choose a valid date range.';
  end if;
  if p_to - p_from > 366 then
    raise exception 'A closure can be at most one year long.';
  end if;

  insert into clinic_closed_dates (clinic_id, closed_date, label, departments)
    select p_clinic_id, d::date, nullif(trim(coalesce(p_label, '')), ''), p_departments
    from generate_series(p_from, p_to, interval '1 day') d
  on conflict (clinic_id, closed_date) do update
    set label = excluded.label, departments = excluded.departments, removed_at = null;
end $$;

revoke execute on function public.set_clinic_closed_dates(uuid, date, date, text, text[]) from public, anon;
grant execute on function public.set_clinic_closed_dates(uuid, date, date, text, text[]) to authenticated;
