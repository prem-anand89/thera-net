import { describe, expect, it } from 'vitest';
import { appointmentsOutsideHours } from './hoursConflicts';
import { localDateTime } from '@/domain/schedule';
import type { Appointment } from '@/domain/types';

const at = (date: string, time: string) => localDateTime(date, time).toISOString();

function makeAppt(over: Partial<Appointment>): Appointment {
  return {
    id: 'a1',
    clinicId: 'c1',
    patientId: null,
    patientName: 'Patient 1',
    patientPhone: '9876543210',
    therapistId: 'th-1',
    scheduledAt: at('2026-10-15', '10:00'),
    status: 'confirmed',
    requestId: null,
    visitId: null,
    rescheduleCount: 0,
    previousScheduledAt: null,
    createdAt: '',
    updatedAt: '',
    ...over,
  } as Appointment;
}

describe('appointmentsOutsideHours', () => {
  const clinicHours = { startHour: 9, endHour: 17 };
  const slotMinutes = 30;
  const todayIso = '2026-10-15';

  it('ignores cancelled appointments', () => {
    const cancelled = makeAppt({
      id: 'a-cancelled',
      scheduledAt: at('2026-10-15', '19:00'),
      status: 'cancelled',
    });
    const conflicts = appointmentsOutsideHours({
      appointments: [cancelled],
      therapistId: 'th-1',
      hours: { '4': [[540, 1020]] }, // 9-17 on Thursday Oct 15
      clinicHours,
      slotMinutes,
      todayIso,
    });
    expect(conflicts).toHaveLength(0);
  });

  it('ignores past appointments before todayIso', () => {
    const past = makeAppt({
      id: 'a-past',
      scheduledAt: at('2026-10-14', '19:00'), // yesterday
    });
    const conflicts = appointmentsOutsideHours({
      appointments: [past],
      therapistId: 'th-1',
      hours: { '3': [[540, 1020]] },
      clinicHours,
      slotMinutes,
      todayIso,
    });
    expect(conflicts).toHaveLength(0);
  });

  it('ignores another therapist appointments', () => {
    const otherTherapist = makeAppt({
      id: 'a-other',
      therapistId: 'th-other',
      scheduledAt: at('2026-10-15', '19:00'),
    });
    const conflicts = appointmentsOutsideHours({
      appointments: [otherTherapist],
      therapistId: 'th-1',
      hours: { '4': [[540, 1020]] },
      clinicHours,
      slotMinutes,
      todayIso,
    });
    expect(conflicts).toHaveLength(0);
  });

  it('does not return appointments inside hours', () => {
    const inside = makeAppt({
      id: 'a-inside',
      scheduledAt: at('2026-10-15', '10:00'),
    });
    const conflicts = appointmentsOutsideHours({
      appointments: [inside],
      therapistId: 'th-1',
      hours: { '4': [[540, 1020]] },
      clinicHours,
      slotMinutes,
      todayIso,
    });
    expect(conflicts).toHaveLength(0);
  });

  it('returns a 7 PM appointment when hours end at 5 PM', () => {
    const evening = makeAppt({
      id: 'a-evening',
      scheduledAt: at('2026-10-15', '19:00'),
    });
    const conflicts = appointmentsOutsideHours({
      appointments: [evening],
      therapistId: 'th-1',
      hours: { '4': [[540, 1020]] }, // ends at 17:00
      clinicHours,
      slotMinutes,
      todayIso,
    });
    expect(conflicts).toEqual([evening]);
  });

  it('treats null hours as clinic hours', () => {
    // Oct 15 is Thursday (weekday 4). Clinic is 9-17.
    const inside = makeAppt({
      id: 'a-inside',
      scheduledAt: at('2026-10-15', '14:00'),
    });
    const evening = makeAppt({
      id: 'a-evening',
      scheduledAt: at('2026-10-15', '18:00'),
    });
    const conflicts = appointmentsOutsideHours({
      appointments: [inside, evening],
      therapistId: 'th-1',
      hours: null,
      clinicHours,
      slotMinutes,
      todayIso,
    });
    expect(conflicts).toEqual([evening]);
  });
});
