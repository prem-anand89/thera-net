import { describe, expect, it } from 'vitest';
import { loadDots } from './ScheduleRail';

describe('loadDots', () => {
  it('buckets booked counts into 0–3 dots', () => {
    expect([0, 1, 2, 3, 5, 6, 12].map(loadDots)).toEqual([0, 1, 1, 2, 2, 3, 3]);
  });
});
