import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Invoice, InvoicePayment, Payment, Visit, VisitItem } from '@/domain/types';
import type { Repos } from '@/repositories/types';
import { rupeesToPaise as rs } from '@/domain/money';

const rpc = vi.fn();
vi.mock('@/lib/supabase', () => ({ getSupabase: () => ({ rpc }) }));

import { createInvoiceService } from './invoiceService';
import { db } from '@/lib/db';

function visit(over: Partial<Visit> = {}): Visit {
  return {
    id: 'v1', clinicId: 'c1', patientId: 'p1', therapistId: 't1', visitDate: '2026-08-01',
    serviceCatalogId: 's1', catalogPricePaise: rs(500), actualBillPaise: rs(500), adjustmentPaise: 0,
    adjustmentReason: null, sessionIndex: null, packageTotal: null, packageGroupId: null,
    invoiceId: 'inv-old', deleted: false, ...over,
  } as Visit;
}

function setup(payments: Payment[]) {
  const statuses = new Map<string, InvoicePayment>();
  const v = visit();
  const original = { id: 'inv-old', clinicId: 'c1', fyLabel: '26-27', patientSnapshot: {}, clinicalSnapshot: null } as unknown as Invoice;
  const repos = {
    invoices: { get: async () => original, putLocal: async () => {} },
    clinics: { get: async () => ({ id: 'c1' }) },
    visits: {
      get: async () => v,
      list: async () => [{ ...v, invoiceId: 'inv-new' }],
      listByInvoiceId: async (id: string) => (id === 'inv-new' ? [{ ...v, invoiceId: 'inv-new' }] : []),
      listByPackageGroup: async () => [],
      markInvoiced: async () => {},
    },
    visitItems: { listByVisitIds: async () => [] },
    visitCredits: { listByVisitIds: async () => [] },
    catalog: { get: async () => ({ id: 's1', name: 'Physio' }) },
    payments: { listByVisit: async () => payments, list: async () => payments },
    invoicePayments: {
      getByInvoiceId: async (id: string) => [...statuses.values()].find((s) => s.invoiceId === id),
      put: async (p: InvoicePayment) => void statuses.set(p.id, p),
    },
  } as unknown as Repos;
  return { repos, statuses };
}

describe('invoiceService.amendInvoice', () => {
  beforeEach(() => {
    rpc.mockReset();
    Object.defineProperty(navigator, 'onLine', { value: true, configurable: true });
    rpc.mockResolvedValue({ data: { id: 'inv-new', clinic_id: 'c1', total_paise: rs(500), invoice_no: 'X/1' }, error: null });
  });

  it('refuses to amend while a visit, line or share is still waiting to sync', async () => {
    await db.outbox.clear();
    await db.outbox.add({ table: 'visit_items', rowId: 'line-9', ts: 1 });
    const { repos } = setup([]);
    await db.visit_items.put({ id: 'line-9', visitId: 'v1' } as never);
    await expect(createInvoiceService(repos).amendInvoice('inv-old', ['v1'], 'Cash')).rejects.toThrow(
      'Some of these services are still syncing. Try again in a moment.'
    );
    expect(rpc).not.toHaveBeenCalled();
    await db.outbox.clear();
    await db.outbox.add({ table: 'visits', rowId: 'v1', ts: 2 });
    await expect(createInvoiceService(repos).amendInvoice('inv-old', ['v1'], 'Cash')).rejects.toThrow('still syncing');
    await db.outbox.clear();
    await db.visit_items.clear();
  });

  it('says a refused change blocks the bill, for amend and for issue', async () => {
    const REFUSED = 'A change to one of these visits was refused by the server. Fix or discard it from the unsynced changes notice, then give the bill.';
    await db.outbox.clear();
    await db.outbox.add({ table: 'visit_credits', rowId: 'c1', ts: 1, error: 'denied', errorCode: '42501' });
    await db.visit_credits.put({ id: 'c1', visitId: 'v1' } as never);
    const { repos } = setup([]);
    const r = repos as unknown as { patients: unknown; visits: { get: unknown } };
    r.patients = { get: async () => ({ id: 'p1' }) };
    r.visits.get = async () => visit({ invoiceId: null });
    const svc = createInvoiceService(repos);
    await expect(svc.amendInvoice('inv-old', ['v1'], 'Cash')).rejects.toThrow(REFUSED);
    await expect(svc.issueForVisits(['v1'], 'Cash')).rejects.toThrow(REFUSED);
    await db.outbox.clear();
    await db.outbox.add({ table: 'visit_credits', rowId: 'c1', ts: 2 });
    await expect(svc.issueForVisits(['v1'], 'Cash')).rejects.toThrow('still syncing');
    expect(rpc).not.toHaveBeenCalled();
    await db.outbox.clear();
    await db.visit_credits.clear();
  });

  it('gives an amendment of an unpaid invoice an explicit outstanding status', async () => {
    const { repos, statuses } = setup([]);
    await createInvoiceService(repos).amendInvoice('inv-old', ['v1'], 'Cash');
    expect([...statuses.values()].map((s) => [s.invoiceId, s.status])).toEqual([['inv-new', 'outstanding']]);
  });

  it('keeps an amendment of a fully paid invoice paid', async () => {
    const paid = { id: 'p1', clinicId: 'c1', visitId: 'v1', amountPaise: rs(500) } as Payment;
    const { repos, statuses } = setup([paid]);
    await createInvoiceService(repos).amendInvoice('inv-old', ['v1'], 'Cash');
    expect([...statuses.values()][0]?.status).toBe('paid');
  });
});

describe('invoiceService: a visit whose services have not all arrived', () => {
  const ARRIVING = "This visit's services haven't all arrived on this device yet. Try again in a moment.";
  const line = (id: string, position: number, pricePaise: number): VisitItem =>
    ({
      id, clinicId: 'c1', visitId: 'v1', position, serviceCatalogId: 's1', serviceName: 'Physio',
      catalogPricePaise: pricePaise, pricePaise, assistingTherapistId: null, durationMinutes: null,
      isPackageLine: false, deleted: false, updatedAt: '',
    }) as VisitItem;

  function setupLines(v: Visit, lines: VisitItem[]) {
    const { repos } = setup([]);
    const r = repos as unknown as {
      patients: unknown;
      visits: { get: unknown };
      visitItems: { listByVisitIds: unknown };
    };
    r.patients = { get: async () => ({ id: 'p1' }) };
    r.visits.get = async () => v;
    r.visitItems.listByVisitIds = async () => lines;
    return createInvoiceService(repos);
  }

  beforeEach(async () => {
    rpc.mockReset();
    Object.defineProperty(navigator, 'onLine', { value: true, configurable: true });
    rpc.mockResolvedValue({ data: { id: 'inv-new', clinic_id: 'c1', total_paise: rs(800), invoice_no: 'X/1' }, error: null });
    await db.outbox.clear();
  });

  it('refuses to preview, issue or amend when 1 of its 2 lines is on this device', async () => {
    const svc = setupLines(visit({ invoiceId: null, serviceLinesCount: 2, actualBillPaise: rs(800) }), [line('l1', 0, rs(500))]);
    await expect(svc.previewLineItems(['v1'])).rejects.toThrow(ARRIVING);
    await expect(svc.issueForVisits(['v1'], 'Cash')).rejects.toThrow(ARRIVING);
    await expect(svc.amendInvoice('inv-old', ['v1'], 'Cash')).rejects.toThrow(ARRIVING);
    expect(rpc).not.toHaveBeenCalled();
  });

  it('bills the visit once all of its lines are here, and preview matches issue', async () => {
    const svc = setupLines(visit({ invoiceId: null, serviceLinesCount: 2, actualBillPaise: rs(800) }), [
      line('l1', 0, rs(500)),
      line('l2', 1, rs(300)),
    ]);
    const preview = await svc.previewLineItems(['v1']);
    expect(preview.totalPaise).toBe(rs(800));
    await svc.issueForVisits(['v1'], 'Cash');
    expect(rpc).toHaveBeenCalledWith('issue_invoice', expect.objectContaining({ p_total_paise: preview.totalPaise }));
  });

  it('leaves an older visit with no line count alone', async () => {
    const svc = setupLines(visit({ invoiceId: null }), []);
    const preview = await svc.previewLineItems(['v1']);
    expect(preview.totalPaise).toBe(rs(500));
    await svc.issueForVisits(['v1'], 'Cash');
    expect(rpc).toHaveBeenCalledTimes(1);
  });
});
