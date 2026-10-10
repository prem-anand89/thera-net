import { describe, expect, it } from 'vitest';
import { matchingWaitlistEntries, timeOfDayFor } from './waitlistMatch';
import type { AppointmentRequest } from './types';

const request = (over: Partial<AppointmentRequest>): AppointmentRequest => ({
  id: 'r1', clinicId: 'c1', name: 'Priya', phone: '+91 98200 00001', email: null,
  preferredTherapistId: null, notes: null, preferredDate: '2026-10-15', preferredTimeText: null,
  preferredTimeOfDay: null, isWaitlist: false, status: 'pending', appointmentId: null,
  createdAt: '', updatedAt: '', ...over,
});

const opening = { date: '2026-10-15', therapistId: 't1', timeOfDay: 'morning' as const };

describe('matchingWaitlistEntries', () => {
  it('matches on exact day, therapist and time-of-day', () => {
    const r = request({ preferredTherapistId: 't1', preferredTimeOfDay: 'morning' });
    expect(matchingWaitlistEntries([r], opening)).toEqual([r]);
  });

  it('matches a therapist-less request against any therapist', () => {
    const r = request({ preferredTherapistId: null, preferredTimeOfDay: 'morning' });
    expect(matchingWaitlistEntries([r], opening)).toEqual([r]);
  });

  it('matches an "any" (or unset) time-of-day request against every bucket', () => {
    const any = request({ preferredTherapistId: 't1', preferredTimeOfDay: 'any' });
    const unset = request({ id: 'r2', preferredTherapistId: 't1', preferredTimeOfDay: null });
    expect(matchingWaitlistEntries([any, unset], opening)).toEqual([any, unset]);
  });

  it('does not match a different day, therapist or time-of-day', () => {
    expect(matchingWaitlistEntries([request({ preferredDate: '2026-10-16' })], opening)).toEqual([]);
    expect(matchingWaitlistEntries([request({ preferredTherapistId: 't2' })], opening)).toEqual([]);
    expect(matchingWaitlistEntries([request({ preferredTimeOfDay: 'evening' })], opening)).toEqual([]);
  });

  it('does not match a confirmed or declined request', () => {
    expect(matchingWaitlistEntries([request({ status: 'confirmed' })], opening)).toEqual([]);
    expect(matchingWaitlistEntries([request({ status: 'declined' })], opening)).toEqual([]);
  });
});

describe('timeOfDayFor', () => {
  it('buckets minutes into morning, afternoon or evening', () => {
    expect(timeOfDayFor(9 * 60)).toBe('morning');
    expect(timeOfDayFor(12 * 60)).toBe('afternoon');
    expect(timeOfDayFor(16 * 60 + 59)).toBe('afternoon');
    expect(timeOfDayFor(17 * 60)).toBe('evening');
  });
});
