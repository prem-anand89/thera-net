import type { Clinic, Therapist } from '@/domain/types';

/** Clinic setup wizard (steps 2–3 after create-clinic) is incomplete until marked on the server. */
export function clinicNeedsOnboarding(clinic: Pick<Clinic, 'onboardingCompletedAt'>): boolean {
  return clinic.onboardingCompletedAt == null || clinic.onboardingCompletedAt === '';
}

export function hasPasswordIdentity(
  identities: { provider: string }[] | undefined
): boolean {
  return identities?.some((i) => i.provider === 'email') ?? false;
}

/** Routes still reachable while clinic onboarding is incomplete (admin). */
export function isPathAllowedDuringClinicOnboarding(pathname: string): boolean {
  if (pathname === '/reset-password') return true;
  // Wizard only — roster profile comes after clinic onboarding is complete.
  if (pathname === '/onboarding') return true;
  if (pathname.startsWith('/f/')) return true;
  if (pathname.startsWith('/book/')) return true;
  return false;
}

export type OnboardingWizardPhase = 'team' | 'password' | 'catalog';

export type OnboardingWizardStep = 2 | 3 | 'password';

/** Clamp deep-linked wizard steps to the furthest phase the user has reached. */
export function clampOnboardingStep(
  requested: OnboardingWizardStep,
  phase: OnboardingWizardPhase
): OnboardingWizardStep {
  if (phase === 'team') return 2;
  if (phase === 'password') {
    if (requested === 3) return 'password';
    return requested === 'password' ? 'password' : 2;
  }
  if (requested === 'password') return 3;
  return requested;
}

export function therapistNeedsProfileConfirm(
  therapist: Pick<Therapist, 'userId' | 'profileConfirmedAt'> | undefined,
  userId: string | undefined
): boolean {
  if (!therapist || !userId || therapist.userId !== userId) return false;
  return therapist.profileConfirmedAt == null || therapist.profileConfirmedAt === '';
}
