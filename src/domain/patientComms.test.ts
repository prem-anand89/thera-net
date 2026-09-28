import { describe, expect, it } from 'vitest';
import { assertPatientInActiveClinic, canAskForFeedbackOnVisit } from './patientComms';

describe('patientComms', () => {
  it('canAskForFeedbackOnVisit allows admin and front desk', () => {
    expect(
      canAskForFeedbackOnVisit({
        enablePatientComms: true,
        isAdmin: true,
        isFrontDesk: false,
        visitTherapistId: 't1',
      })
    ).toBe(true);
    expect(
      canAskForFeedbackOnVisit({
        enablePatientComms: true,
        isAdmin: false,
        isFrontDesk: true,
        visitTherapistId: 't1',
      })
    ).toBe(true);
  });

  it('canAskForFeedbackOnVisit allows own therapist only', () => {
    expect(
      canAskForFeedbackOnVisit({
        enablePatientComms: true,
        isAdmin: false,
        isFrontDesk: false,
        myTherapistId: 't1',
        visitTherapistId: 't1',
      })
    ).toBe(true);
    expect(
      canAskForFeedbackOnVisit({
        enablePatientComms: true,
        isAdmin: false,
        isFrontDesk: false,
        myTherapistId: 't1',
        visitTherapistId: 't2',
      })
    ).toBe(false);
  });

  it('assertPatientInActiveClinic throws on mismatch', () => {
    expect(() => assertPatientInActiveClinic('a', 'b')).toThrow(/another clinic/);
    expect(() => assertPatientInActiveClinic('a', 'a')).not.toThrow();
  });
});
