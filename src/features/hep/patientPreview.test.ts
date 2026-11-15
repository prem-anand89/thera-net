import { describe, expect, it } from 'vitest';
import type { HepItemInput } from '@/services/hepService';
import { toPreviewItems } from './patientPreview';

const input = (over: Partial<HepItemInput> = {}): HepItemInput => ({
  title: 'Bridge', bodyRegion: 'Hip', phase: 'strengthening', instructions: 'Lift.', mediaType: 'stills', mediaKeys: [], mediaCaptions: [], equipment: [],
  doseType: 'reps', sets: 3, reps: 10, holdSeconds: null, durationSeconds: null, restSeconds: 0, sessionsPerDay: 1, side: 'none', optional: false, stopIf: '', ...over,
});

describe('toPreviewItems', () => {
  it('orders by section, numbers ids and sortOrder from that order, and stamps today', () => {
    const out = toPreviewItems([input({ title: 'Walk', phase: 'cool_down' }), input({ title: 'March', phase: 'warm_up' }), input({ title: 'Bridge' })], { today: '2026-11-14', sessionsPerDay: 2, mediaUrls: {} });
    expect(out.map((o) => [o.id, o.title, o.sortOrder])).toEqual([['preview-0', 'March', 0], ['preview-1', 'Bridge', 1], ['preview-2', 'Walk', 2]]);
    expect(out[0]).toMatchObject({ addedOn: '2026-11-14', sessionsPerDay: 2, sessionsSchedule: [{ from: '2026-11-14', sessionsPerDay: 2 }] });
  });

  it('maps picture keys to URLs, drops missing ones with their captions, and falls back to no picture', () => {
    const [a, b] = toPreviewItems(
      [input({ mediaKeys: ['k1', 'k2'], mediaCaptions: ['one', 'two'] }), input({ title: 'Other', phase: 'cool_down', mediaKeys: ['gone'], mediaCaptions: ['x'] })],
      { today: '2026-11-14', sessionsPerDay: 1, mediaUrls: { k2: 'https://u/2' } },
    );
    expect(a.mediaUrls).toEqual(['https://u/2']);
    expect(a.mediaCaptions).toEqual(['two']);
    expect(b.mediaUrls).toEqual([]);
    expect(b.mediaType).toBe('none');
  });
});
