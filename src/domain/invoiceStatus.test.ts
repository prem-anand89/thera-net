import { describe, expect, it } from 'vitest';
import { canMarkOutstanding, invoiceBalance, invoiceDisplayStatus, invoiceRowStatus } from './invoiceStatus';

describe('invoiceRowStatus', () => {
  it('reads a missing status row as paid, like the rest of the app', () => {
    expect(invoiceRowStatus(undefined)).toBe('paid');
    expect(invoiceRowStatus('outstanding')).toBe('outstanding');
    expect(invoiceRowStatus('void')).toBe('void');
  });
});

describe('canMarkOutstanding', () => {
  it('offers the undo only for a paid flag with no money recorded against it', () => {
    expect(canMarkOutstanding('paid', 0)).toBe(true);
    expect(canMarkOutstanding('paid', 50000)).toBe(false);
    expect(canMarkOutstanding('outstanding', 0)).toBe(false);
    expect(canMarkOutstanding('void', 0)).toBe(false);
  });
});

describe('invoiceDisplayStatus', () => {
  const d = (isSuperseded: boolean, status: 'paid' | 'outstanding' | 'void', paidPaise = 0) =>
    invoiceDisplayStatus({ isSuperseded, status, paidPaise });

  it('shows each state', () => {
    expect(d(false, 'paid')).toEqual({ label: 'Paid', tone: 'green', isPartial: false });
    expect(d(false, 'void')).toEqual({ label: 'Void', tone: 'slate', isPartial: false });
    expect(d(false, 'outstanding')).toEqual({ label: 'Outstanding', tone: 'amber', isPartial: false });
    expect(d(false, 'outstanding', 100)).toEqual({ label: 'Partially paid', tone: 'amber', isPartial: true });
  });

  it('lets superseded win over the bill\'s own status', () => {
    expect(d(true, 'paid').label).toBe('Superseded');
    expect(d(true, 'outstanding', 100)).toEqual({ label: 'Superseded', tone: 'slate', isPartial: false });
  });
});

describe('invoiceBalance', () => {
  it('treats paid as fully collected and void as nothing due', () => {
    expect(invoiceBalance({ status: 'paid', totalPaise: 5000, recordedPaise: 0 })).toEqual({ paidPaise: 5000, remainingPaise: 0 });
    expect(invoiceBalance({ status: 'void', totalPaise: 5000, recordedPaise: 2000 })).toEqual({ paidPaise: 0, remainingPaise: 0 });
  });
  it('owes the total less what is recorded, never below zero', () => {
    expect(invoiceBalance({ status: 'outstanding', totalPaise: 5000, recordedPaise: 2000 })).toEqual({ paidPaise: 2000, remainingPaise: 3000 });
    expect(invoiceBalance({ status: 'outstanding', totalPaise: 5000, recordedPaise: 9000 })).toEqual({ paidPaise: 9000, remainingPaise: 0 });
  });
});
