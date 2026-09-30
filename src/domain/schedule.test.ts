import { describe, expect, it } from 'vitest';
import { addWeeks, appointmentsOverlap, belongsToColumn, countByDate, filterHistory, generateScheduleSlots, getWeekStart, isTherapistSlotOccupied, localDateTime, toLocalDateStr, weekDays } from './schedule';
import type { Appointment, UUID } from './types';

describe('schedule helpers', () => {
  it('uses local calendar dates', () => {
    expect(toLocalDateStr(new Date(2026, 8, 30))).toBe('2026-09-30');
  });

  it('finds Monday at month and year boundaries', () => {
    expect(getWeekStart('2027-01-03')).toBe('2026-12-28');
    expect(weekDays('2027-01-03')).toEqual([
      '2026-12-28', '2026-12-29', '2026-12-30', '2026-12-31',
      '2027-01-01', '2027-01-02', '2027-01-03',
    ]);
    expect(addWeeks('2027-01-03', 1)).toBe('2027-01-04');
  });

  it('generates minute-continuous 45 minute slots', () => {
    expect(generateScheduleSlots(45, 9, 12).map((slot) => slot.time)).toEqual([
      '09:00', '09:45', '10:30', '11:15',
    ]);
  });

  it('detects overlapping time ranges correctly', () => {
    const candidateStart = localDateTime('2026-10-01', '10:00');
    // candidate is 10:00 to 10:30 (30 min duration)
    
    // Exact match
    expect(appointmentsOverlap({ status: 'confirmed', scheduledAt: localDateTime('2026-10-01', '10:00').toISOString() } as Appointment, candidateStart, 30)).toBe(true);
    
    // Starts before, ends inside
    expect(appointmentsOverlap({ status: 'confirmed', scheduledAt: localDateTime('2026-10-01', '09:45').toISOString() } as Appointment, candidateStart, 30)).toBe(true);
    
    // Starts inside, ends after
    expect(appointmentsOverlap({ status: 'confirmed', scheduledAt: localDateTime('2026-10-01', '10:15').toISOString() } as Appointment, candidateStart, 30)).toBe(true);
    
    // Spans entirely across
    expect(appointmentsOverlap({ status: 'confirmed', scheduledAt: localDateTime('2026-10-01', '09:45').toISOString() } as Appointment, candidateStart, 60)).toBe(true);
    
    // Just touches boundaries (no overlap)
    expect(appointmentsOverlap({ status: 'confirmed', scheduledAt: localDateTime('2026-10-01', '09:30').toISOString() } as Appointment, candidateStart, 30)).toBe(false);
    expect(appointmentsOverlap({ status: 'confirmed', scheduledAt: localDateTime('2026-10-01', '10:30').toISOString() } as Appointment, candidateStart, 30)).toBe(false);
    
    // Cancelled appointments don't overlap
    expect(appointmentsOverlap({ status: 'cancelled', scheduledAt: localDateTime('2026-10-01', '10:00').toISOString() } as Appointment, candidateStart, 30)).toBe(false);
  });

  it('determines if a therapist slot is occupied', () => {
    const therapistId = 't1' as UUID;
    const appointments: Appointment[] = [
      { id: 'a1' as UUID, status: 'confirmed', scheduledAt: localDateTime('2026-10-01', '10:15').toISOString(), therapistId } as Appointment,
      { id: 'a2' as UUID, status: 'confirmed', scheduledAt: localDateTime('2026-10-01', '11:00').toISOString(), therapistId: 't2' as UUID } as Appointment,
    ];
    
    // 10:00 - 10:30 is occupied by a1 (starts at 10:15)
    expect(isTherapistSlotOccupied(appointments, therapistId, '2026-10-01', '10:00', 30)).toBe(true);
    // 10:30 - 11:00 is occupied by a1 (10:15 + 30 min = 10:45)
    expect(isTherapistSlotOccupied(appointments, therapistId, '2026-10-01', '10:30', 30)).toBe(true);
    // 11:00 is not occupied for t1
    expect(isTherapistSlotOccupied(appointments, therapistId, '2026-10-01', '11:00', 30)).toBe(false);
    // 11:00 is occupied for t2
    expect(isTherapistSlotOccupied(appointments, 't2' as UUID, '2026-10-01', '11:00', 30)).toBe(true);
  });
});

describe('schedule grouping and history', () => {
  const mk = (over: Partial<Appointment>) =>
    ({
      id: 'a', patientName: 'Asha Rao', patientPhone: '98200', status: 'confirmed',
      therapistId: 't1', scheduledAt: localDateTime('2026-09-20', '10:00').toISOString(), ...over,
    }) as Appointment;
  const known = new Map([['t1', 'Dr A']]);

  it('week strip days are Monday to Sunday and Sunday belongs to the prior Monday', () => {
    const days = weekDays('2026-10-04'); // a Sunday
    expect(days[0]).toBe('2026-09-28');
    expect(days).toHaveLength(7);
    expect(days[6]).toBe('2026-10-04');
    expect(addWeeks('2026-10-04', 1)).toBe('2026-10-05');
  });

  it('week rollover across a year boundary', () => {
    expect(weekDays('2026-12-31')[0]).toBe('2026-12-28');
    expect(weekDays('2026-12-31')[6]).toBe('2027-01-03');
  });

  it('counts appointments per date', () => {
    const counts = countByDate(['2026-09-20', '2026-09-20', '2026-09-21']);
    expect(counts.get('2026-09-20')).toBe(2);
    expect(counts.get('2026-09-22')).toBeUndefined();
  });

  it('routes unknown or missing therapists to the Unassigned column', () => {
    expect(belongsToColumn(mk({}), 't1', known)).toBe(true);
    expect(belongsToColumn(mk({}), '', known)).toBe(false);
    expect(belongsToColumn(mk({ therapistId: null }), '', known)).toBe(true);
    expect(belongsToColumn(mk({ therapistId: 'gone' as UUID }), '', known)).toBe(true);
  });

  it('filters history by date, status, therapist and text', () => {
    const rows = [
      mk({ id: '1' }),
      mk({ id: '2', status: 'cancelled', patientName: 'Ben' }),
      mk({ id: '3', therapistId: 't2' as UUID, patientPhone: '77700' }),
      mk({ id: '4', scheduledAt: localDateTime('2026-08-01', '10:00').toISOString() }),
    ];
    const base = { from: '2026-09-01', query: '', status: '', therapistId: '' };
    expect(filterHistory(rows, base).map((r) => r.id).sort()).toEqual(['1', '2', '3']);
    expect(filterHistory(rows, { ...base, status: 'cancelled' }).map((r) => r.id)).toEqual(['2']);
    expect(filterHistory(rows, { ...base, therapistId: 't2' }).map((r) => r.id)).toEqual(['3']);
    expect(filterHistory(rows, { ...base, query: '777' }).map((r) => r.id)).toEqual(['3']);
    expect(filterHistory(rows, { ...base, query: 'ben' }).map((r) => r.id)).toEqual(['2']);
  });
});
