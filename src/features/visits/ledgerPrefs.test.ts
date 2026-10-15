// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';
import { loadLedgerPrefs, presetRange, saveLedgerPrefs } from './ledgerPrefs';

beforeEach(() => localStorage.clear());

describe('ledger prefs', () => {
  it('round-trips per clinic', () => {
    saveLedgerPrefs('a', { tab: 'invoices', datePreset: 'month', onlyNotCollected: true, therapistId: 't1' });
    expect(loadLedgerPrefs('a')).toEqual({
      tab: 'invoices',
      datePreset: 'month',
      onlyNotCollected: true,
      therapistId: 't1',
    });
    expect(loadLedgerPrefs('b')).toEqual({});
  });

  it('ignores junk, old shapes and unreadable storage', () => {
    localStorage.setItem('ledger:prefs:a', JSON.stringify({ tab: 'nope', datePreset: 7, from: 'x', onlyNotCollected: 'yes' }));
    expect(loadLedgerPrefs('a')).toEqual({});
    localStorage.setItem('ledger:prefs:a', '{not json');
    expect(loadLedgerPrefs('a')).toEqual({});
  });
});

describe('presetRange', () => {
  const now = new Date(2026, 9, 16); // Fri 16 Oct 2026
  it('computes ranges from today, so a remembered preset never goes stale', () => {
    expect(presetRange('today', now)).toEqual({ from: '2026-10-16', to: '2026-10-16' });
    expect(presetRange('yesterday', now)).toEqual({ from: '2026-10-15', to: '2026-10-15' });
    expect(presetRange('month', now)).toEqual({ from: '2026-10-01', to: '2026-10-16' });
    expect(presetRange('lastMonth', now)).toEqual({ from: '2026-09-01', to: '2026-09-30' });
    expect(presetRange('all', now)).toEqual({ from: '', to: '' });
    expect(presetRange('custom', now)).toBeNull();
  });
});
