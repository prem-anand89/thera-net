import { describe, expect, it } from 'vitest';
import { addWeeks, withinWorking, workingHoursProblem, workingIntervals, firstAvailableSlot, nextAppointmentFor, patientAttendance, appointmentsOverlap, assignLanes, belongsToColumn, blockGeometry, countByDate, filterHistory, formatMinutes, freeGaps, generateScheduleSlots, getWeekStart, groupClosedRanges, isClosedDay, isPublicSlotTaken, isTherapistSlotOccupied, localDateTime, toLocalDateStr, weekDays } from './schedule';
import type { Appointment, UUID } from './types';

const at = (date: string, time: string) => localDateTime(date, time).toISOString();

function appt(over: Partial<Appointment>): Appointment {
  return {
    id: 'a', clinicId: 'c', patientId: null, patientName: 'P', patientPhone: '1', therapistId: 't1',
    scheduledAt: at('2026-10-01', '10:00'), status: 'confirmed', requestId: null, visitId: null,
    rescheduleCount: 0, previousScheduledAt: null, createdAt: '', updatedAt: '', ...over,
  } as Appointment;
}

describe('duration-aware scheduling', () => {
  it('uses each appointment’s own length for overlap', () => {
    const long = appt({ durationMinutes: 60 }); // 10:00–11:00
    expect(appointmentsOverlap(long, localDateTime('2026-10-01', '10:30'), 30)).toBe(true);
    expect(appointmentsOverlap(long, localDateTime('2026-10-01', '11:00'), 30)).toBe(false);
    // A cached row without a length falls back to the clinic slot.
    expect(appointmentsOverlap(appt({}), localDateTime('2026-10-01', '10:30'), 30, 30)).toBe(false);
    expect(appointmentsOverlap(appt({}), localDateTime('2026-10-01', '10:30'), 30, 45)).toBe(true);
  });

  it('can ignore the appointment being rescheduled', () => {
    const rows = [appt({ id: 'move-me', durationMinutes: 30 })];
    expect(isTherapistSlotOccupied(rows, 't1', '2026-10-01', '10:00', 30)).toBe(true);
    expect(isTherapistSlotOccupied(rows, 't1', '2026-10-01', '10:00', 30, { ignoreAppointmentId: 'move-me' })).toBe(false);
  });

  it('finds free gaps inside booking hours, skipping cancelled and past time', () => {
    const rows = [
      appt({ id: '1', scheduledAt: at('2026-10-01', '10:00'), durationMinutes: 45 }),
      appt({ id: '2', scheduledAt: at('2026-10-01', '11:30'), durationMinutes: 30, status: 'cancelled' }),
      appt({ id: '3', scheduledAt: at('2026-10-01', '09:00'), therapistId: 't2' as UUID }),
    ];
    const hours = { startHour: 9, endHour: 12 };
    expect(freeGaps(rows, 't1', '2026-10-01', hours, 30)).toEqual([
      { start: 540, end: 600 },
      { start: 645, end: 720 },
    ]);
    expect(freeGaps(rows, 't1', '2026-10-01', hours, 30, { notBefore: 690 })).toEqual([{ start: 690, end: 720 }]);
    expect(freeGaps(rows, 't1', '2026-10-01', hours, 30, { minMinutes: 70 })).toEqual([{ start: 645, end: 720 }]);
  });

  it('computes block geometry with a minimum height', () => {
    expect(blockGeometry(600, 45, 9, 1.6)).toEqual({ top: 96, height: 72 });
    expect(blockGeometry(540, 5, 9, 1.6)).toEqual({ top: 0, height: 18 });
  });

  it('assigns side-by-side lanes only to overlapping blocks', () => {
    const lanes = assignLanes([
      { id: 'a', start: 600, end: 660 },
      { id: 'b', start: 630, end: 690 },
      { id: 'c', start: 700, end: 730 },
    ]);
    expect(lanes.get('a')).toEqual({ lane: 0, lanes: 2 });
    expect(lanes.get('b')).toEqual({ lane: 1, lanes: 2 });
    expect(lanes.get('c')).toEqual({ lane: 0, lanes: 1 });
  });

  it('formats minute totals', () => {
    expect(formatMinutes(45)).toBe('45m');
    expect(formatMinutes(120)).toBe('2h');
    expect(formatMinutes(270)).toBe('4h30');
  });
});

describe('closures', () => {
  it('detects holidays before weekly closed days', () => {
    const holidays = [{ closedDate: '2026-10-04', label: 'Event' }];
    expect(isClosedDay('2026-10-04', [0], holidays)).toEqual({ closed: true, kind: 'holiday', label: 'Event' });
    expect(isClosedDay('2026-10-11', [0], holidays)).toEqual({ closed: true, kind: 'weekday', label: null });
    expect(isClosedDay('2026-10-05', [0], holidays).closed).toBe(false);
    expect(isClosedDay('2026-10-05', undefined, []).closed).toBe(false);
  });

  it('groups consecutive same-label dates into ranges', () => {
    expect(
      groupClosedRanges([
        { closedDate: '2026-11-02', label: 'Diwali' },
        { closedDate: '2026-11-01', label: 'Diwali' },
        { closedDate: '2026-11-03', label: 'Diwali' },
        { closedDate: '2026-11-04', label: null },
        { closedDate: '2026-12-25', label: 'Christmas' },
      ])
    ).toEqual([
      { from: '2026-11-01', to: '2026-11-03', label: 'Diwali' },
      { from: '2026-11-04', to: '2026-11-04', label: null },
      { from: '2026-12-25', to: '2026-12-25', label: 'Christmas' },
    ]);
  });
});

describe('public booking availability', () => {
  const booked = [
    { scheduledAt: at('2026-10-01', '10:00'), therapistId: 't1', durationMinutes: 60 },
    { scheduledAt: at('2026-10-01', '10:00'), therapistId: 't2', durationMinutes: 30 },
  ];
  it('blocks a time for a preferred therapist across the booking’s whole length', () => {
    expect(isPublicSlotTaken('2026-10-01', 630, 30, booked, ['t1', 't2'], 't1')).toBe(true);
    expect(isPublicSlotTaken('2026-10-01', 630, 30, booked, ['t1', 't2'], 't2')).toBe(false);
  });
  it('without a preference, a time is taken only when every therapist is busy', () => {
    expect(isPublicSlotTaken('2026-10-01', 600, 30, booked, ['t1', 't2'], null)).toBe(true);
    expect(isPublicSlotTaken('2026-10-01', 630, 30, booked, ['t1', 't2'], null)).toBe(false);
    expect(isPublicSlotTaken('2026-10-02', 600, 30, booked, ['t1', 't2'], null)).toBe(false);
  });
});

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

describe('slot-aligned free time', () => {
  it('rounds gap starts after odd-length bookings and "now" onto the slot grid', () => {
    const rows = [appt({ id: '1', scheduledAt: at('2026-10-01', '10:00'), durationMinutes: 45 })];
    const hours = { startHour: 9, endHour: 12 };
    expect(freeGaps(rows, 't1', '2026-10-01', hours, 30, { alignToSlots: true })).toEqual([
      { start: 540, end: 600 },
      { start: 660, end: 720 }, // 10:45 -> 11:00
    ]);
    expect(freeGaps(rows, 't1', '2026-10-01', hours, 30, { alignToSlots: true, notBefore: 550 })).toEqual([
      { start: 570, end: 600 }, // 9:10 -> 9:30
      { start: 660, end: 720 },
    ]);
  });
});

describe('patient history helpers', () => {
  const now = localDateTime('2026-10-01', '12:00');
  const rows = [
    appt({ id: 'a1', patientId: 'p1', status: 'no_show', scheduledAt: at('2026-09-01', '10:00') }),
    appt({ id: 'a2', patientId: null, patientPhone: '+91 98200 00001', status: 'no_show', scheduledAt: at('2026-09-10', '10:00') }),
    appt({ id: 'a3', patientId: 'p1', status: 'cancelled', scheduledAt: at('2026-09-12', '10:00') }),
    appt({ id: 'a4', patientId: 'p1', status: 'arrived', scheduledAt: at('2026-09-20', '10:00') }),
    appt({ id: 'a5', patientId: 'p1', status: 'no_show', scheduledAt: at('2026-01-01', '10:00') }), // too old
    appt({ id: 'a6', patientId: 'p1', status: 'confirmed', scheduledAt: at('2026-10-03', '10:00') }),
    appt({ id: 'a7', patientId: 'p2', status: 'no_show', scheduledAt: at('2026-09-05', '10:00') }),
  ];

  it('counts recent outcomes by patient id, falling back to phone', () => {
    expect(patientAttendance(rows, { patientId: 'p1', phone: '9820000001' }, now)).toEqual({ attended: 1, noShows: 2, cancelled: 1 });
    expect(patientAttendance(rows, { phone: '98200-00001' }, now)).toEqual({ attended: 0, noShows: 1, cancelled: 0 });
    expect(patientAttendance(rows, { patientId: 'p1' }, now, { excludeId: 'a1' }).noShows).toBe(0);
  });

  it('finds the patient’s next upcoming appointment', () => {
    expect(nextAppointmentFor(rows, { patientId: 'p1' }, now)?.id).toBe('a6');
    expect(nextAppointmentFor(rows, { patientId: 'p2' }, now)).toBeNull();
  });

  it('finds the first available slot across therapists, skipping closed days and busy time', () => {
    const busy = [
      appt({ id: 'b1', therapistId: 't1', scheduledAt: at('2026-10-02', '09:00'), durationMinutes: 60 }),
      appt({ id: 'b2', therapistId: 't2', scheduledAt: at('2026-10-02', '09:00'), durationMinutes: 30 }),
    ];
    const base = {
      appointments: busy,
      fromDate: '2026-10-02',
      days: 7,
      hours: { startHour: 9, endHour: 12 },
      slotMinutes: 30,
      lengthMinutes: 30,
      now,
      isClosed: () => false,
    };
    expect(firstAvailableSlot({ ...base, therapistIds: ['t1', 't2'] })).toEqual({ date: '2026-10-02', time: '09:30', therapistId: 't2' });
    expect(firstAvailableSlot({ ...base, therapistIds: ['t1'] })).toEqual({ date: '2026-10-02', time: '10:00', therapistId: 't1' });
    expect(firstAvailableSlot({ ...base, therapistIds: ['t1'], isClosed: (d) => d === '2026-10-02' })?.date).toBe('2026-10-03');
    expect(firstAvailableSlot({ ...base, therapistIds: ['t1'], ignoreAppointmentId: 'b1' })?.time).toBe('09:00');
  });
});

describe('working hours', () => {
  const clinic = { startHour: 9, endHour: 18 };
  const hours = { '4': [[540, 780], [840, 1080]] as [number, number][] }; // Thu 9–1, 2–6

  it('falls back to clinic hours, and treats a missing weekday as a day off', () => {
    expect(workingIntervals(null, '2026-10-01', clinic)).toEqual([{ start: 540, end: 1080 }]);
    expect(workingIntervals(hours, '2026-10-01', clinic)).toEqual([{ start: 540, end: 780 }, { start: 840, end: 1080 }]);
    expect(workingIntervals(hours, '2026-10-02', clinic)).toEqual([]);
  });

  it('keeps free time inside working hours only (the gap is the break)', () => {
    const gaps = freeGaps([], 't1', '2026-10-01', clinic, 30, { working: workingIntervals(hours, '2026-10-01', clinic) });
    expect(gaps).toEqual([{ start: 540, end: 780 }, { start: 840, end: 1080 }]);
    expect(withinWorking([{ start: 540, end: 780 }], 750, 30)).toBe(true);
    expect(withinWorking([{ start: 540, end: 780 }], 760, 30)).toBe(false);
  });

  it('validates the editor value like the server', () => {
    expect(workingHoursProblem(hours)).toBeNull();
    expect(workingHoursProblem({ '1': [[600, 540]] })).toMatch(/Monday: each start/);
    expect(workingHoursProblem({ '1': [[540, 700], [650, 800]] })).toMatch(/overlap/);
  });

  it('public form: a therapist outside their hours counts as unavailable', () => {
    const custom = { t1: hours };
    // 13:30 Thursday: t1 on break, t2 (clinic hours) free -> not taken without preference.
    expect(isPublicSlotTaken('2026-10-01', 810, 30, [], ['t1', 't2'], null, custom, clinic)).toBe(false);
    expect(isPublicSlotTaken('2026-10-01', 810, 30, [], ['t1', 't2'], 't1', custom, clinic)).toBe(true);
    expect(isPublicSlotTaken('2026-10-01', 810, 30, [], ['t1'], null, custom, clinic)).toBe(true);
  });
});
