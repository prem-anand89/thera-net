import { describe, expect, it } from 'vitest';
import { patientDue } from './patientDue';

const visit = (id: string, bill: number, extra: { invoiceId?: string | null; deleted?: boolean } = {}) => ({
  id,
  deleted: extra.deleted ?? false,
  actualBillPaise: bill * 100,
  invoiceId: extra.invoiceId ?? null,
});

describe('patientDue', () => {
  it('is zero when everything is collected or free', () => {
    const out = patientDue([visit('a', 1500), visit('b', 0)], new Map([['a', 150000]]), new Map());
    expect(out).toEqual({ duePaise: 0, unpaidVisits: 0 });
  });

  it('counts an unpaid visit in full and a part-paid one for the rest', () => {
    const out = patientDue([visit('a', 1500), visit('b', 2000)], new Map([['b', 50000]]), new Map());
    expect(out).toEqual({ duePaise: 150000 + 150000, unpaidVisits: 2 });
  });

  it('counts an invoice marked outstanding, but not one marked paid', () => {
    const owed = patientDue([visit('a', 1000, { invoiceId: 'i1' })], new Map(), new Map([['i1', 'outstanding']]));
    expect(owed).toEqual({ duePaise: 100000, unpaidVisits: 1 });
    const paid = patientDue([visit('a', 1000, { invoiceId: 'i1' })], new Map(), new Map([['i1', 'paid']]));
    expect(paid).toEqual({ duePaise: 0, unpaidVisits: 0 });
  });

  it('ignores deleted visits', () => {
    expect(patientDue([visit('a', 1500, { deleted: true })], new Map(), new Map())).toEqual({ duePaise: 0, unpaidVisits: 0 });
  });
});
