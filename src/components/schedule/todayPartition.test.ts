import { describe, expect, it } from 'vitest';
import type { Appointment } from '@/domain/types';
import { partitionTodayAppointments } from './todayPartition';

const dummyAppt = (id: string, over: Partial<Appointment> = {}): Appointment => ({
  id,
  clinicId: 'c1',
  patientId: 'p1',
  patientName: 'Test Patient',
  patientPhone: '9876543210',
  therapistId: 't1',
  scheduledAt: '2026-10-16T10:00:00Z',
  durationMinutes: 30,
  status: 'confirmed',
  requestId: null,
  visitId: null,
  rescheduleCount: 0,
  previousScheduledAt: null,
  createdAt: '2026-10-16T09:00:00Z',
  updatedAt: '2026-10-16T09:00:00Z',
  ...over,
});

describe('partitionTodayAppointments', () => {
  it('correctly partitions appointments across all statuses and counts them', () => {
    const list: Appointment[] = [
      dummyAppt('a1', { status: 'arrived' }),
      dummyAppt('a2', { status: 'confirmed' }),
      dummyAppt('a3', { status: 'rescheduled' }),
      dummyAppt('a4', { status: 'arrived', visitId: 'v1' }), // logged
      dummyAppt('a5', { status: 'no_show' }),
      dummyAppt('a6', { status: 'cancelled' }),
    ];

    const res = partitionTodayAppointments(list);

    expect(res.inProgress).toHaveLength(1);
    expect(res.inProgress[0].id).toBe('a1');

    expect(res.upcoming).toHaveLength(2);
    expect(res.upcoming.map((a) => a.id)).toEqual(['a2', 'a3']);

    expect(res.logged).toHaveLength(1);
    expect(res.logged[0].id).toBe('a4');

    expect(res.noShows).toHaveLength(1);
    expect(res.noShows[0].id).toBe('a5');

    expect(res.cancelled).toHaveLength(1);
    expect(res.cancelled[0].id).toBe('a6');

    expect(res.pendingCount).toBe(3);
    expect(res.doneCount).toBe(3);
  });

  it('puts carried-over appointments with visitId into logged', () => {
    // Carried over from yesterday, but visit was logged today
    const carriedOver = dummyAppt('a-old', {
      scheduledAt: '2026-10-15T15:00:00Z',
      status: 'arrived',
      visitId: 'v-today',
    });

    const res = partitionTodayAppointments([carriedOver]);
    expect(res.logged).toHaveLength(1);
    expect(res.logged[0].id).toBe('a-old');
    expect(res.inProgress).toHaveLength(0);
    expect(res.doneCount).toBe(1);
    expect(res.pendingCount).toBe(0);
  });

  it('handles empty appointment array', () => {
    const res = partitionTodayAppointments([]);
    expect(res.inProgress).toHaveLength(0);
    expect(res.upcoming).toHaveLength(0);
    expect(res.logged).toHaveLength(0);
    expect(res.noShows).toHaveLength(0);
    expect(res.cancelled).toHaveLength(0);
    expect(res.pendingCount).toBe(0);
    expect(res.doneCount).toBe(0);
  });
});
