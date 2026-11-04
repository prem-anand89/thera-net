import { describe, expect, it } from 'vitest';
import { buildCoverage, calculateDailyCoverage, clinicSessionsOn, describeSchedule, hoursAfterShiftAssign, uncoveredSessions } from './shiftUtils';
import type { ShiftTemplate, Therapist, TherapistShiftAssignment } from '@/domain/types';

const splitClinic = {
  bookingStartHour: 9,
  bookingEndHour: 20,
  closedWeekdays: [0],
  // Mon–Sat: 9–1 and 4–8 (closed for lunch)
  operatingHours: Object.fromEntries([1, 2, 3, 4, 5, 6].map((d) => [String(d), [[540, 780], [960, 1200]]])),
};

const morning: ShiftTemplate = {
  id: 'm', clinicId: 'c1', name: 'Morning', startMinute: 540, endMinute: 1020,
  breakDurationMinutes: 30, defaultBreakStartMinute: 780, active: true, updatedAt: '',
};
const evening: ShiftTemplate = {
  id: 'e', clinicId: 'c1', name: 'Evening', startMinute: 960, endMinute: 1260,
  breakDurationMinutes: 0, defaultBreakStartMinute: null, active: true, updatedAt: '',
};

function row(id: string, templateId: string | null, weekdays: number[] | null, createdAt = '2026-10-01'): TherapistShiftAssignment {
  return {
    id, clinicId: 'c1', therapistId: 't1', shiftTemplateId: templateId, customHours: templateId ? null : {},
    weekdays, breakStartMinute: null, status: 'approved', createdAt, updatedAt: createdAt,
  } as TherapistShiftAssignment;
}

describe('clinicSessionsOn', () => {
  it('reads the two sessions of a clinic that closes for lunch', () => {
    expect(clinicSessionsOn(splitClinic, 1)).toEqual([[540, 780], [960, 1200]]);
  });
  it('falls back to the one block when no sessions are stored, and is empty on a closed day', () => {
    const plain = { bookingStartHour: 9, bookingEndHour: 17, closedWeekdays: [0] };
    expect(clinicSessionsOn(plain, 2)).toEqual([[540, 1020]]);
    expect(clinicSessionsOn(plain, 0)).toEqual([]);
  });
});

describe('coverage with split clinic hours', () => {
  const therapist = { id: 't1', clinicId: 'c1', name: 'Asha', active: true, updatedAt: '', workingHours: null } as Therapist;

  it('counts 9–1 and 4–8 as 8 hours, not 11', () => {
    const map = buildCoverage([therapist], [], [], splitClinic);
    const mon = map.get('t1')!.get(1)!;
    expect(mon.type).toBe('clinic_default');
    expect(mon.workingMinutes).toBe(480);
    expect(mon.label).toBe('9–1 & 4–8');
    expect(calculateDailyCoverage(1, map, false).capacityHours).toBe(8);
  });

  it('describes the same sessions on the Team card', () => {
    expect(describeSchedule(therapist, [], [], splitClinic).summary).toBe('Mon–Sat 9–1 & 4–8');
  });
});

describe('hoursAfterShiftAssign', () => {
  it('keeps another shift type on other days and replaces the overlapping days', () => {
    const hours = hoursAfterShiftAssign({
      therapistId: 't1',
      approved: [row('a1', 'm', [1, 2, 3]), row('a2', 'e', [4, 5])],
      templates: [morning, evening],
      template: evening,
      weekdays: [3],
      breakStartMinute: null,
    }) as Record<string, [number, number][]>;
    expect(hours['1']).toEqual([[540, 780], [810, 1020]]);
    expect(hours['3']).toEqual([[960, 1260]]);
    expect(hours['4']).toEqual([[960, 1260]]);
    expect(hours['6']).toBeUndefined();
  });

  it('drops the edited row entirely when told which one it replaces (Saturday goes off)', () => {
    const approved = [row('a1', 'm', [1, 2, 3, 4, 5, 6])];
    const base = { therapistId: 't1', approved, templates: [morning], template: morning, weekdays: [1, 2, 3, 4, 5], breakStartMinute: null };
    expect((hoursAfterShiftAssign(base) as Record<string, unknown>)['6']).toBeDefined(); // what the server does today
    expect((hoursAfterShiftAssign({ ...base, replacesId: 'a1' }) as Record<string, unknown>)['6']).toBeUndefined();
  });

  it('starts from nothing when the therapist is on own hours', () => {
    const hours = hoursAfterShiftAssign({
      therapistId: 't1',
      approved: [row('c', null, null)],
      templates: [morning],
      template: morning,
      weekdays: [2],
      breakStartMinute: null,
    });
    expect(Object.keys(hours)).toEqual(['2']);
  });
});

describe('uncoveredSessions', () => {
  const t1 = { id: 't1', clinicId: 'c1', name: 'Asha', active: true, updatedAt: '', workingHours: null } as Therapist;
  const morningOnly: ShiftTemplate = {
    id: 'mo', clinicId: 'c1', name: 'Morning', startMinute: 540, endMinute: 780,
    breakDurationMinutes: 0, defaultBreakStartMinute: null, active: true, updatedAt: '',
  };

  it('flags the evening session when the only shift ends at lunch', () => {
    const map = buildCoverage([t1], [row('a', 'mo', [1])], [morningOnly], splitClinic);
    expect(uncoveredSessions(1, map, splitClinic)).toEqual(['Evening']);
  });

  it('is empty when someone covers both sessions, on a one-session clinic, and on a closed day', () => {
    const covered = buildCoverage([t1], [], [], splitClinic); // clinic hours = both sessions
    expect(uncoveredSessions(1, covered, splitClinic)).toEqual([]);
    const plain = { bookingStartHour: 9, bookingEndHour: 17, closedWeekdays: [0] };
    expect(uncoveredSessions(1, buildCoverage([t1], [], [], plain), plain)).toEqual([]);
    expect(uncoveredSessions(0, covered, splitClinic)).toEqual([]);
  });
});
