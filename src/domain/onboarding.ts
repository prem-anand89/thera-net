import type { Clinic } from '@/domain/types';

/** Clinic setup wizard (steps 2–3 after create-clinic) is incomplete until marked on the server. */
export function clinicNeedsOnboarding(clinic: Pick<Clinic, 'onboardingCompletedAt'>): boolean {
  return clinic.onboardingCompletedAt == null || clinic.onboardingCompletedAt === '';
}

/** Per device — therapist confirmed invoice/roster profile after invite or admin self-link. */
export function therapistProfileOnboardingMetaKey(clinicId: string, userId: string): string {
  return `therapistProfileOnboardingDone:${clinicId}:${userId}`;
}

export function hasPasswordIdentity(
  identities: { provider: string }[] | undefined
): boolean {
  return identities?.some((i) => i.provider === 'email') ?? false;
}
