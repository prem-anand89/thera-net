import { describe, expect, it } from 'vitest';
import { therapistUtilisation, visitInvolvement } from './utilisation';
import type { VisitItem } from './types';

const clinicHours = { startHour: 9, endHour: 17 }; // 480 min
const base = {
  therapistId: 't1',
  workingHours: null,
  clinicHours,
  closedWeekdays: [] as number[],
  closedDates: [] as { closedDate: string; label: string | null }[],
  slotMinutes: 30,
};
// 2026-10-12 is a Monday.
const visit = (date: string, over: Record<string, unknown> = {}) => ({
  therapistId: 't1',
  visitDate: date,
  sharedTherapistId: null,
  sharedPct: null,
  ...over,
});

describe('therapistUtilisation', () => {
  it('counts each visit as one slot against the day’s working minutes', () => {
    const r = therapistUtilisation({
      ...base,
      visits: [visit('2026-10-12'), visit('2026-10-12'), visit('2026-10-12'), visit('2026-10-12')],
      from: '2026-10-12',
      to: '2026-10-12',
    });
    expect(r.workedMinutes).toBe(120);
    expect(r.availableMinutes).toBe(480);
    expect(r.ratio).toBeCloseTo(0.25);
  });

  it('subtracts breaks using the therapist’s own hours', () => {
    const r = therapistUtilisation({
      ...base,
      workingHours: { '1': [[540, 780], [840, 1020]] }, // 9-1 and 2-5 → 420 min
      visits: [visit('2026-10-12')],
      from: '2026-10-12',
      to: '2026-10-12',
    });
    expect(r.availableMinutes).toBe(420);
    expect(r.usesClinicHours).toBe(false);
  });

  it('skips closed weekdays and holidays', () => {
    const r = therapistUtilisation({
      ...base,
      closedWeekdays: [0],
      closedDates: [{ closedDate: '2026-10-13', label: 'Holiday' }],
      visits: [],
      from: '2026-10-11', // Sunday (closed)
      to: '2026-10-13', // Tuesday (holiday)
    });
    expect(r.availableMinutes).toBe(480); // only Monday
  });

  it('caps each day at 100% so overlapping walk-ins do not exceed capacity', () => {
    const many = Array.from({ length: 20 }, () => visit('2026-10-12')); // 600 min > 480
    const r = therapistUtilisation({ ...base, visits: many, from: '2026-10-12', to: '2026-10-12' });
    expect(r.workedMinutes).toBe(480);
    expect(r.ratio).toBe(1);
  });

  it('keeps work on a day off out of the ratio but reports it', () => {
    const r = therapistUtilisation({
      ...base,
      workingHours: { '1': [[540, 1020]] }, // Monday only
      visits: [visit('2026-10-13'), visit('2026-10-13')], // Tuesday = off
      from: '2026-10-12',
      to: '2026-10-13',
    });
    expect(r.workedMinutes).toBe(0);
    expect(r.offHoursMinutes).toBe(60);
    expect(r.availableMinutes).toBe(480);
  });

  it('splits a shared visit by sharedPct between the two therapists', () => {
    const shared = visit('2026-10-12', { sharedTherapistId: 't2', sharedPct: 40 });
    const primary = therapistUtilisation({ ...base, visits: [shared], from: '2026-10-12', to: '2026-10-12' });
    const assist = therapistUtilisation({ ...base, therapistId: 't2', visits: [shared], from: '2026-10-12', to: '2026-10-12' });
    expect(primary.workedMinutes).toBeCloseTo(18);
    expect(assist.workedMinutes).toBeCloseTo(12);
  });

  it('ignores other therapists’ visits', () => {
    const r = therapistUtilisation({
      ...base,
      visits: [visit('2026-10-12', { therapistId: 't9' })],
      from: '2026-10-12',
      to: '2026-10-12',
    });
    expect(r.workedMinutes).toBe(0);
  });

  it('only counts the elapsed part of today and nothing after it', () => {
    const r = therapistUtilisation({
      ...base,
      visits: [visit('2026-10-12')],
      from: '2026-10-12',
      to: '2026-10-14',
      asOf: { date: '2026-10-12', minutes: 11 * 60 }, // 9:00-11:00 = 120 min elapsed
    });
    expect(r.availableMinutes).toBe(120);
  });

  it('returns a null ratio when there is no available time', () => {
    const r = therapistUtilisation({
      ...base,
      closedWeekdays: [1],
      visits: [],
      from: '2026-10-12',
      to: '2026-10-12',
    });
    expect(r.availableMinutes).toBe(0);
    expect(r.ratio).toBeNull();
  });

  it('flags when it fell back to clinic hours', () => {
    const r = therapistUtilisation({ ...base, visits: [], from: '2026-10-12', to: '2026-10-12' });
    expect(r.usesClinicHours).toBe(true);
  });
});

const line = (over: Partial<VisitItem> = {}): VisitItem => ({
  id: crypto.randomUUID(),
  clinicId: 'c',
  visitId: 'v',
  position: 0,
  serviceCatalogId: 's',
  serviceName: 'Svc',
  catalogPricePaise: 0,
  pricePaise: 0,
  assistingTherapistId: null,
  durationMinutes: null,
  isPackageLine: false,
  deleted: false,
  updatedAt: '',
  ...over,
});
const run = (therapistId: string, visits: ReturnType<typeof visit>[]) =>
  therapistUtilisation({ ...base, therapistId, visits, from: '2026-10-12', to: '2026-10-12' });

describe('utilisation from service lines', () => {
  it('assistant time counts on a zero-bill visit', () => {
    const v = visit('2026-10-12', { items: [line({ assistingTherapistId: 't2' })], sittingMinutes: 45 });
    expect(run('t2', [v]).workedMinutes).toBe(45);
    expect(run('t1', [v]).workedMinutes).toBe(0); // primary delivered nothing
  });

  it('service durations replace the sitting when every line has one', () => {
    const v = visit('2026-10-12', {
      items: [line({ durationMinutes: 20 }), line({ durationMinutes: 10 }), line({ assistingTherapistId: 't2', durationMinutes: 15 })],
      sittingMinutes: 60,
    });
    expect(run('t1', [v]).workedMinutes).toBe(30);
    expect(run('t2', [v]).workedMinutes).toBe(15);
  });

  it('caps at the sitting and counts it once when a duration is missing', () => {
    const capped = visit('2026-10-12', { items: [line({ durationMinutes: 40 }), line({ durationMinutes: 40 })], sittingMinutes: 45 });
    expect(run('t1', [capped]).workedMinutes).toBe(45);
    const missing = visit('2026-10-12', { items: [line({ durationMinutes: 10 }), line()], sittingMinutes: 45 });
    expect(run('t1', [missing]).workedMinutes).toBe(45);
  });

  it('uses the clinic slot when no sitting is given, and ignores deleted lines', () => {
    const v = visit('2026-10-12', { items: [line(), line({ assistingTherapistId: 't2', deleted: true })] });
    expect(run('t1', [v]).workedMinutes).toBe(30);
    expect(run('t2', [v]).workedMinutes).toBe(0);
  });

  it('legacy visits keep today’s utilisation exactly', () => {
    const legacy = visit('2026-10-12', { sharedTherapistId: 't2', sharedPct: 40 });
    expect(run('t1', [legacy]).workedMinutes).toBeCloseTo(18);
    expect(run('t2', [legacy]).workedMinutes).toBeCloseTo(12);
    const allDeleted = visit('2026-10-12', { items: [line({ deleted: true })], sittingMinutes: 90 });
    expect(run('t1', [allDeleted]).workedMinutes).toBe(30);
  });
});

describe('visitInvolvement', () => {
  it('counts a primary who also delivers once, and flags assistants', () => {
    const v = visit('2026-10-12', { items: [line(), line({ assistingTherapistId: 't2' })] });
    expect(visitInvolvement(v, 't1')).toEqual({ treated: true, assisted: false });
    expect(visitInvolvement(v, 't2')).toEqual({ treated: true, assisted: true });
    expect(visitInvolvement(v, 't3')).toEqual({ treated: false, assisted: false });
  });
  it('legacy: only the primary is treated', () => {
    const v = visit('2026-10-12', { sharedTherapistId: 't2', sharedPct: 40 });
    expect(visitInvolvement(v, 't1').treated).toBe(true);
    expect(visitInvolvement(v, 't2')).toEqual({ treated: false, assisted: false });
  });
});
