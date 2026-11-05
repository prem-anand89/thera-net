import { describe, expect, it } from 'vitest';
import { isUnlinked } from './teamLinking';

const member = { userId: 'u1' };
const linkedRoster = { userId: 'u1' };
const unlinkedRoster = { userId: null };

describe('isUnlinked', () => {
  it('is never true for someone with no roster row (a login-only staff member)', () => {
    expect(isUnlinked({ member, therapist: null }, true)).toBe(false);
    expect(isUnlinked({ member: null, therapist: null }, true)).toBe(false);
  });

  it('is false once a login is matched, loaded or not', () => {
    expect(isUnlinked({ member, therapist: linkedRoster }, true)).toBe(false);
    expect(isUnlinked({ member, therapist: unlinkedRoster }, false)).toBe(false);
  });

  it('does not call a therapist whose roster row has a userId unlinked while the member list is still loading', () => {
    expect(isUnlinked({ member: null, therapist: linkedRoster }, false)).toBe(false);
  });

  it('calls that same therapist unlinked once the list has loaded with no matching login (a revoked login)', () => {
    expect(isUnlinked({ member: null, therapist: linkedRoster }, true)).toBe(true);
  });

  it('calls a roster row with no userId unlinked straight away — loading cannot change that', () => {
    expect(isUnlinked({ member: null, therapist: unlinkedRoster }, false)).toBe(true);
    expect(isUnlinked({ member: null, therapist: unlinkedRoster }, true)).toBe(true);
  });
});
