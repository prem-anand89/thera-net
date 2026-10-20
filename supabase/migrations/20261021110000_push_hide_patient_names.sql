-- "Hide patient names in notifications": one more per-person push switch. Unlike the alerts it is OFF by
-- default (a row with enabled = true means "hide"), so existing people keep seeing names until they choose.
-- send-push reads it before building each notification; the table's own rules are unchanged.

alter table public.user_push_preferences drop constraint if exists user_push_preferences_category_check;
alter table public.user_push_preferences
  add constraint user_push_preferences_category_check
  check (category in ('booking_request', 'appointment_changes', 'low_rating_feedback', 'hide_patient_names'));
