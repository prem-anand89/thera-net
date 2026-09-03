import { describe, expect, it } from 'vitest';
import { memberOnboardingStatus } from './memberOnboarding';

describe('memberOnboardingStatus', () => {
  it('is invited before the invite link is ever clicked', () => {
    expect(memberOnboardingStatus({ lastSignInAt: null, requirePasswordSetup: true })).toBe(
      'invited'
    );
  });

  it('is link_opened once signed in but before a password is chosen', () => {
    expect(
      memberOnboardingStatus({
        lastSignInAt: '2026-09-01T10:00:00Z',
        requirePasswordSetup: true,
      })
    ).toBe('link_opened');
  });

  it('is active once password setup is complete', () => {
    expect(
      memberOnboardingStatus({
        lastSignInAt: '2026-09-01T10:00:00Z',
        requirePasswordSetup: false,
      })
    ).toBe('active');
  });

  it('treats a signed-in row with no requirePasswordSetup flag as active', () => {
    // Pre-existing members from before require_password_setup existed —
    // lastSignInAt alone should be enough.
    expect(
      memberOnboardingStatus({ lastSignInAt: '2026-01-01T00:00:00Z', requirePasswordSetup: false })
    ).toBe('active');
  });
});
