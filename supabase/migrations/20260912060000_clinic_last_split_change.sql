-- Lets Workspace tell a therapist "your split changed on X" instead of
-- their Net figure silently moving with no explanation. Set whenever an
-- admin edits a field that feeds clinicBillingConfig()/computeVisitSplit()
-- (SettingsPage.tsx's savePartner/saveProfile splitAffected checks), right
-- alongside the existing recomputeUninvoicedSplits() catch-up.
alter table clinics
  add column last_split_change_at timestamptz null;
