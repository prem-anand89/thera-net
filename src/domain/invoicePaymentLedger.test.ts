import { describe, expect, it } from 'vitest';
import { buildInvoicePaymentLedger } from './invoicePaymentLedger';
import type { Invoice, InvoicePayment, Payment } from './types';

const invoice = { totalPaise: 250000, issuedAt: '2026-11-06T10:00:00Z', paymentMode: 'UPI' } as unknown as Invoice;
const pay = (over: Partial<Payment>): Payment =>
  ({ id: 'p', clinicId: 'c', visitId: 'v', amountPaise: 100000, method: 'upi', receivedDate: '2026-11-06', notes: null, updatedAt: '', ...over }) as Payment;

describe('buildInvoicePaymentLedger', () => {
  it('lists payments by date with their reference, and totals them', () => {
    const l = buildInvoicePaymentLedger(invoice, [], [
      pay({ id: 'b', receivedDate: '2026-11-09', method: 'cash', amountPaise: 50000, notes: ' Receipt 118 ' }),
      pay({ id: 'a', receivedDate: '2026-11-06', method: 'upi', amountPaise: 150000, notes: 'UTR 4093 8821' }),
    ]);
    expect(l.rows.map((r) => [r.date, r.mode, r.reference, r.amountPaise])).toEqual([
      ['2026-11-06', 'UPI', 'UTR 4093 8821', 150000],
      ['2026-11-09', 'Cash', 'Receipt 118', 50000],
    ]);
    expect([l.paidPaise, l.balancePaise, l.excessPaise]).toEqual([200000, 50000, 0]);
  });

  it('a payment with no note has no reference', () => {
    expect(buildInvoicePaymentLedger(invoice, [], [pay({ notes: '   ' })]).rows[0].reference).toBeNull();
  });

  it('a payment drawn from an advance names the advance receipt, not the system note', () => {
    const l = buildInvoicePaymentLedger(
      invoice,
      [],
      [pay({ advanceId: 'adv-123456-xyz', notes: 'Applied from advance received 2026-11-01', method: 'cash' })],
      undefined,
      new Map([['adv-123456-xyz', { id: 'adv-123456-xyz', receivedDate: '2026-11-01' }]])
    );
    expect(l.rows[0].mode).toBe('Advance');
    expect(l.rows[0].reference).toBe('ADV-20261101-ADV-12');
  });

  it('an advance whose record is not on this device still reads as an advance', () => {
    const l = buildInvoicePaymentLedger(invoice, [], [pay({ advanceId: 'gone', notes: 'Applied from advance' })]);
    expect(l.rows[0]).toMatchObject({ mode: 'Advance', reference: null });
  });

  it('shows what was received beyond the bill, with the balance staying at zero', () => {
    const l = buildInvoicePaymentLedger(invoice, [], [pay({ amountPaise: 300000 })]);
    expect([l.balancePaise, l.excessPaise]).toEqual([0, 50000]);
  });

  it('an older paid invoice with no payment rows reads as one payment of the whole total', () => {
    const l = buildInvoicePaymentLedger(invoice, [], [], { status: 'paid' } as InvoicePayment);
    expect(l.rows).toEqual([{ date: '2026-11-06', mode: 'UPI', reference: null, amountPaise: 250000 }]);
    expect(l.balancePaise).toBe(0);
  });

  it('an unpaid invoice has no rows and owes the total', () => {
    const l = buildInvoicePaymentLedger(invoice, [], [], { status: 'outstanding' } as InvoicePayment);
    expect([l.rows.length, l.paidPaise, l.balancePaise]).toEqual([0, 0, 250000]);
  });
});
