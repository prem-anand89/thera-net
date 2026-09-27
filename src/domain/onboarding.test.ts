import { describe, expect, it } from 'vitest';
import { clinicNeedsOnboarding, hasPasswordIdentity } from './onboarding';

describe('onboarding helpers', () => {
  it('clinicNeedsOnboarding when onboarding_completed_at is null', () => {
    expect(clinicNeedsOnboarding({ onboardingCompletedAt: null })).toBe(true);
    expect(clinicNeedsOnboarding({ onboardingCompletedAt: '2026-01-01T00:00:00Z' })).toBe(false);
  });

  it('hasPasswordIdentity when email provider present', () => {
    expect(hasPasswordIdentity([{ provider: 'google' }])).toBe(false);
    expect(hasPasswordIdentity([{ provider: 'google' }, { provider: 'email' }])).toBe(true);
  });
});
