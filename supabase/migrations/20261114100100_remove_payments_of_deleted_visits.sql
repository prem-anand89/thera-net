-- One-time cleanup for the same bug: payments still recorded against visits that were already deleted.
-- Apply AFTER 20261114100000_visit_delete_removes_payments.sql. Each removed row is kept in audit_log (old_data) by
-- payments_audit, and payments_tombstone makes every device drop its copy on the next sync.
--
-- Before applying, list what it will remove (on 14 Nov 2026 this was 8 rows of ₹1,500 UPI in two clinics):
--   select c.name, p.received_date, p.method, p.amount_paise
--   from payments p join visits v on v.id = p.visit_id join clinics c on c.id = p.clinic_id
--   where v.deleted order by p.received_date;
delete from public.payments p
using public.visits v
where v.id = p.visit_id
  and v.deleted;
