import { describe, expect, it } from 'vitest';
import type { Invoice } from './types';
import { buildHospitalSlip, hasHospitalSlip } from './hospitalSlip';

const invoice = {
  invoiceNo: 'BM/26-27/0042',
  patientSnapshot: { name: 'Asha', mrno: 'W26-0001' },
  totalPaise: 450000,
  therapistId: 't1',
  lineItems: [
    { serviceName: 'Chest physio', sessionDates: ['2026-11-03', '2026-11-01', '2026-11-02'], billedSessionCount: 3, totalPaise: 300000, therapistIds: ['t1', 't2'] },
    { serviceName: 'Gait training', sessionDates: ['2026-11-04'], totalPaise: 150000 },
  ],
  clinicalSnapshot: { placeOfService: 'ward', admission: { ipdNo: 'IP-7', wardBed: 'Ortho, bed 2', admittingDoctor: 'Dr Rao', admittedOn: '2026-11-01', dischargedOn: '2026-11-05' } },
} as unknown as Invoice;

describe('buildHospitalSlip', () => {
  const slip = buildHospitalSlip(invoice, [{ id: 't1', name: 'Kiran' }, { id: 't2', name: 'Prem' }]);

  it('has one row per bill line with its dates, sessions, therapists and charge, summing to the bill total', () => {
    expect(slip.rows.map((r) => [r.service, r.sessions, r.therapist, r.chargePaise])).toEqual([
      ['Chest physio', 3, 'Kiran, Prem', 300000],
      ['Gait training', 1, 'Kiran', 150000],
    ]);
    expect(slip.rows[0].dates).toBe('01/11/26 – 03/11/26');
    expect(slip.rows[1].dates).toBe('04/11/26');
    expect(slip.rows.reduce((s, r) => s + r.chargePaise, 0)).toBe(slip.totalPaise);
  });

  it('carries the stay from the bill itself, and lists each therapist once for the signatures', () => {
    expect(slip.stayRows.map((r) => r.label)).toEqual(['IPD No', 'Ward / Bed', 'Admitting Doctor', 'Stay']);
    expect(slip.therapists).toEqual(['Kiran', 'Prem']);
    expect(slip.invoiceNo).toBe('BM/26-27/0042');
  });
});

describe('therapist names', () => {
  it('a name containing a comma stays one signature line', () => {
    const slip = buildHospitalSlip(
      { ...invoice, lineItems: [{ serviceName: 'x', sessionDates: ['2026-11-01'], totalPaise: 1, therapistIds: ['t9'] }] } as unknown as Invoice,
      [{ id: 't9', name: 'Dr. Rao, MPT' }]
    );
    expect(slip.therapists).toEqual(['Dr. Rao, MPT']);
  });
});

describe('hasHospitalSlip', () => {
  it('is for a bill with a stay or an Inpatient place of service, not an ordinary bill', () => {
    expect(hasHospitalSlip(invoice)).toBe(true);
    expect(hasHospitalSlip({ clinicalSnapshot: { placeOfService: 'ward' } } as unknown as Invoice)).toBe(true);
    expect(hasHospitalSlip({ clinicalSnapshot: { placeOfService: 'clinic' } } as unknown as Invoice)).toBe(false);
    expect(hasHospitalSlip({ clinicalSnapshot: null } as unknown as Invoice)).toBe(false);
  });
});
