import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Invoice, InvoicePayment, Payment, Visit } from '@/domain/types';
import type { Repos } from '@/repositories/types';
import { rupeesToPaise as rs } from '@/domain/money';

const rpc = vi.fn();
vi.mock('@/lib/supabase', () => ({ getSupabase: () => ({ rpc }) }));

import { createInvoiceService } from './invoiceService';

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
      listByPackageGroup: async () => [],
      markInvoiced: async () => {},
    },
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
