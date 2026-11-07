import { describe, expect, it } from 'vitest';
import { selectableForBilling, unbilledInRange } from './billingSelection';
import type { VisitCardData } from '@/components/visit/types';

const row = (over: Partial<VisitCardData>): VisitCardData =>
  ({ visitId: 'v', visitDate: '2026-11-05', billPaise: 100000, invoiceId: null, paymentState: 'uninvoiced', partnerCollectedPaise: 0, packageInvoicePending: false, ...over }) as VisitCardData;

const biller = { canBill: true, canCollect: true };
const collector = { canBill: false, canCollect: true };

describe('selectableForBilling', () => {
  it('with billing rights: an uninvoiced visit is selectable, an invoiced one is not', () => {
    const rows = [row({ visitId: 'a' }), row({ visitId: 'b', invoiceId: 'inv-1' })];
    expect(selectableForBilling(rows, biller).map((r) => r.visitId)).toEqual(['a']);
  });

  it('a visit paid entirely at the partner\'s counter is not selectable', () => {
    const rows = [row({ visitId: 'a', partnerCollectedPaise: 100000 }), row({ visitId: 'b', partnerCollectedPaise: 40000 })];
    expect(selectableForBilling(rows, biller).map((r) => r.visitId)).toEqual(['b']);
  });

  it('a ₹0 session of an already-invoiced package is not selectable, but a ₹0 session of an uninvoiced package is', () => {
    const rows = [row({ visitId: 'late', billPaise: 0, packageInvoicePending: true }), row({ visitId: 'free', billPaise: 0, packageInvoicePending: false })];
    expect(selectableForBilling(rows, biller).map((r) => r.visitId)).toEqual(['free']);
  });

  it('without billing rights: only visits with something owed, and only if they can collect', () => {
    const rows = [row({ visitId: 'owed', paymentState: 'uninvoiced' }), row({ visitId: 'paid', paymentState: 'collected_no_receipt' })];
    expect(selectableForBilling(rows, collector).map((r) => r.visitId)).toEqual(['owed']);
    expect(selectableForBilling(rows, { canBill: false, canCollect: false })).toEqual([]);
  });
});

describe('unbilledInRange', () => {
  const rows = [
    row({ visitId: 'oct', visitDate: '2026-10-28' }),
    row({ visitId: 'nov2', visitDate: '2026-11-09' }),
    row({ visitId: 'nov1', visitDate: '2026-11-02' }),
    row({ visitId: 'billed', visitDate: '2026-11-03', invoiceId: 'inv' }),
    row({ visitId: 'dec', visitDate: '2026-12-01' }),
  ];

  it('all: every unbilled visit, oldest first', () => {
    expect(unbilledInRange(rows, biller, 'all', '2026-11-20')).toEqual(['oct', 'nov1', 'nov2', 'dec']);
  });
  it('this month and last month use the calendar month of the visit date', () => {
    expect(unbilledInRange(rows, biller, 'this_month', '2026-11-20')).toEqual(['nov1', 'nov2']);
    expect(unbilledInRange(rows, biller, 'last_month', '2026-11-20')).toEqual(['oct']);
  });
  it('last month from January is December of the year before', () => {
    expect(unbilledInRange([row({ visitId: 'd', visitDate: '2025-12-30' })], biller, 'last_month', '2026-01-05')).toEqual(['d']);
  });
  it('follows the same rules as selectableForBilling', () => {
    expect(unbilledInRange([row({ visitId: 'x', packageInvoicePending: true, billPaise: 0 })], biller, 'all', '2026-11-20')).toEqual([]);
  });
});
