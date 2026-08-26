import { beforeEach, describe, expect, it } from 'vitest';
import { createPaymentService, createDirectPaymentService } from './paymentService';
import type { Invoice, InvoicePayment, Payment, Visit } from '@/domain/types';
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
      list: async (clinicId: string) =>
        [...payments.values()].filter((p) => p.clinicId === clinicId),
      listByDate: async (clinicId: string, date: string) =>
        [...payments.values()].filter((p) => p.clinicId === clinicId && p.receivedDate === date),
      listByVisit: async (visitId: string) =>
        [...payments.values()].filter((p) => p.visitId === visitId),
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

function makeInvoicePaymentFlowRepos(visitFixtures: Visit[]) {
  const invoicePayments = new Map<string, InvoicePayment>();
  const payments = new Map<string, Payment>();
  const visits = new Map(visitFixtures.map((v) => [v.id, v]));
  const repos = {
    invoicePayments: {
      getByInvoiceId: async (invoiceId: string) =>
        [...invoicePayments.values()].find((p) => p.invoiceId === invoiceId),
      list: async (clinicId: string) =>
        [...invoicePayments.values()].filter((p) => p.clinicId === clinicId),
      put: async (p: InvoicePayment) => void invoicePayments.set(p.id, p),
    },
    payments: {
      list: async (clinicId: string) =>
        [...payments.values()].filter((p) => p.clinicId === clinicId),
      listByVisit: async (visitId: string) =>
        [...payments.values()].filter((p) => p.visitId === visitId),
      put: async (p: Payment) => void payments.set(p.id, p),
    },
    visits: {
      list: async () => [...visits.values()],
    },
  } as unknown as Repos;
  return { repos, invoicePayments, payments };
}

function visitFixture(overrides: Partial<Visit> & { id: string; invoiceId: string }): Visit {
  return {
    clinicId: 'clinic-1',
    patientId: 'patient-1',
    therapistId: 'therapist-1',
    visitDate: '2026-08-01',
    condition: null,
    treatmentNotes: null,
    serviceCatalogId: 'service-1',
    catalogPricePaise: rs(500),
    actualBillPaise: rs(500),
    adjustmentPaise: 0,
    adjustmentReason: null,
    sessionIndex: null,
    packageTotal: null,
    packageGroupId: null,
    bmSplitPct: 0,
    taxPct: 0,
    tdsBasis: 'gross_bill',
    bmSharePaise: 0,
    postTaxPaise: 0,
    tdsPaise: 0,
    hvPaise: 0,
    deleted: false,
    updatedAt: '2026-08-01T00:00:00.000Z',
    ...overrides,
  } as Visit;
}

function invoiceFixture(overrides: Partial<Invoice> & { id: string; totalPaise: number }): Invoice {
  return {
    clinicId: 'clinic-1',
    invoiceNo: 'BM/26-27/0001',
    fyLabel: '26-27',
    seq: 1,
    issuedAt: '2026-08-01T00:00:00.000Z',
    patientSnapshot: { mrno: 'MR1', name: 'Test Patient', age: null, sex: null },
    lineItems: [],
    paymentMode: 'Cash',
    therapistId: null,
    supersedesInvoiceId: null,
    updatedAt: '2026-08-01T00:00:00.000Z',
    ...overrides,
  } as Invoice;
}

describe('paymentService.recordInvoicePayment / invoiceBalance', () => {
  // Every issued invoice gets an explicit 'outstanding' invoice_payments row
  // right away (IssueInvoiceDialog), and the "Record payment" UI only ever
  // appears once that row already says 'outstanding' — so that's the
  // realistic starting state for all of these, not the fallback "missing
  // row reads as paid" convention, which is for a lagged/failed second write.
  async function seedOutstanding(
    fake: ReturnType<typeof makeInvoicePaymentFlowRepos>,
    invoiceId: string
  ) {
    const svc = createPaymentService(fake.repos);
    await svc.setStatus(invoiceId, 'clinic-1', 'outstanding');
  }

  it('records a partial payment against a single-visit invoice without marking it paid', async () => {
    const visit = visitFixture({ id: 'visit-1', invoiceId: 'inv-1', actualBillPaise: rs(500) });
    const fake = makeInvoicePaymentFlowRepos([visit]);
    await seedOutstanding(fake, 'inv-1');
    const svc = createPaymentService(fake.repos);
    const invoice = invoiceFixture({ id: 'inv-1', totalPaise: rs(500) });

    await svc.recordInvoicePayment('clinic-1', invoice, rs(300), 'cash', '2026-08-02', null);

    const balance = await svc.invoiceBalance('clinic-1', invoice);
    expect(balance.paidPaise).toBe(rs(300));
    expect(balance.remainingPaise).toBe(rs(200));
    const status = await fake.repos.invoicePayments.getByInvoiceId('inv-1');
    expect(status?.status).toBe('outstanding'); // unchanged — still owes the rest
  });

  it('marks the invoice paid once cumulative payments reach the total', async () => {
    const visit = visitFixture({ id: 'visit-1', invoiceId: 'inv-1', actualBillPaise: rs(500) });
    const fake = makeInvoicePaymentFlowRepos([visit]);
    await seedOutstanding(fake, 'inv-1');
    const svc = createPaymentService(fake.repos);
    const invoice = invoiceFixture({ id: 'inv-1', totalPaise: rs(500) });

    await svc.recordInvoicePayment('clinic-1', invoice, rs(300), 'cash', '2026-08-02', null);
    await svc.recordInvoicePayment('clinic-1', invoice, rs(200), 'upi', '2026-08-05', null);

    const balance = await svc.invoiceBalance('clinic-1', invoice);
    expect(balance.paidPaise).toBe(rs(500));
    expect(balance.remainingPaise).toBe(0);
    const status = await fake.repos.invoicePayments.getByInvoiceId('inv-1');
    expect(status?.status).toBe('paid');
  });

  it('rejects an amount exceeding the outstanding balance without writing anything', async () => {
    const visit = visitFixture({ id: 'visit-1', invoiceId: 'inv-1', actualBillPaise: rs(500) });
    const fake = makeInvoicePaymentFlowRepos([visit]);
    await seedOutstanding(fake, 'inv-1');
    const svc = createPaymentService(fake.repos);
    const invoice = invoiceFixture({ id: 'inv-1', totalPaise: rs(500) });

    await expect(
      svc.recordInvoicePayment('clinic-1', invoice, rs(600), 'cash', '2026-08-02', null)
    ).rejects.toThrow(/exceeds the outstanding balance/);
    expect(fake.payments.size).toBe(0);
  });

  it('allocates one payment across a multi-visit (package) invoice in visit-date order', async () => {
    const visitA = visitFixture({
      id: 'visit-a',
      invoiceId: 'inv-1',
      visitDate: '2026-08-01',
      actualBillPaise: rs(500),
    });
    const visitB = visitFixture({
      id: 'visit-b',
      invoiceId: 'inv-1',
      visitDate: '2026-08-08',
      actualBillPaise: rs(500),
    });
    const fake = makeInvoicePaymentFlowRepos([visitB, visitA]); // deliberately out of order
    const svc = createPaymentService(fake.repos);
    const invoice = invoiceFixture({ id: 'inv-1', totalPaise: rs(1000) });

    await svc.recordInvoicePayment('clinic-1', invoice, rs(700), 'cash', '2026-08-09', null);

    const paidA = (await fake.repos.payments.listByVisit('visit-a')).reduce(
      (s, p) => s + p.amountPaise,
      0
    );
    const paidB = (await fake.repos.payments.listByVisit('visit-b')).reduce(
      (s, p) => s + p.amountPaise,
      0
    );
    expect(paidA).toBe(rs(500)); // earlier visit fully covered first
    expect(paidB).toBe(rs(200)); // remainder spills into the later one
  });
});

describe('directPaymentService.logPayment', () => {
  let fake: ReturnType<typeof makeFakePaymentsRepos>;
  beforeEach(() => {
    fake = makeFakePaymentsRepos();
  });

  it('writes through repos.payments (not raw Dexie), so the write goes through the outbox/sync path', async () => {
    const svc = createDirectPaymentService(fake.repos);
    const payment = await svc.logPayment(
      'clinic-1',
      'visit-1',
      rs(500),
      'cash',
      '2026-07-12',
      null
    );
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
    const payment = await svc.logPayment(
      'clinic-1',
      'visit-1',
      rs(300),
      'cash',
      '2026-07-10',
      null
    );
    await svc.deletePayment(payment.id);
    expect(fake.payments.size).toBe(0);
  });
});
