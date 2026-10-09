-- ---------------------------------------------------------------------------
-- A service/package created by mistake, or long superseded, could only be
-- deactivated -- there was no delete option, even for a catalog row with
-- zero visit history. Mirrors hard_delete_therapist()'s/hard_delete_patient()'s
-- exact shape: admin-only, blocked if any visit references this item (so
-- real financial history is never at risk of being silently orphaned or
-- cascade-deleted -- visits.service_catalog_id is NOT NULL with a FK, so an
-- unchecked delete would hit a raw FK-violation error anyway; this gives a
-- friendly one instead), with a count in the exception otherwise. A service
-- with any history must still go through the existing Deactivate action.
-- ---------------------------------------------------------------------------
create or replace function public.hard_delete_catalog_item(p_item_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_clinic uuid;
  v_records int;
begin
  select clinic_id into v_clinic from service_catalog where id = p_item_id;
  if v_clinic is null then
    raise exception 'service not found';
  end if;
  if not is_clinic_admin(v_clinic) then
    raise exception 'only clinic admins can permanently delete a service';
  end if;

  select count(*) into v_records from visits where service_catalog_id = p_item_id;

  if v_records > 0 then
    raise exception 'service has % linked visit(s); deactivate instead of deleting', v_records;
  end if;

  delete from service_catalog where id = p_item_id;
end $$;

revoke execute on function public.hard_delete_catalog_item(uuid) from anon;
