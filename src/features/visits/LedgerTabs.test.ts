import { describe, expect, it } from 'vitest';
import { filterLedgerTabs } from './LedgerPage';

describe('filterLedgerTabs', () => {
  it('shows all four tabs (Visits, Patients, Invoices, Daybook) when billing is allowed', () => {
    const tabs = filterLedgerTabs({ canBill: true, entitlementsLoading: false });
    expect(tabs.map((t) => t.key)).toEqual(['visits', 'patients', 'invoices', 'daybook']);
  });

  it('keeps Patients and Visits visible but hides Invoices and Daybook when cannot bill', () => {
    const tabs = filterLedgerTabs({ canBill: false, entitlementsLoading: false });
    expect(tabs.map((t) => t.key)).toEqual(['visits', 'patients']);
  });

  it('shows Invoices and Daybook while entitlements are still loading to avoid tab flicker', () => {
    const tabs = filterLedgerTabs({ canBill: false, entitlementsLoading: true });
    expect(tabs.map((t) => t.key)).toEqual(['visits', 'patients', 'invoices', 'daybook']);
  });
});
