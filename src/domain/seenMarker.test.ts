import { describe, expect, it } from 'vitest';
import { effectiveSeenSince, seenMarkerId, SEEN_FLOOR_DAYS } from './seenMarker';

describe('seenMarkerId', () => {
  it('is the same on every device and unique per user, clinic and marker', () => {
    expect(seenMarkerId('u1', 'c1', 'feedback')).toBe('u1:c1:feedback');
    expect(seenMarkerId('u1', 'c1', 'feedback')).toBe(seenMarkerId('u1', 'c1', 'feedback'));
    expect(seenMarkerId('u1', 'c1', 'feedback')).not.toBe(seenMarkerId('u2', 'c1', 'feedback'));
    expect(seenMarkerId('u1', 'c1', 'feedback')).not.toBe(seenMarkerId('u1', 'c2', 'feedback'));
    expect(seenMarkerId('u1', 'c1', 'feedback')).not.toBe(seenMarkerId('u1', 'c1', 'therapist_appointments'));
  });
});

describe('effectiveSeenSince', () => {
  const now = new Date('2026-10-18T12:00:00.000Z');

  it('uses the synced marker when there is one', () => {
    expect(effectiveSeenSince('2026-10-10T00:00:00.000Z', undefined, now)).toBe('2026-10-10T00:00:00.000Z');
  });

  it('takes the newest of the marker and a legacy per-device value', () => {
    expect(effectiveSeenSince('2026-10-10T00:00:00.000Z', '2026-10-15T00:00:00.000Z', now)).toBe('2026-10-15T00:00:00.000Z');
    expect(effectiveSeenSince('2026-10-16T00:00:00.000Z', '2026-10-15T00:00:00.000Z', now)).toBe('2026-10-16T00:00:00.000Z');
  });

  it('on a cold device only counts the last 30 days as new, never everything ever', () => {
    const since = effectiveSeenSince(undefined, undefined, now);
    expect(since).toBe(new Date(now.getTime() - SEEN_FLOOR_DAYS * 86_400_000).toISOString());
    expect(since > '2026-09-01').toBe(true);
    expect(effectiveSeenSince(null, null, now)).toBe(since);
  });
});
