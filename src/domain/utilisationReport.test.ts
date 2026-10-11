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
});
