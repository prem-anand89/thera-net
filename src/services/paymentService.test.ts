import { beforeEach, describe, expect, it } from 'vitest';
import { createPaymentService } from './paymentService';
import type { InvoicePayment } from '@/domain/types';
import type { Repos } from '@/repositories/types';

function makeFakeRepos() {
  const invoicePayments = new Map<string, InvoicePayment>();
  const repos = {
    invoicePayments: {
      getByInvoiceId: async (invoiceId: string) =>
        [...invoicePayments.values()].find((p) => p.invoiceId === invoiceId),
      list: async (clinicId: string) =>
        [...invoicePayments.values()].filter((p) => p.clinicId === clinicId),
      put: async (p: InvoicePayment) => void invoicePayments.set(p.id, p),
    },
  } as unknown as Repos;
  return { repos, invoicePayments };
}

describe('paymentService.setStatus', () => {
  let fake: ReturnType<typeof makeFakeRepos>;
  beforeEach(() => {
    fake = makeFakeRepos();
  });

  it('creates a new payment row for an invoice with no existing status', async () => {
    const svc = createPaymentService(fake.repos);
    const p = await svc.setStatus('inv-1', 'clinic-1', 'outstanding');
    expect(p.status).toBe('outstanding');
    expect(p.paidAt).toBeNull();
    expect(fake.invoicePayments.size).toBe(1);
  });

  it('stamps paidAt when marked paid, clears it when marked outstanding again', async () => {
    const svc = createPaymentService(fake.repos);
    const paid = await svc.setStatus('inv-1', 'clinic-1', 'paid');
    expect(paid.status).toBe('paid');
    expect(paid.paidAt).not.toBeNull();

    const outstanding = await svc.setStatus('inv-1', 'clinic-1', 'outstanding');
    expect(outstanding.status).toBe('outstanding');
    expect(outstanding.paidAt).toBeNull();
  });

  it('updates the existing row in place rather than creating a duplicate', async () => {
    const svc = createPaymentService(fake.repos);
    const first = await svc.setStatus('inv-1', 'clinic-1', 'outstanding');
    const second = await svc.setStatus('inv-1', 'clinic-1', 'paid');
    expect(second.id).toBe(first.id);
    expect(fake.invoicePayments.size).toBe(1);
  });
});
