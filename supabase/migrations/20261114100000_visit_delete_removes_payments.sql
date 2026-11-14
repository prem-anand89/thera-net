-- Deleting a visit removes the payments recorded against it.
--
-- A visit is soft-deleted (visits.deleted = true) but `payments` has no deleted flag, so the money recorded on a
-- deleted visit stayed behind and kept counting in the Daybook, the collected tiles and the reports. Typical case:
-- a visit saved as "collected" that should have been "pay later" is deleted and redone, and the first collection
-- stays on the books as well as the second.
--
-- Deleting the rows (rather than adding a flag) keeps every existing total correct without touching each place that
-- sums payments. Nothing is lost: payments_audit stores the removed row in audit_log (old_data), and payments_tombstone
-- tells the other devices to drop their copy. A payment drawn from an advance goes too, which frees that advance's
-- balance again (the balance guard only runs on insert/update). Only a visit that is not on an invoice can be deleted
-- (visits_protect_invoiced), so no invoiced money is touched.
create or replace function public.remove_payments_of_deleted_visit() returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  delete from public.payments where visit_id = new.id;
  return new;
end $$;

drop trigger if exists visits_remove_payments on public.visits;
create trigger visits_remove_payments
  after update of deleted on public.visits
  for each row
  when (new.deleted and not old.deleted)
  execute function public.remove_payments_of_deleted_visit();

-- Check (inside begin; ... rollback;): update visits set deleted = true where id = '<a visit with a payment>';
--   select count(*) from payments where visit_id = '<that visit>';   -- 0
--   select action, old_data->>'amount_paise' from audit_log where table_name = 'payments' order by changed_at desc limit 1;  -- delete, 150000
