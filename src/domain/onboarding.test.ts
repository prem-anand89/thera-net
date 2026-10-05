import { describe, expect, it } from 'vitest';
import {
  clampOnboardingStep,
  clinicNeedsOnboarding,
  hasPasswordIdentity,
  isPathAllowedDuringClinicOnboarding,
  therapistNeedsProfileConfirm,
} from './onboarding';

describe('onboarding helpers', () => {
  it('clinicNeedsOnboarding when onboarding_completed_at is null', () => {
    expect(clinicNeedsOnboarding({ onboardingCompletedAt: null })).toBe(true);
    expect(clinicNeedsOnboarding({ onboardingCompletedAt: '2026-01-01T00:00:00Z' })).toBe(false);
  });

  it('hasPasswordIdentity when email provider present', () => {
    expect(hasPasswordIdentity([{ provider: 'google' }])).toBe(false);
    expect(hasPasswordIdentity([{ provider: 'google' }, { provider: 'email' }])).toBe(true);
  });

  it('isPathAllowedDuringClinicOnboarding', () => {
    expect(isPathAllowedDuringClinicOnboarding('/onboarding')).toBe(true);
    expect(isPathAllowedDuringClinicOnboarding('/onboarding/profile')).toBe(false);
    expect(isPathAllowedDuringClinicOnboarding('/workspace')).toBe(false);
    expect(isPathAllowedDuringClinicOnboarding('/f/abc')).toBe(true);
  });

  it('clampOnboardingStep respects wizard phase', () => {
    expect(clampOnboardingStep(3, 'team')).toBe(2);
    expect(clampOnboardingStep('password', 'team')).toBe(2);
    expect(clampOnboardingStep(3, 'password')).toBe('password');
    expect(clampOnboardingStep(3, 'catalog')).toBe(3);
    expect(clampOnboardingStep('password', 'catalog')).toBe(3);
  });

  it('therapistNeedsProfileConfirm when linked and not confirmed', () => {
    expect(
      therapistNeedsProfileConfirm({ userId: 'u1', profileConfirmedAt: null }, 'u1')
    ).toBe(true);
    expect(
      therapistNeedsProfileConfirm(
        { userId: 'u1', profileConfirmedAt: '2026-01-01T00:00:00Z' },
        'u1'
      )
    ).toBe(false);
    expect(therapistNeedsProfileConfirm(undefined, 'u1')).toBe(false);
  });
});

describe('clampOnboardingStep with the done step', () => {
  it('keeps the Done screen on reload once services are saved', () => {
    expect(clampOnboardingStep('done', 'done')).toBe('done');
    expect(clampOnboardingStep(2, 'done')).toBe('done');
  });

  it("doesn't reach Done before services are saved", () => {
    expect(clampOnboardingStep('done', 'catalog')).toBe(3);
    expect(clampOnboardingStep('done', 'team')).toBe(2);
  });
});
