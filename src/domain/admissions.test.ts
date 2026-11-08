import { describe, expect, it } from 'vitest';
import type { Admission, Visit } from './types';
import { wardOf, admissionDateProblem, dayOfStay, isDuplicateOpenAdmission, isOpenAdmission, openAdmissionOf, repointVisits } from './admissions';

const stay = (over: Partial<Admission> = {}): Admission => ({
  id: 'a1', clinicId: 'c', patientId: 'p', ipdNo: null, wardBed: null, admittingDoctor: null,
  admittedOn: '2026-11-01', dischargedOn: null, notes: null, deleted: false, updatedAt: '', ...over,
});

describe('open stays', () => {
  it('a stay is open until it is discharged or deleted', () => {
    expect(isOpenAdmission(stay())).toBe(true);
    expect(isOpenAdmission(stay({ dischargedOn: '2026-11-05' }))).toBe(false);
    expect(isOpenAdmission(stay({ deleted: true }))).toBe(false);
    expect(openAdmissionOf([stay({ id: 'old', dischargedOn: '2026-10-02' }), stay({ id: 'now' })])?.id).toBe('now');
    expect(openAdmissionOf([stay({ dischargedOn: '2026-11-05' })])).toBeUndefined();
  });
});

describe('dayOfStay', () => {
  it('counts the admission day as day 1, never below 1, across a month end', () => {
    expect(dayOfStay('2026-11-08', '2026-11-08')).toBe(1);
    expect(dayOfStay('2026-10-30', '2026-11-02')).toBe(4);
    expect(dayOfStay('2026-11-20', '2026-11-08')).toBe(1);
  });
});

describe('admissionDateProblem', () => {
  it('needs a date, and a discharge not before the admission', () => {
    expect(admissionDateProblem('', null)).toMatch(/date of admission/);
    expect(admissionDateProblem('2026-11-05', '2026-11-04')).toMatch(/before the admission/);
    expect(admissionDateProblem('2026-11-05', '2026-11-05')).toBeNull();
    expect(admissionDateProblem('2026-11-05', null)).toBeNull();
    expect(admissionDateProblem('2026-11-05', '')).toMatch(/discharge date/);
  });
});

describe('isDuplicateOpenAdmission', () => {
  it('matches only the one-open-stay unique violation', () => {
    expect(isDuplicateOpenAdmission({ code: '23505', message: 'duplicate key value violates unique constraint "admissions_one_open_per_patient"' })).toBe(true);
    expect(isDuplicateOpenAdmission({ code: '23505', message: 'duplicate key value violates unique constraint "patients_pkey"' })).toBe(false);
    expect(isDuplicateOpenAdmission({ code: '42501', message: 'admissions_one_open_per_patient' })).toBe(false);
    expect(isDuplicateOpenAdmission(null)).toBe(false);
  });
});

describe('repointVisits', () => {
  it('moves only the losing stay\'s visits to the surviving one', () => {
    const v = (id: string, admissionId: string | null) => ({ id, admissionId, updatedAt: 'x' }) as unknown as Visit;
    const out = repointVisits([v('1', 'lose'), v('2', 'other'), v('3', null)], 'lose', 'win', 'now');
    expect(out.map((x) => [x.id, x.admissionId, x.updatedAt])).toEqual([['1', 'win', 'now']]);
  });
});

describe('wardOf', () => {
  it('groups by the text before the comma or a trailing bed number, ignoring case', () => {
    expect(wardOf('Ortho ward, bed 12').label).toBe('Ortho ward');
    expect(wardOf('Ortho Ward - bed 3').key).toBe(wardOf('ortho ward, bed 9').key);
    expect(wardOf('Ortho ward bed 4').label).toBe('Ortho ward');
    expect(wardOf('ICU').label).toBe('ICU');
    expect(wardOf('  ').label).toBe('No ward set');
    expect(wardOf(null).key).toBe('');
  });
});
