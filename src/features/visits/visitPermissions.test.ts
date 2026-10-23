import { describe, expect, it } from 'vitest';
import { visitPermissions } from './visitPermissions';

const base = { isAdmin: false, isFrontDesk: false, myTherapistId: 'me', visitTherapistId: 'me', invoiced: false };

describe('visitPermissions', () => {
  it('front desk sees Edit on a saved visit but not Delete', () => {
    const p = visitPermissions({ ...base, isFrontDesk: true, myTherapistId: undefined, visitTherapistId: 't9' });
    expect(p).toMatchObject({ canModify: true, canDelete: false });
  });
  it('assisting therapist sees no Edit', () => {
    const p = visitPermissions({ ...base, visitTherapistId: 'someone-else' });
    expect(p).toMatchObject({ canModify: false, canDelete: false });
  });
  it('primary therapist edits and deletes their own uninvoiced visit', () => {
    expect(visitPermissions(base)).toMatchObject({ canModify: true, canDelete: true });
    expect(visitPermissions({ ...base, invoiced: true })).toMatchObject({ canModify: true, canDelete: false });
  });
  it('admin does everything until the visit is invoiced', () => {
    const a = { ...base, isAdmin: true, myTherapistId: undefined, visitTherapistId: 't9' };
    expect(visitPermissions(a)).toMatchObject({ canModify: true, canDelete: true });
    expect(visitPermissions({ ...a, invoiced: true }).canDelete).toBe(false);
  });
  it('an unlinked login is never "own"', () => {
    expect(visitPermissions({ ...base, myTherapistId: undefined, visitTherapistId: '' }).canModify).toBe(false);
  });
});
