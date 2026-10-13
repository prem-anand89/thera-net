import { describe, expect, it } from 'vitest';
import { filterNavItems } from './Shell';

describe('filterNavItems', () => {
  it('shows Settings to an admin in the main header nav', () => {
    const items = filterNavItems('admin');
    const paths = items.map((i) => i.to);
    expect(paths).toEqual(['/workspace', '/schedule', '/ledger', '/insights', '/settings']);
  });

  it('hides Settings and Reports from a plain therapist', () => {
    const items = filterNavItems('therapist');
    const paths = items.map((i) => i.to);
    expect(paths).toEqual(['/workspace', '/schedule', '/ledger']);
    expect(paths).not.toContain('/settings');
    expect(paths).not.toContain('/insights');
  });

  it('shows Reports but hides Settings for front desk', () => {
    const items = filterNavItems('front_desk');
    const paths = items.map((i) => i.to);
    expect(paths).toEqual(['/workspace', '/schedule', '/ledger', '/insights']);
    expect(paths).not.toContain('/settings');
  });

  it('hides Schedule, Reports, and Settings while role is unknown', () => {
    const items = filterNavItems('unknown');
    const paths = items.map((i) => i.to);
    expect(paths).toEqual(['/workspace', '/ledger']);
  });
});
