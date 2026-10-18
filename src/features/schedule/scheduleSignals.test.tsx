// @vitest-environment jsdom
import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { db } from '@/lib/db';
import { repos } from '@/services';
import { syncStatus } from '@/sync/status';
import { seenMarkerId } from '@/domain/seenMarker';
import type { Appointment, FeedbackResponse, UserSeenMarker } from '@/domain/types';
import {
  requestsLastViewedKey,
  therapistAppointmentsLastViewedKey,
  useNewFeedbackResponseCount,
  useNewLowRatingFeedbackCount,
  useNewTherapistAppointmentCount,
} from './scheduleSignals';

const CLINIC = 'c1';
const USER = 'u1';
const daysAgo = (n: number) => new Date(Date.now() - n * 86_400_000).toISOString();

const response = (id: string, createdAt: string, rating = 5): FeedbackResponse =>
  ({ id, clinicId: CLINIC, requestId: `r-${id}`, rating, createdAt, updatedAt: createdAt }) as unknown as FeedbackResponse;

const marker = (seenAt: string): UserSeenMarker => ({
  id: seenMarkerId(USER, CLINIC, 'feedback'),
  userId: USER,
  clinicId: CLINIC,
  markerKey: 'feedback',
  seenAt,
  createdAt: seenAt,
  updatedAt: seenAt,
});

const syncDone = () => act(() => syncStatus.set({ lastSuccessAt: Date.now() }));

beforeEach(async () => {
  await db.feedback_responses.clear();
  await db.appointments.clear();
  await db.user_seen_markers.clear();
  await db.outbox.clear();
  await db.meta.clear();
  syncStatus.set({ lastSuccessAt: undefined });
});
afterEach(cleanup);

describe('feedback "new" counts follow the user, not the device', () => {
  it('reads 0 until this device has synced once (no flash of everything as new)', async () => {
    await db.feedback_responses.bulkPut([response('a', daysAgo(1))]);
    const { result } = renderHook(() => useNewFeedbackResponseCount(CLINIC, USER, true));
    await new Promise((r) => setTimeout(r, 50));
    expect(result.current).toBe(0);
    syncDone();
    await waitFor(() => expect(result.current).toBe(1));
  });

  it('a brand-new device with no marker counts only the last 30 days, not years of old feedback', async () => {
    await db.feedback_responses.bulkPut([response('ancient', daysAgo(400)), response('old', daysAgo(60)), response('recent', daysAgo(2))]);
    syncDone();
    const { result } = renderHook(() => useNewFeedbackResponseCount(CLINIC, USER, true));
    await waitFor(() => expect(result.current).toBe(1));
  });

  it('counts only what arrived after the synced marker', async () => {
    await db.feedback_responses.bulkPut([response('a', daysAgo(5)), response('b', daysAgo(1))]);
    await db.user_seen_markers.put(marker(daysAgo(3)));
    syncDone();
    const { result } = renderHook(() => useNewFeedbackResponseCount(CLINIC, USER, true));
    await waitFor(() => expect(result.current).toBe(1));
  });

  it('a marker set on another device clears the count here without a reload', async () => {
    await db.feedback_responses.bulkPut([response('a', daysAgo(2)), response('b', daysAgo(1))]);
    syncDone();
    const { result } = renderHook(() => useNewFeedbackResponseCount(CLINIC, USER, true));
    await waitFor(() => expect(result.current).toBe(2));
    // Device B marks everything seen; the sync pull writes the marker row here.
    await db.user_seen_markers.put(marker(new Date().toISOString()));
    await waitFor(() => expect(result.current).toBe(0));
  });

  it('carries an existing per-device marker over into the synced one, once', async () => {
    const legacy = daysAgo(3);
    await db.meta.put({ key: requestsLastViewedKey(CLINIC), value: legacy });
    await db.feedback_responses.bulkPut([response('a', daysAgo(5)), response('b', daysAgo(1))]);
    syncDone();
    const { result } = renderHook(() => useNewFeedbackResponseCount(CLINIC, USER, true));
    await waitFor(() => expect(result.current).toBe(1));
    await waitFor(async () => {
      const synced = await db.user_seen_markers.get(seenMarkerId(USER, CLINIC, 'feedback'));
      expect(synced?.seenAt).toBe(legacy);
      expect(await db.meta.get(requestsLastViewedKey(CLINIC))).toBeUndefined();
    });
    expect((await db.outbox.toArray()).some((e) => e.table === 'user_seen_markers')).toBe(true);
    expect(result.current).toBe(1);
  });

  it('low-rating count uses the same marker', async () => {
    await db.feedback_responses.bulkPut([response('low', daysAgo(1), 1), response('ok', daysAgo(1), 5), response('oldlow', daysAgo(8), 2)]);
    await db.user_seen_markers.put(marker(daysAgo(3)));
    syncDone();
    const { result } = renderHook(() => useNewLowRatingFeedbackCount(CLINIC, USER, true));
    await waitFor(() => expect(result.current).toBe(1));
  });

  it('stays 0 when disabled or when the user is not known yet', async () => {
    await db.feedback_responses.bulkPut([response('a', daysAgo(1))]);
    syncDone();
    const off = renderHook(() => useNewFeedbackResponseCount(CLINIC, USER, false));
    const noUser = renderHook(() => useNewFeedbackResponseCount(CLINIC, undefined, true));
    await new Promise((r) => setTimeout(r, 50));
    expect(off.result.current).toBe(0);
    expect(noUser.result.current).toBe(0);
  });
});

describe('repos.userSeenMarkers.markSeen', () => {
  it('writes one deterministic row, queues it for sync and only ever moves forward', async () => {
    await repos.userSeenMarkers.markSeen(USER, CLINIC, 'feedback', '2026-10-10T00:00:00.000Z');
    const id = seenMarkerId(USER, CLINIC, 'feedback');
    expect((await db.user_seen_markers.get(id))?.seenAt).toBe('2026-10-10T00:00:00.000Z');
    expect(await db.outbox.count()).toBe(1);

    await repos.userSeenMarkers.markSeen(USER, CLINIC, 'feedback', '2026-10-01T00:00:00.000Z'); // older: ignored
    expect((await db.user_seen_markers.get(id))?.seenAt).toBe('2026-10-10T00:00:00.000Z');
    expect(await db.outbox.count()).toBe(1);

    await repos.userSeenMarkers.markSeen(USER, CLINIC, 'feedback', '2026-10-12T00:00:00.000Z');
    expect((await db.user_seen_markers.get(id))?.seenAt).toBe('2026-10-12T00:00:00.000Z');
    expect(await db.user_seen_markers.count()).toBe(1);
  });

  it('keeps separate rows per marker and per user', async () => {
    await repos.userSeenMarkers.markSeen(USER, CLINIC, 'feedback');
    await repos.userSeenMarkers.markSeen(USER, CLINIC, 'therapist_appointments');
    await repos.userSeenMarkers.markSeen('u2', CLINIC, 'feedback');
    expect(await db.user_seen_markers.count()).toBe(3);
  });
});

describe('a therapist\'s new/changed appointment count', () => {
  const appt = (id: string, updatedAt: string, therapistId = 't1'): Appointment =>
    ({ id, clinicId: CLINIC, therapistId, status: 'confirmed', scheduledAt: updatedAt, createdAt: updatedAt, updatedAt }) as unknown as Appointment;

  it('counts own appointments changed after the synced marker, on any device', async () => {
    await db.appointments.bulkPut([appt('old', daysAgo(5)), appt('new', daysAgo(1)), appt('theirs', daysAgo(1), 't2')]);
    await db.user_seen_markers.put({ ...marker(daysAgo(3)), id: seenMarkerId(USER, CLINIC, 'therapist_appointments'), markerKey: 'therapist_appointments' });
    syncDone();
    const { result } = renderHook(() => useNewTherapistAppointmentCount(CLINIC, USER, 't1', true));
    await waitFor(() => expect(result.current).toBe(1));
  });

  it('migrates the old per-therapist device marker', async () => {
    const legacy = daysAgo(3);
    await db.meta.put({ key: therapistAppointmentsLastViewedKey(CLINIC, 't1'), value: legacy });
    await db.appointments.bulkPut([appt('old', daysAgo(5)), appt('new', daysAgo(1))]);
    syncDone();
    const { result } = renderHook(() => useNewTherapistAppointmentCount(CLINIC, USER, 't1', true));
    await waitFor(() => expect(result.current).toBe(1));
    await waitFor(async () => {
      expect((await db.user_seen_markers.get(seenMarkerId(USER, CLINIC, 'therapist_appointments')))?.seenAt).toBe(legacy);
    });
  });
});
