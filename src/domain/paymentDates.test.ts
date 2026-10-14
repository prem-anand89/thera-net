import { describe, expect, it } from 'vitest';
import { receivedDateAtVisit } from './paymentDates';

describe('receivedDateAtVisit', () => {
  it('keeps a back-dated visit date', () => {
    expect(receivedDateAtVisit('2026-10-01', '2026-10-14')).toBe('2026-10-01');
  });
  it('is today for a visit today', () => {
    expect(receivedDateAtVisit('2026-10-14', '2026-10-14')).toBe('2026-10-14');
  });
  it('caps a future-dated visit at today', () => {
    expect(receivedDateAtVisit('2026-10-20', '2026-10-14')).toBe('2026-10-14');
  });
});
