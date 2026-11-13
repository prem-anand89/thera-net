import { describe, expect, it } from 'vitest';
import { summarizeProgramChanges, type ChangeItem } from './programChanges';

const item = (over: Partial<ChangeItem> = {}): ChangeItem => ({
  id: 'a', title: 'Wall Slides', doseType: 'reps', sets: 3, reps: 10, holdSeconds: null, durationSeconds: null, restSeconds: 30, side: 'none', sessionsPerDay: 2, optional: false, ...over,
});

describe('program change summary', () => {
  it('is empty when nothing changed', () => {
    expect(summarizeProgramChanges([item()], [item()])).toEqual([]);
  });
  it('says what was added, removed and changed, and leaves unchanged exercises out', () => {
    const before = [item({ id: 'a' }), item({ id: 'b', title: 'Heel Slides' }), item({ id: 'c', title: 'Quad Sets' })];
    const after = [item({ id: 'a', sets: 4, reps: 12 }), item({ id: 'b', title: 'Heel Slides' }), item({ id: undefined, title: 'Band Rotation' })];
    expect(summarizeProgramChanges(before, after)).toEqual([
      { title: 'Wall Slides', change: 'changed', detail: 'sets 3 to 4; reps 10 to 12' },
      { title: 'Band Rotation', change: 'added' },
      { title: 'Quad Sets', change: 'removed' },
    ]);
  });
  it('describes kind, hold, time, rest, side, times a day, optional and instruction changes', () => {
    const r = summarizeProgramChanges(
      [item()],
      [item({ doseType: 'hold', holdSeconds: 5, restSeconds: 45, side: 'both', sessionsPerDay: 3, optional: true, specialInstructions: 'Use the red band' })],
    );
    expect(r[0].detail).toBe('now reps with hold; hold – to 5 s; rest 30 to 45 s; now each side; now 3 times a day; now optional; new instruction');
  });
  it('treats an item whose id was not on the program as added', () => {
    expect(summarizeProgramChanges([item({ id: 'a' })], [item({ id: 'zzz', title: 'New one' }), item({ id: 'a' })])).toEqual([{ title: 'New one', change: 'added' }]);
  });
});
