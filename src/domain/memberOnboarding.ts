/**
 * Three-stage login-onboarding status for Settings → Team's Members list.
 *
 * Supabase's invite email carries a magic-link-style token — clicking it
 * IS the sign-in event (it establishes a session and sets `last_sign_in_at`
 * before the invitee has ever chosen a password). That's the only "did
 * they engage with the invite" signal available without a transactional
 * email provider's own delivery/open-tracking webhooks (Resend, Postmark,
 * SendGrid, ...) — Supabase's built-in mailer has no such tracking, so
 * there's no way to tell "sent but never opened" apart from "delivery
 * failed/bounced" short of adding a real ESP integration. `linkOpened`
 * below reports "clicked the invite link," not a literal open receipt.
 */
export type MemberOnboardingStatus = 'invited' | 'link_opened' | 'active';

export interface MemberOnboardingInput {
  /** null until the invite link is clicked (or a normal sign-in happens). */
  lastSignInAt: string | null;
  /** True from invite/resend until the invitee actually sets a password on
   *  /reset-password — see ResetPasswordPage.tsx, which clears it. */
  requirePasswordSetup: boolean;
}

export function memberOnboardingStatus({
  lastSignInAt,
  requirePasswordSetup,
}: MemberOnboardingInput): MemberOnboardingStatus {
  if (lastSignInAt == null) return 'invited';
  if (requirePasswordSetup) return 'link_opened';
  return 'active';
}

export const MEMBER_ONBOARDING_LABELS: Record<MemberOnboardingStatus, string> = {
  invited: 'Invited',
  link_opened: 'Opened invite — setting up',
  active: 'Active',
};
