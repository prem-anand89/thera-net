import { describe, expect, it } from 'vitest';
import type { AppointmentRequest } from './types';
import { awaitingDuplicateNotes, awaitingMessage, awaitingOrder, awaitingWants, isPastDay, openingFor } from './awaiting';
import { matchingWaitlistEntries } from './waitlistMatch';

const req = (id: string, over: Partial<AppointmentRequest> = {}): AppointmentRequest =>
  ({
    id,
    clinicId: 'c1',
    name: id,
    phone: '9820000001',
    email: null,
    preferredTherapistId: null,
    notes: null,
    preferredDate: null,
    preferredTimeText: null,
    status: 'pending',
    createdAt: '2026-11-01T10:00:00Z',
    updatedAt: '',
    ...over,
  }) as AppointmentRequest;

describe('awaitingOrder', () => {
  it('lists public and staff entries together, oldest first, pending only', () => {
    const list = awaitingOrder(
      [
        req('b', { createdAt: '2026-11-03T09:00:00Z', isWaitlist: true }),
        req('a', { createdAt: '2026-11-02T09:00:00Z' }),
        req('gone', { status: 'declined' } as never),
      ],
      '2026-11-05'
    );
    expect(list.map((r) => r.id)).toEqual(['a', 'b']);
  });

  it('sinks an entry whose day has passed to the bottom, but keeps it', () => {
    const list = awaitingOrder(
      [
        req('old', { createdAt: '2026-10-01T09:00:00Z', preferredDate: '2026-11-03' }),
        req('new', { createdAt: '2026-11-04T09:00:00Z', preferredDate: '2026-11-07' }),
        req('open', { createdAt: '2026-11-04T10:00:00Z' }),
      ],
      '2026-11-05'
    );
    expect(list.map((r) => r.id)).toEqual(['new', 'open', 'old']);
    expect(isPastDay(list[2], '2026-11-05')).toBe(true);
    expect(isPastDay(req('today', { preferredDate: '2026-11-05' }), '2026-11-05')).toBe(false);
  });
});

describe('awaitingWants', () => {
  it('says "Was for 3 Nov" once the day has passed', () => {
    expect(awaitingWants(req('x', { preferredDate: '2026-11-03' }), '2026-11-05')).toBe('Was for 3 Nov');
  });
  it('gives the day and part of the day, or "Any day"', () => {
    expect(awaitingWants(req('x', { preferredDate: '2026-11-06', preferredTimeOfDay: 'morning' }), '2026-11-05')).toBe('Fri, 6 Nov, morning');
    expect(awaitingWants(req('x', { preferredTimeOfDay: 'any' }), '2026-11-05')).toBe('Any day');
    expect(awaitingWants(req('x', { preferredTimeText: 'after 5pm' }), '2026-11-05')).toBe('Any day, after 5pm');
  });
});

describe('awaitingMessage', () => {
  it('notes the request and promises a call, never a slot', () => {
    const text = awaitingMessage({ patientName: 'Suresh', clinicName: 'Beyond Mechanics' });
    expect(text).toBe("Hi Suresh, this is Beyond Mechanics. We've noted your request for an appointment and will call you as soon as a time is free.");
    expect(text).not.toMatch(/confirmed|booked/i);
  });
});

describe('awaitingDuplicateNotes', () => {
  const appt = (over = {}) => ({ id: 'a', patientName: 'Suresh', patientPhone: '+91 98200 00001', scheduledAt: new Date(2099, 0, 5, 10, 30).toISOString(), status: 'confirmed', ...over }) as never;
  it('says so when the number is already awaiting, or already has an upcoming appointment', () => {
    expect(awaitingDuplicateNotes('9820000001', [req('Suresh', { createdAt: '2026-11-03T10:00:00Z' })], [], new Date(2026, 10, 5))).toEqual(['Suresh is already awaiting (added 3 Nov).']);
    expect(awaitingDuplicateNotes('9820000001', [], [appt()], new Date(2026, 10, 5))[0]).toMatch(/Suresh already has an appointment on .*Jan/);
  });
  it('stays quiet for another number, a past or cancelled appointment, a dismissed request or a short number', () => {
    expect(awaitingDuplicateNotes('9820000002', [req('x')], [appt()], new Date(2026, 10, 5))).toEqual([]);
    expect(awaitingDuplicateNotes('9820000001', [], [appt({ scheduledAt: new Date(2020, 0, 1).toISOString() }), appt({ status: 'cancelled' })], new Date(2026, 10, 5))).toEqual([]);
    expect(awaitingDuplicateNotes('9820000001', [req('x', { status: 'declined' } as never)], [], new Date(2026, 10, 5))).toEqual([]);
    expect(awaitingDuplicateNotes('123', [req('x')], [], new Date())).toEqual([]);
  });
});

describe('openingFor', () => {
  it('turns a freed appointment into the slot waiting entries are matched against', () => {
    const when = new Date(2026, 10, 6, 10, 30).toISOString();
    const opening = openingFor({ scheduledAt: when, therapistId: 't1' });
    expect(opening).toEqual({ date: '2026-11-06', therapistId: 't1', timeOfDay: 'morning' });
    const entries = [
      req('fits', { preferredDate: '2026-11-06', preferredTimeOfDay: 'morning' }),
      req('wrongDay', { preferredDate: '2026-11-07' }),
      req('wrongPart', { preferredDate: '2026-11-06', preferredTimeOfDay: 'evening' }),
    ];
    expect(matchingWaitlistEntries(entries, opening).map((r) => r.id)).toEqual(['fits']);
  });
});
