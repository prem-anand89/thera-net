import type { UUID } from '@/domain/types';

/** Mirrors `feedback_requests_insert` RLS: admin, front desk, or the visit's therapist. */
export function canAskForFeedbackOnVisit(params: {
  enablePatientComms: boolean;
  isAdmin: boolean;
  isFrontDesk: boolean;
  myTherapistId?: UUID | null;
  visitTherapistId: UUID;
}): boolean {
  if (!params.enablePatientComms) return false;
  if (params.isAdmin || params.isFrontDesk) return true;
  return params.myTherapistId != null && params.visitTherapistId === params.myTherapistId;
}

export function assertPatientInActiveClinic(
  patientClinicId: UUID,
  activeClinicId: UUID
): void {
  if (patientClinicId !== activeClinicId) {
    throw new Error(
      'This patient belongs to another clinic. Switch to that clinic in the account menu and try again.'
    );
  }
}
