import { describe, expect, it } from 'vitest';
import { isNewVisitDirty, type NewVisitDirtyInput } from './NewVisitPage';
import type { Patient } from '@/domain/types';

const dummyPatient: Patient = {
  id: 'p1',
  clinicId: 'c1',
  name: 'John Doe',
  mrno: 'MR101',
  mrnoSource: 'auto',
  age: 30,
  sex: 'M',
  phone: '9876543210',
  primaryCondition: 'Knee pain',
  updatedAt: '2026-01-01',
};

function baseInput(overrides: Partial<NewVisitDirtyInput> = {}): NewVisitDirtyInput {
  return {
    justSaved: false,
    rows: [{ key: 'r1', assistingTherapistId: null }],
    patient: null,
    hasPrefillPatient: false,
    creatingPatient: false,
    newPatientName: '',
    condition: '',
    notes: '',
    pendingNote: '',
    treatmentIds: [],
    adjustmentMode: 'none',
    ...overrides,
  };
}

describe('isNewVisitDirty', () => {
  it('returns false for an untouched form', () => {
    expect(isNewVisitDirty(baseInput())).toBe(false);
  });

  it('returns true when a service is chosen', () => {
    expect(
      isNewVisitDirty(
        baseInput({
          rows: [{ key: 'r1', serviceCatalogId: 's1', assistingTherapistId: null }],
        })
      )
    ).toBe(true);
  });

  it('returns false when patient was prefilled via ?patientId or ?repeatVisitId and nothing else was edited', () => {
    expect(
      isNewVisitDirty(
        baseInput({
          patient: dummyPatient,
          hasPrefillPatient: true,
          condition: 'Knee pain', // carried over from patient primaryCondition
        })
      )
    ).toBe(false);
  });

  it('returns true when a patient was manually selected in this session', () => {
    expect(
      isNewVisitDirty(
        baseInput({
          patient: dummyPatient,
          hasPrefillPatient: false,
        })
      )
    ).toBe(true);
  });

  it('returns false once saved (justSaved is true)', () => {
    expect(
      isNewVisitDirty(
        baseInput({
          justSaved: true,
          patient: dummyPatient,
          rows: [{ key: 'r1', serviceCatalogId: 's1', assistingTherapistId: null }],
          condition: 'Knee pain',
        })
      )
    ).toBe(false);
  });

  it('returns true when clinical notes or pending payment note has text', () => {
    expect(isNewVisitDirty(baseInput({ notes: 'Follow up in 3 days' }))).toBe(true);
    expect(isNewVisitDirty(baseInput({ pendingNote: 'Will pay tomorrow' }))).toBe(true);
  });

  it('returns true when treatments or adjustments are selected', () => {
    expect(isNewVisitDirty(baseInput({ treatmentIds: ['t1'] }))).toBe(true);
    expect(isNewVisitDirty(baseInput({ adjustmentMode: 'discount' }))).toBe(true);
    expect(isNewVisitDirty(baseInput({ adjustmentMode: 'extra' }))).toBe(true);
  });

  it('returns true when staff started creating a new patient with a name', () => {
    expect(
      isNewVisitDirty(
        baseInput({
          creatingPatient: true,
          newPatientName: 'Alice',
        })
      )
    ).toBe(true);
    expect(
      isNewVisitDirty(
        baseInput({
          creatingPatient: true,
          newPatientName: '   ',
        })
      )
    ).toBe(false);
  });
});
