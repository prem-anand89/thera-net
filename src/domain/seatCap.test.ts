import { describe, expect, it } from 'vitest';
import { atSeatCap } from './seatCap';

const plan = (over = {}) => ({ enforcementEnabled: true, loading: false, maxMembers: 3, ...over });

describe('atSeatCap', () => {
  it('is full only when seats used reach the limit', () => {
    expect(atSeatCap(plan(), 2)).toBe(false);
    expect(atSeatCap(plan(), 3)).toBe(true);
    expect(atSeatCap(plan(), 4)).toBe(true);
  });
  it('is never full while loading, unenforced, or with an unknown count', () => {
    expect(atSeatCap(plan({ loading: true }), 3)).toBe(false);
    expect(atSeatCap(plan({ enforcementEnabled: false }), 3)).toBe(false);
    expect(atSeatCap(plan(), null)).toBe(false);
    expect(atSeatCap(plan(), undefined)).toBe(false);
  });
});
