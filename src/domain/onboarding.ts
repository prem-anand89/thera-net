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

export type OnboardingWizardPhase = 'team' | 'password' | 'catalog' | 'done';

export type OnboardingWizardStep = 2 | 3 | 'password' | 'done';

/** Clamp deep-linked wizard steps to the furthest phase the user has reached.
 *  'done' is only reachable after the services step has been saved. */
export function clampOnboardingStep(
  requested: OnboardingWizardStep,
  phase: OnboardingWizardPhase
): OnboardingWizardStep {
  if (phase === 'done') return 'done';
  const wanted = requested === 'done' ? 3 : requested;
  if (phase === 'team') return 2;
  if (phase === 'password') {
    if (wanted === 3) return 'password';
    return wanted === 'password' ? 'password' : 2;
  }
  if (wanted === 'password') return 3;
  return wanted;
}

export function therapistNeedsProfileConfirm(
  therapist: Pick<Therapist, 'userId' | 'profileConfirmedAt'> | undefined,
  userId: string | undefined
): boolean {
  if (!therapist || !userId || therapist.userId !== userId) return false;
  return therapist.profileConfirmedAt == null || therapist.profileConfirmedAt === '';
}
