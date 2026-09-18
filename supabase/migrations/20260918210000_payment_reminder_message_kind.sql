-- Adds 'payment_reminder' to message_log.kind's check constraint, for the
-- new "Remind to pay" WhatsApp action on outstanding invoices (Invoices
-- page). See src/services/whatsappBusinessService.ts's WhatsAppMessageKind
-- and supabase/functions/send-whatsapp-template/index.ts's MESSAGE_LOG_KINDS
-- for the other two places this same list is kept in sync.
alter table public.message_log
  drop constraint message_log_kind_check;

alter table public.message_log
  add constraint message_log_kind_check check (kind in (
    'feedback_request', 'booking_confirmation', 'therapist_notify',
    'google_review', 'reminder_stale_package', 'reminder_single_visit',
    'payment_reminder'
  ));
