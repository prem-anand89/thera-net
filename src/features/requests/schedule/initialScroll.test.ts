import { describe, expect, it } from 'vitest';
import { PX_PER_MINUTE, initialScrollTop } from './TimeGrid';

const hours = { startHour: 9, endHour: 18 };

describe('initialScrollTop', () => {
  it('stays at the top when now is visible, so the first rows are never hidden', () => {
    expect(initialScrollTop(hours, { nowMinutes: 11 * 60 + 10, firstStart: 540, viewportHeight: 800 })).toBe(0);
  });

  it('scrolls to an hour above now when now would be off-screen', () => {
    expect(initialScrollTop(hours, { nowMinutes: 16 * 60, firstStart: 540, viewportHeight: 400 })).toBe(
      (16 * 60 - 540 - 60) * PX_PER_MINUTE
    );
  });

  it('ignores now after closing time and uses the first appointment instead', () => {
    expect(initialScrollTop(hours, { nowMinutes: 22 * 60 + 40, firstStart: 540, viewportHeight: 400 })).toBe(0);
    expect(initialScrollTop(hours, { nowMinutes: 22 * 60 + 40, firstStart: 15 * 60, viewportHeight: 400 })).toBe(
      (15 * 60 - 540 - 60) * PX_PER_MINUTE
    );
  });
});
