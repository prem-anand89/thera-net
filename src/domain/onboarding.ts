import type { Clinic } from '@/domain/types';

/** Clinic setup wizard (steps 2–3 after create-clinic) is incomplete until marked on the server. */
export function clinicNeedsOnboarding(clinic: Pick<Clinic, 'onboardingCompletedAt'>): boolean {
  return clinic.onboardingCompletedAt == null || clinic.onboardingCompletedAt === '';
}
