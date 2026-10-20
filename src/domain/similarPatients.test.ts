import { describe, expect, it } from 'vitest';
import type { Patient } from './types';
import { findSimilarPatients, patientSummary } from './similarPatients';

const p = (over: Partial<Patient>): Patient => ({
  id: 'p1', clinicId: 'c', mrno: 'BM-1', mrnoSource: 'auto', name: 'Priya Sharma', age: 34, sex: 'F', phone: null,
  primaryCondition: 'Ankle sprain', updatedAt: '', ...over,
});

describe('findSimilarPatients', () => {
  const list = [
    p({ id: 'a', name: 'Priya Sharma', phone: '+91 9876543210' }),
    p({ id: 'b', name: 'Priya Sharmaa', mrno: 'BM-2' }),
    p({ id: 'c', name: 'Rahul Verma', mrno: 'BM-3' }),
    p({ id: 'd', name: 'Priya Sharma', mrno: 'BM-4', deletedAt: '2026-01-01' }),
  ];

  it('finds identical and near names, skipping hidden patients and different names', () => {
    const ids = findSimilarPatients(list, 'priya sharma', '').map((m) => m.patient.id);
    expect(ids).toEqual(['a', 'b']);
  });

  it('a phone match comes first even when the name differs, in any phone format', () => {
    const result = findSimilarPatients(list, 'Someone Else', '098765 43210');
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ matchedBy: 'phone', patient: { id: 'a' } });
  });

  it('nothing typed means nothing found; a short phone is not a match', () => {
    expect(findSimilarPatients(list, '', '')).toEqual([]);
    expect(findSimilarPatients(list, '', '987')).toEqual([]);
  });

  it('lists at most three', () => {
    const many = ['a', 'b', 'c', 'd', 'e'].map((id) => p({ id, mrno: id }));
    expect(findSimilarPatients(many, 'Priya Sharma', '')).toHaveLength(3);
  });
});

describe('patientSummary', () => {
  it('joins ID, age and sex, condition and last visit, leaving out what is missing', () => {
    expect(patientSummary(p({}), '2026-10-12')).toBe('BM-1 · 34 F · Ankle sprain · seen 12 Oct');
    expect(patientSummary(p({ age: null, sex: null, primaryCondition: null }))).toBe('BM-1');
  });
});
