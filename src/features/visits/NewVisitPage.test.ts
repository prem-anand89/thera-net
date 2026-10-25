import { describe, expect, it } from 'vitest';
import {
  formatPatientSearchResultSubtitle,
  isNewVisitDirty,
  paymentStillDue,
  newVisitSignature,
  type NewVisitSignatureInput,
} from './NewVisitPage';

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

describe('formatPatientSearchResultSubtitle', () => {
  it('masks phone to last 4 digits and includes age', () => {
    expect(
      formatPatientSearchResultSubtitle({
        phone: '9876543210',
        age: 34,
      })
    ).toBe('••••3210 · 34y');
  });

  it('masks formatted phone properly', () => {
    expect(
      formatPatientSearchResultSubtitle({
        phone: '+91 98765-44821',
        age: 25,
      })
    ).toBe('••••4821 · 25y');
  });

  it('handles missing phone with age present', () => {
    expect(
      formatPatientSearchResultSubtitle({
        phone: null,
        age: 34,
      })
    ).toBe('34y');
  });

  it('handles missing age with phone present', () => {
    expect(
      formatPatientSearchResultSubtitle({
        phone: '9876543210',
        age: null,
      })
    ).toBe('••••3210');
  });

  it('returns empty string when both phone and age are missing', () => {
    expect(
      formatPatientSearchResultSubtitle({
        phone: null,
        age: null,
      })
    ).toBe('');
    expect(
      formatPatientSearchResultSubtitle({
        phone: '',
        age: null,
      })
    ).toBe('');
  });

  it('preserves short phone if fewer than 4 digits', () => {
    expect(
      formatPatientSearchResultSubtitle({
        phone: '123',
        age: null,
      })
    ).toBe('123');
  });
});


describe('saveSummary (both save bars)', () => {
  it('names the services and the payment choice', async () => {
    const { saveSummary } = await import('./VisitSaveBar');
    expect(saveSummary(0, { kind: 'now', methodLabel: 'UPI' })).toBe('');
    expect(saveSummary(1, { kind: 'now', methodLabel: 'UPI' })).toBe('1 service · UPI, collected now');
    expect(saveSummary(2, { kind: 'later' })).toBe('2 services · to collect later');
    expect(saveSummary(2, { kind: 'none' })).toBe('2 services');
  });
});

describe('paymentStillDue (the saved screen)', () => {
  const base = { canCollect: true, alreadyCollected: false, billPaise: 200000, receivedPaise: 0 };
  it('is nothing for a visit collected on the form, even before the payments have loaded', () => {
    expect(paymentStillDue({ ...base, alreadyCollected: true })).toBe(0);
  });
  it('is the whole bill when payment was left for later, less any part payments', () => {
    expect(paymentStillDue(base)).toBe(200000);
    expect(paymentStillDue({ ...base, receivedPaise: 50000 })).toBe(150000);
    expect(paymentStillDue({ ...base, receivedPaise: 250000 })).toBe(0);
  });
  it('is nothing without billing access', () => {
    expect(paymentStillDue({ ...base, canCollect: false })).toBe(0);
  });
});
