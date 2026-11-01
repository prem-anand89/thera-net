import { describe, expect, it } from 'vitest';
import { rosterAddBlocked, rosterLimitMessage, rosterOverLimit, rosterUsed } from './roster';

const person = (id: string, over: { active?: boolean; userId?: string | null } = {}) => ({ id, active: true, userId: null as string | null, ...over });

describe('roster limit', () => {
  const owner = person('owner', { userId: 'u1' });
  const colleague = person('c1');

  it('counts only active team members with no login (the owner and linked colleagues do not count)', () => {
    expect(rosterUsed([owner, colleague, person('c2', { active: false }), person('c3', { userId: 'u3' })])).toBe(1);
  });

  it('blocks adding another once the limit is used, and never blocks without a limit', () => {
    expect(rosterAddBlocked([owner, colleague], 1)).toBe(true);
    expect(rosterAddBlocked([owner], 1)).toBe(false);
    expect(rosterAddBlocked([owner, colleague], null)).toBe(false);
  });

  it('switching one back on does not count that person twice', () => {
    const off = person('c1', { active: false });
    expect(rosterAddBlocked([owner, off], 1, 'c1')).toBe(false);
    expect(rosterAddBlocked([owner, off, person('c2')], 1, 'c1')).toBe(true);
  });

  it('flags a clinic that is already over its limit', () => {
    expect(rosterOverLimit([colleague, person('c2')], 1)).toBe(true);
    expect(rosterOverLimit([colleague], 1)).toBe(false);
    expect(rosterOverLimit([colleague, person('c2')], null)).toBe(false);
  });

  it('words the refusal for one and for several', () => {
    expect(rosterLimitMessage(1)).toContain('1 team member without a login, and that one is in use');
    expect(rosterLimitMessage(3)).toContain('3 team members without a login, and they are all in use');
  });
});
