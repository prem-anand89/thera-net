import { describe, expect, it } from 'vitest';
import { activePhoneTab, isAccountAreaActive, isNavActive, pageTitleFor } from './navActive';

describe('isNavActive', () => {
  it('ignores search params and matches nested paths', () => {
    expect(isNavActive('/schedule', '/schedule')).toBe(true);
    expect(isNavActive('/patients/123', '/patients')).toBe(true);
    expect(isNavActive('/workspace', '/schedule')).toBe(false);
  });

  it('does not match a path that only shares a prefix', () => {
    expect(isNavActive('/ledgerx', '/ledger')).toBe(false);
  });
});

describe('isAccountAreaActive', () => {
  it('is true on settings and setup pages', () => {
    expect(isAccountAreaActive('/settings')).toBe(true);
    expect(isAccountAreaActive('/settings/import-visits')).toBe(true);
    expect(isAccountAreaActive('/setup')).toBe(true);
    expect(isAccountAreaActive('/workspace')).toBe(false);
  });
});

describe('activePhoneTab', () => {
  it('maps pages reached through More to the More tab', () => {
    expect(activePhoneTab('/settings')).toBe('/more');
    expect(activePhoneTab('/patients/123')).toBe('/more');
    expect(activePhoneTab('/insights')).toBe('/more');
    expect(activePhoneTab('/setup')).toBe('/more');
  });

  it('maps main pages to their own tab, and unknown pages to none', () => {
    expect(activePhoneTab('/schedule')).toBe('/schedule');
    expect(activePhoneTab('/ledger')).toBe('/ledger');
    expect(activePhoneTab('/visits/new')).toBeNull();
  });
});

describe('pageTitleFor', () => {
  it('names the current page', () => {
    expect(pageTitleFor('/insights')).toBe('Reports');
    expect(pageTitleFor('/patients/abc')).toBe('Patients');
    expect(pageTitleFor('/unknown')).toBeNull();
  });
});
