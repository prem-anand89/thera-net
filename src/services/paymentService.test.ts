import { beforeEach, describe, expect, it } from 'vitest';
import { createPaymentService, createDirectPaymentService } from './paymentService';
import type { InvoicePayment, Payment } from '@/domain/types';
import type { Repos } from '@/repositories/types';
import { rupeesToPaise as rs } from '@/domain/money';

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

function makeFakePaymentsRepos() {
  const payments = new Map<string, Payment>();
  const repos = {
    payments: {
      get: async (id: string) => payments.get(id),
      list: async (clinicId: string) => [...payments.values()].filter((p) => p.clinicId === clinicId),
      listByDate: async (clinicId: string, date: string) =>
        [...payments.values()].filter((p) => p.clinicId === clinicId && p.receivedDate === date),
      listByVisit: async (visitId: string) => [...payments.values()].filter((p) => p.visitId === visitId),
      put: async (p: Payment) => void payments.set(p.id, p),
      delete: async (id: string) => void payments.delete(id),
    },
  } as unknown as Repos;
  return { repos, payments };
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

describe('directPaymentService.logPayment', () => {
  let fake: ReturnType<typeof makeFakePaymentsRepos>;
  beforeEach(() => {
    fake = makeFakePaymentsRepos();
  });

  it('writes through repos.payments (not raw Dexie), so the write goes through the outbox/sync path', async () => {
    const svc = createDirectPaymentService(fake.repos);
    const payment = await svc.logPayment('clinic-1', 'visit-1', rs(500), 'cash', '2026-07-12', null);
    expect(payment.amountPaise).toBe(rs(500));
    expect(fake.payments.size).toBe(1);
    expect(fake.payments.get(payment.id)).toEqual(payment);
  });

  it('totalPaidForVisit sums multiple payments against the same visit', async () => {
    const svc = createDirectPaymentService(fake.repos);
    await svc.logPayment('clinic-1', 'visit-1', rs(300), 'cash', '2026-07-10', null);
    await svc.logPayment('clinic-1', 'visit-1', rs(200), 'upi', '2026-07-11', null);
    expect(await svc.totalPaidForVisit('visit-1')).toBe(rs(500));
  });

  it('collectedOnDate only sums payments received on that date', async () => {
    const svc = createDirectPaymentService(fake.repos);
    await svc.logPayment('clinic-1', 'visit-1', rs(300), 'cash', '2026-07-10', null);
    await svc.logPayment('clinic-1', 'visit-2', rs(200), 'upi', '2026-07-11', null);
    expect(await svc.collectedOnDate('clinic-1', '2026-07-10')).toBe(rs(300));
  });

  it('deletePayment removes the row', async () => {
    const svc = createDirectPaymentService(fake.repos);
    const payment = await svc.logPayment('clinic-1', 'visit-1', rs(300), 'cash', '2026-07-10', null);
    await svc.deletePayment(payment.id);
    expect(fake.payments.size).toBe(0);
  });
});
