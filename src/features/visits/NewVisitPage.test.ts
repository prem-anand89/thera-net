import { describe, expect, it } from 'vitest';
import { isNewVisitDirty, newVisitSignature, type NewVisitSignatureInput } from './NewVisitPage';

function input(over: Partial<NewVisitSignatureInput> = {}): NewVisitSignatureInput {
  return {
    rows: [{ key: 'r1', assistingTherapistId: null }],
    patientId: null,
    creatingPatient: false,
    newPatientName: '',
    condition: '',
    notes: '',
    pendingNote: '',
    treatmentIds: [],
    adjustmentMode: 'none',
    ...over,
  };
}

const sig = (over: Partial<NewVisitSignatureInput> = {}) => newVisitSignature(input(over));

/** What the page does: baseline = the signature before the first touch; then compare. */
function dirty(baseline: string, now: string, touched = true, justSaved = false) {
  return isNewVisitDirty({ justSaved, touched, signature: now, baseline });
}

describe('isNewVisitDirty', () => {
  it('an untouched form is never dirty, even if the page filled things in', () => {
    const start = sig();
    const prefilled = sig({
      patientId: 'p1',
      condition: 'Knee pain',
      rows: [{ key: 'r1', continuation: { packageGroupId: 'g1' } as never, assistingTherapistId: null }],
    });
    expect(dirty(start, prefilled, false)).toBe(false);
  });

  it('a touched form that still equals its prefilled start is not dirty (open from a patient / appointment, then Cancel)', () => {
    const prefilled = sig({ patientId: 'p1', treatmentIds: ['t1'], creatingPatient: true, newPatientName: 'Asha' });
    expect(dirty(prefilled, prefilled)).toBe(false);
  });

  it('is dirty once something differs from the start', () => {
    const start = sig({ patientId: 'p1' });
    expect(dirty(start, sig({ patientId: 'p1', rows: [{ key: 'r', serviceCatalogId: 's1', assistingTherapistId: null }] }))).toBe(true);
    expect(dirty(start, sig({ patientId: 'p2' }))).toBe(true);
    expect(dirty(start, sig({ patientId: 'p1', notes: 'Follow up' }))).toBe(true);
    expect(dirty(start, sig({ patientId: 'p1', pendingNote: 'Pays tomorrow' }))).toBe(true);
    expect(dirty(start, sig({ patientId: 'p1', treatmentIds: ['t1'] }))).toBe(true);
    expect(dirty(start, sig({ patientId: 'p1', adjustmentMode: 'discount' }))).toBe(true);
  });

  it('typing and then undoing is not dirty; whitespace is ignored; treatment order does not matter', () => {
    const start = sig({ treatmentIds: ['a', 'b'] });
    expect(dirty(start, sig({ treatmentIds: ['b', 'a'], notes: '   ' }))).toBe(false);
  });

  it('a new patient being typed counts, an empty name does not', () => {
    expect(dirty(sig(), sig({ creatingPatient: true, newPatientName: 'Alice' }))).toBe(true);
    expect(dirty(sig(), sig({ creatingPatient: true, newPatientName: '   ' }))).toBe(false);
  });

  it('is never dirty once the visit is saved', () => {
    expect(dirty(sig(), sig({ notes: 'x' }), true, true)).toBe(false);
  });
});
