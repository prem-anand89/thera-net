import { describe, expect, it } from 'vitest';
import { createAdvanceService } from './advanceService';
import type { Invoice, InvoicePayment, PatientAdvance, Payment, Visit } from '@/domain/types';
import type { Repos } from '@/repositories/types';
import { rupeesToPaise as rs } from '@/domain/money';

function setup(invoiceTotal: number, visitBill: number) {
  const payments = new Map<string, Payment>();
  const statuses = new Map<string, InvoicePayment>();
  const advances = new Map<string, PatientAdvance>();
  const visit = { id: 'v1', clinicId: 'c1', invoiceId: 'inv-1', visitDate: '2026-08-01', actualBillPaise: visitBill, deleted: false } as Visit;
  const invoice = { id: 'inv-1', clinicId: 'c1', totalPaise: invoiceTotal } as Invoice;
  const repos = {
    payments: {
      list: async () => [...payments.values()],
      listByAdvanceId: async (id: string) => [...payments.values()].filter((p) => p.advanceId === id),
      listByVisit: async (id: string) => [...payments.values()].filter((p) => p.visitId === id),
      put: async (p: Payment) => void payments.set(p.id, p),
    },
    patientAdvances: { put: async (a: PatientAdvance) => void advances.set(a.id, a) },
    invoices: { get: async (id: string) => (id === invoice.id ? invoice : undefined) },
    invoicePayments: {
      getByInvoiceId: async (id: string) => [...statuses.values()].find((s) => s.invoiceId === id),
      put: async (p: InvoicePayment) => void statuses.set(p.id, p),
    },
    visits: { list: async () => [visit], listByInvoiceId: async (id: string) => (visit.invoiceId === id && !visit.deleted ? [visit] : []) },
  } as unknown as Repos;
  const advance = { id: 'adv-1', clinicId: 'c1', patientId: 'p1', amountPaise: rs(1000), method: 'cash', receivedDate: '2026-07-30', status: 'open' } as PatientAdvance;
  return { repos, visit, statuses, advance };
}

describe('advanceService.applyAdvance', () => {
  it('marks the invoice paid when the advance covers it in full', async () => {
    const { repos, visit, statuses, advance } = setup(rs(1000), rs(1000));
    await createAdvanceService(repos).applyAdvance('c1', advance, [visit], rs(1000), '2026-08-02');
    expect([...statuses.values()][0]?.status).toBe('paid');
  });

  it('keeps the invoice outstanding when the advance only covers part', async () => {
    const { repos, visit, statuses, advance } = setup(rs(1000), rs(1000));
    await createAdvanceService(repos).applyAdvance('c1', advance, [visit], rs(400), '2026-08-02');
    expect([...statuses.values()][0]?.status).toBe('outstanding');
  });

  it('writes no invoice status for a visit with no invoice', async () => {
    const { repos, visit, statuses, advance } = setup(rs(1000), rs(1000));
    await createAdvanceService(repos).applyAdvance('c1', advance, [{ ...visit, invoiceId: null }], rs(500), '2026-08-02');
    expect(statuses.size).toBe(0);
  });
});
