import { describe, expect, it } from 'vitest';
import { clinicUtilisationReport, type ReportTherapist } from './utilisationReport';

const bucket = { key: 'oct', label: 'Oct', from: '2026-10-12', to: '2026-10-12' }; // one Monday
const therapists: ReportTherapist[] = [
  { id: 'a', name: 'A', active: true },
  { id: 'b', name: 'B', active: true },
  { id: 'gone', name: 'Gone', active: false },
];
const visit = (therapistId: string, visitDate = '2026-10-12') => ({ therapistId, visitDate, sharedTherapistId: null, sharedPct: null });
const common = {
  buckets: [bucket],
  therapists,
  clinicHours: { startHour: 9, endHour: 17 },
  closedDates: [],
  slotMinutes: 30,
  asOf: { date: '2026-12-31', minutes: 0 },
};

describe('clinicUtilisationReport', () => {
  it('pools work and available time across therapists for the clinic figure', () => {
    // A: 8 visits = 240 of 480; B: 0 of 480 → clinic 240 / 960 = 25%
    const r = clinicUtilisationReport({ ...common, visits: Array.from({ length: 8 }, () => visit('a')) });
    expect(r[0].clinicRatio).toBeCloseTo(0.25);
    expect(r[0].rows.find((x) => x.therapistId === 'a')?.utilisation.ratio).toBeCloseTo(0.5);
  });

  it('omits an inactive therapist with no work in the period', () => {
    const r = clinicUtilisationReport({ ...common, visits: [visit('a')] });
    expect(r[0].rows.map((x) => x.therapistId)).toEqual(['a', 'b']);
  });

  it('keeps an inactive therapist who did work in the period', () => {
    const r = clinicUtilisationReport({ ...common, visits: [visit('gone')] });
    expect(r[0].rows.map((x) => x.therapistId)).toContain('gone');
  });

  it('only counts visits inside the bucket', () => {
    const r = clinicUtilisationReport({ ...common, visits: [visit('a', '2026-09-30')] });
    expect(r[0].rows.find((x) => x.therapistId === 'a')?.visitCount).toBe(0);
  });

  it('gives a null clinic ratio when nothing was available', () => {
    const r = clinicUtilisationReport({ ...common, closedWeekdays: [1], visits: [] });
    expect(r[0].clinicRatio).toBeNull();
  });

  it('calculates total revenue per therapist and for the clinic, and includes photoPath', () => {
    const therapistsWithPhoto: ReportTherapist[] = [
      { id: 'a', name: 'A', active: true, photoPath: 'clinics/1/photo.jpg' },
      { id: 'b', name: 'B', active: true },
    ];
    const visitsWithBill = [
      { ...visit('a'), actualBillPaise: 50000 },
      { ...visit('a'), actualBillPaise: 100000 },
      { ...visit('b'), actualBillPaise: 80000 },
    ];
    const r = clinicUtilisationReport({
      ...common,
      therapists: therapistsWithPhoto,
      visits: visitsWithBill,
    });
    expect(r[0].clinicRevenuePaise).toBe(230000);
    const rowA = r[0].rows.find((x) => x.therapistId === 'a');
    const rowB = r[0].rows.find((x) => x.therapistId === 'b');
    expect(rowA?.revenuePaise).toBe(150000);
    expect(rowA?.photoPath).toBe('clinics/1/photo.jpg');
    expect(rowB?.revenuePaise).toBe(80000);
    expect(rowB?.photoPath).toBeUndefined();
  });

  it('computes priorClinicRatio and priorClinicRevenuePaise across sequential buckets', () => {
    const bucket1 = { key: 'sep', label: 'Sep', from: '2026-09-14', to: '2026-09-14' };
    const bucket2 = { key: 'oct', label: 'Oct', from: '2026-10-12', to: '2026-10-12' };
    const visits = [
      { ...visit('a', '2026-09-14'), actualBillPaise: 100000 },
      { ...visit('a', '2026-10-12'), actualBillPaise: 200000 },
    ];
    const r = clinicUtilisationReport({
      ...common,
      buckets: [bucket1, bucket2],
      visits,
    });
    expect(r[0].priorClinicRatio).toBeNull();
    expect(r[0].priorClinicRevenuePaise).toBeNull();
    expect(r[1].priorClinicRatio).toBe(r[0].clinicRatio);
    expect(r[1].priorClinicRevenuePaise).toBe(100000);
  });

  it('computes clinicWorkedMinutes and clinicAvailableMinutes with prior comparisons', () => {
    const bucket1 = { key: 'sep', label: 'Sep', from: '2026-09-14', to: '2026-09-14' };
    const bucket2 = { key: 'oct', label: 'Oct', from: '2026-10-12', to: '2026-10-12' };
    // A: 4 visits = 120 mins worked; B: 0 visits; each 480 mins available -> 120 worked of 960 available
    const visits = [
      ...Array.from({ length: 4 }, () => visit('a', '2026-09-14')),
      ...Array.from({ length: 8 }, () => visit('a', '2026-10-12')), // 240 mins worked
    ];
    const r = clinicUtilisationReport({
      ...common,
      buckets: [bucket1, bucket2],
      visits,
    });
    expect(r[0].clinicWorkedMinutes).toBe(120);
    expect(r[0].clinicAvailableMinutes).toBe(960);
    expect(r[0].priorClinicWorkedMinutes).toBeNull();
    expect(r[0].priorClinicAvailableMinutes).toBeNull();

    expect(r[1].clinicWorkedMinutes).toBe(240);
    expect(r[1].clinicAvailableMinutes).toBe(960);
    expect(r[1].priorClinicWorkedMinutes).toBe(120);
    expect(r[1].priorClinicAvailableMinutes).toBe(960);
  });
});


describe('clinicUtilisationReport with service lines', () => {
  const mk = (over: Record<string, unknown> = {}) => ({
    id: 'i', clinicId: 'c', visitId: 'v', position: 0, serviceCatalogId: 's', serviceName: 'S',
    catalogPricePaise: 0, pricePaise: 0, assistingTherapistId: null, durationMinutes: null,
    isPackageLine: false, deleted: false, updatedAt: '', ...over,
  });
  it('patients treated counts assisted visits once; the clinic visit total does not change', () => {
    const v = { ...visit('a'), items: [mk(), mk({ assistingTherapistId: 'b' })] as never, actualBillPaise: 1000 };
    const r = clinicUtilisationReport({ ...common, visits: [v, visit('a')] });
    const a = r[0].rows.find((x) => x.therapistId === 'a')!;
    const b = r[0].rows.find((x) => x.therapistId === 'b')!;
    expect(a).toMatchObject({ visitCount: 2, patientsTreated: 2, assistedVisitCount: 0 });
    expect(b).toMatchObject({ visitCount: 0, patientsTreated: 1, assistedVisitCount: 1 });
    expect(r[0].clinicRevenuePaise).toBe(1000);
  });
  it('keeps an inactive assistant who delivered a line', () => {
    const v = { ...visit('a'), items: [mk({ assistingTherapistId: 'gone' })] as never };
    const r = clinicUtilisationReport({ ...common, visits: [v] });
    expect(r[0].rows.map((x) => x.therapistId)).toContain('gone');
  });
});
