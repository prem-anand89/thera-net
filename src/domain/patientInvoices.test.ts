import { describe, expect, it } from 'vitest';
import { invoicesForPatient } from './patientInvoices';
import type { Invoice } from './types';

const inv = (id: string, issuedAt: string, snapshotPatientId?: string) =>
  ({ id, issuedAt, patientSnapshot: { name: 'X', mrno: 'M', patientId: snapshotPatientId } }) as unknown as Invoice;

describe('invoicesForPatient', () => {
  const visits = [
    { invoiceId: 'old', patientId: 'p1', deleted: false },
    { invoiceId: 'other', patientId: 'p2', deleted: false },
    { invoiceId: 'gone', patientId: 'p1', deleted: true },
    { invoiceId: 'both', patientId: 'p1', deleted: false },
    { invoiceId: null, patientId: 'p1', deleted: false },
  ];

  it('finds a bill by the id in its snapshot', () => {
    expect(invoicesForPatient('p1', [inv('new', '2026-11-01', 'p1')], []).map((i) => i.id)).toEqual(['new']);
  });

  it('finds an older bill only through its visits', () => {
    expect(invoicesForPatient('p1', [inv('old', '2026-10-01')], visits).map((i) => i.id)).toEqual(['old']);
  });

  it('leaves out another patient\'s bill and a bill whose visit was deleted', () => {
    const all = [inv('other', '2026-10-02', 'p2'), inv('gone', '2026-10-03')];
    expect(invoicesForPatient('p1', all, visits)).toEqual([]);
  });

  it('lists a bill matched both ways once, newest first', () => {
    const all = [inv('old', '2026-09-01'), inv('both', '2026-11-02', 'p1'), inv('both', '2026-11-02', 'p1'), inv('new', '2026-10-15', 'p1')];
    expect(invoicesForPatient('p1', all, visits).map((i) => i.id)).toEqual(['both', 'new', 'old']);
  });
});
