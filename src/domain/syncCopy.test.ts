import { describe, expect, it } from 'vitest';
import {
  formatLastSynced,
  isSyncStale,
  syncFailureHeadline,
  syncFreshnessCaption,
  syncRecordLabel,
} from './syncCopy';

describe('syncFailureHeadline', () => {
  it('uses a human noun for one failed patient write', () => {
    expect(syncFailureHeadline(['patients'])).toBe('1 patient change not saved');
  });

  it('pluralizes the same table', () => {
    expect(syncFailureHeadline(['visits', 'visits'])).toBe('2 visits not saved');
  });
});

describe('syncRecordLabel', () => {
  it('names a visit row', () => {
    expect(syncRecordLabel('visits')).toBe('visit');
  });
});

describe('syncFreshnessCaption', () => {
  it('prioritizes unsynced changes over a last-sync timestamp', () => {
    expect(syncFreshnessCaption(2, 'visits', '2026-01-01T14:02:00.000Z')).toBe(
      'Includes 2 unsynced visits.'
    );
  });

  it('singularizes a single unsynced change', () => {
    expect(syncFreshnessCaption(1, 'visits', null)).toBe('Includes 1 unsynced visit.');
  });

  it('falls back to the last-sync time when nothing is unsynced', () => {
    const caption = syncFreshnessCaption(0, 'visits', new Date('2026-01-01T14:02:00').getTime());
    expect(caption).toMatch(/^As of last sync \d{1,2}:\d{2}/);
  });

  it('returns null when there is nothing unsynced and no sync has happened yet', () => {
    expect(syncFreshnessCaption(0, 'visits', null)).toBeNull();
  });
});

describe('formatLastSynced / isSyncStale', () => {
  const now = new Date('2026-10-14T15:00:00').getTime();
  it('says just now, minutes, time today, and date', () => {
    expect(formatLastSynced(now - 20_000, now)).toBe('Last synced just now');
    expect(formatLastSynced(now - 12 * 60_000, now)).toBe('Last synced 12 min ago');
    expect(formatLastSynced(new Date('2026-10-14T09:05:00').getTime(), now)).toBe('Last synced at 09:05');
    expect(formatLastSynced(new Date('2026-10-12T09:05:00').getTime(), now)).toMatch(/^Last synced 12 Oct, 09:05$/);
    expect(formatLastSynced(undefined, now)).toBe('Not synced yet on this device');
  });
  it('is stale only after 30 minutes of a known last sync', () => {
    expect(isSyncStale(now - 29 * 60_000, now)).toBe(false);
    expect(isSyncStale(now - 31 * 60_000, now)).toBe(true);
    expect(isSyncStale(undefined, now)).toBe(false);
  });
});
