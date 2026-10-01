import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { db } from '@/lib/db';
import {
  enqueueAppointmentLink,
  isPermanentLinkError,
  listPendingLinks,
  removePendingLink,
  withPendingLinks,
} from '../pendingLinks';
import { repos } from '@/repositories/local';
import type { Appointment } from '@/domain/types';

const appt = (over: Partial<Appointment> = {}): Appointment => ({
  id: 'a1', clinicId: 'c', patientId: null, patientName: 'Prem', patientPhone: '1', therapistId: 't1',
  scheduledAt: '2026-10-01T10:00:00.000Z', durationMinutes: 60, status: 'confirmed',
  requestId: null, visitId: null, rescheduleCount: 0, previousScheduledAt: null, createdAt: '', updatedAt: '', ...over,
});

describe('pending appointment links', () => {
  beforeEach(async () => {
    await db.meta.clear();
    await db.appointments.clear();
  });

  it('queues a link, replaces one for the same appointment, and removes it', async () => {
    await enqueueAppointmentLink({ appointmentId: 'a1', visitId: 'v1', patientId: 'p1' });
    await enqueueAppointmentLink({ appointmentId: 'a2', visitId: 'v2', patientId: 'p2' });
    await enqueueAppointmentLink({ appointmentId: 'a1', visitId: 'v9', patientId: 'p1' });
    expect(await listPendingLinks()).toEqual([
      { appointmentId: 'a2', visitId: 'v2', patientId: 'p2' },
      { appointmentId: 'a1', visitId: 'v9', patientId: 'p1' },
    ]);
    await removePendingLink('a1');
    expect(await listPendingLinks()).toEqual([{ appointmentId: 'a2', visitId: 'v2', patientId: 'p2' }]);
  });

  it('shows a pending-link appointment as arrived and linked, leaving others alone', () => {
    const out = withPendingLinks([appt(), appt({ id: 'a2' })], [{ appointmentId: 'a1', visitId: 'v1', patientId: 'p1' }]);
    expect(out[0]).toMatchObject({ status: 'arrived', visitId: 'v1', patientId: 'p1' });
    expect(out[1]).toMatchObject({ status: 'confirmed', visitId: null });
  });

  it('the appointments repo applies pending links, and stops once the link is sent', async () => {
    await db.appointments.put(appt());
    await enqueueAppointmentLink({ appointmentId: 'a1', visitId: 'v1', patientId: 'p1' });
    expect((await repos.appointments.listByClinic('c'))[0]).toMatchObject({ status: 'arrived', visitId: 'v1' });
    await removePendingLink('a1');
    expect((await repos.appointments.listByClinic('c'))[0]).toMatchObject({ status: 'confirmed', visitId: null });
  });

  it('treats "already linked" and "not found" as permanent, a network failure as retryable', () => {
    expect(isPermanentLinkError('This appointment already has a linked visit.')).toBe(true);
    expect(isPermanentLinkError('Appointment not found.')).toBe(true);
    expect(isPermanentLinkError('TypeError: Failed to fetch')).toBe(false);
  });
});
