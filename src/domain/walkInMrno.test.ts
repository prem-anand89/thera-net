import { describe, expect, it } from 'vitest';
import { isMrnoCollision, maxWalkInSeq, reissueWalkInMrno } from './walkInMrno';

describe('reissueWalkInMrno', () => {
  it('takes the next number after everything already used', () => {
    expect(reissueWalkInMrno('W26-0001', ['W26-0001', 'W26-0002', 'W26-0007'])).toBe('W26-0008');
  });
  it('keeps a custom prefix and the year', () => {
    expect(reissueWalkInMrno('BM26-0003', ['BM26-0003', 'BM26-0004'])).toBe('BM26-0005');
  });
  it('ignores other years and hospital-style IDs when counting', () => {
    expect(reissueWalkInMrno('W26-0001', ['W25-0099', 'HOSP-77', 'W26-0001'])).toBe('W26-0002');
  });
  it('is null for an ID that is not walk-in style', () => {
    expect(reissueWalkInMrno('879234', [])).toBeNull();
    expect(reissueWalkInMrno('MR-ABC', [])).toBeNull();
  });
});

describe('maxWalkInSeq', () => {
  it('is 0 with nothing matching', () => {
    expect(maxWalkInSeq(['X'], 'W', '26')).toBe(0);
  });
});

describe('isMrnoCollision', () => {
  it('matches a unique violation on the mrno key only', () => {
    expect(isMrnoCollision({ code: '23505', message: 'duplicate key value violates unique constraint "patients_clinic_id_mrno_key"' })).toBe(true);
    expect(isMrnoCollision({ code: '23505', message: 'duplicate key value violates unique constraint "visits_pkey"' })).toBe(false);
    expect(isMrnoCollision({ code: '42501', message: 'mrno policy' })).toBe(false);
  });
});
