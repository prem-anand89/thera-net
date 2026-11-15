import { describe, expect, it } from 'vitest';
import type { Exercise, ExerciseTemplateItem } from '@/domain/hep';
import { blockOf, exerciseToItem, groupItemsByPhase, intoBlock, itemDose, itemsMinutes, itemsNeed, mainPhaseFor, moveToBlock, moveWithinSection, orderBySection, programBlocks, templateItemToInput, withItemDose } from './hepItems';

const ex = (over: Partial<Exercise> = {}): Exercise => ({
  id: 'e1', clinicId: 'c1', title: 'Quad Sets', positions: [], otherNames: ['QS'], bodyRegion: 'Knee', alsoRegions: ['Hip'], equipment: ['Towel'], phase: 'activation', instructions: 'Sit\nTighten', mediaType: 'stills',
  mediaKeys: ['k0', 'k1'], mediaCaptions: ['Start', 'Hold'], thumbKey: 't', defaultSets: 3, doseType: 'hold', defaultReps: 12, defaultHoldSeconds: 10, defaultDurationSeconds: null, defaultRestSeconds: 30,
  defaultSessionsPerDay: 2, side: 'both', stopIf: 'Sharp pain', isFavorite: true, active: true, deleted: false, version: 3, createdAt: '', updatedAt: '', ...over,
});

describe('exerciseToItem', () => {
  it('copies the exercise at this moment: what the patient sees and the default dose, with a link to the source for usage only', () => {
    const item = exerciseToItem(ex());
    expect(item).toMatchObject({ sourceExerciseId: 'e1', title: 'Quad Sets', phase: 'activation', sets: 3, reps: 12, holdSeconds: 10, doseType: 'hold', sessionsPerDay: 2, side: 'both', optional: false, mediaKeys: ['k0', 'k1'] });
    expect(item).not.toHaveProperty('otherNames');
    expect(item).not.toHaveProperty('isFavorite');
  });
  it('is a copy: changing the item never touches the exercise', () => {
    const e = ex();
    const item = exerciseToItem(e);
    item.mediaKeys.push('x');
    item.equipment.push('Chair');
    expect(e.mediaKeys).toEqual(['k0', 'k1']);
    expect(e.equipment).toEqual(['Towel']);
  });
  it('drops the numbers the kind does not use', () => {
    expect(exerciseToItem(ex({ doseType: 'timed', defaultReps: 5, defaultHoldSeconds: 5, defaultDurationSeconds: 45 }))).toMatchObject({ reps: null, holdSeconds: null, durationSeconds: 45 });
  });
});

describe('dose round trip', () => {
  it('reads and writes the dose without touching the rest of the item', () => {
    const item = exerciseToItem(ex());
    const dose = itemDose(item);
    expect(dose).toMatchObject({ kind: 'hold', sets: 3, reps: 12, holdSeconds: 10, sessionsPerDay: 2, optional: false });
    expect(withItemDose(item, { ...dose, sets: 4, optional: true })).toMatchObject({ title: 'Quad Sets', sets: 4, optional: true, reps: 12 });
  });
  it('a null "same as the program" keeps the item\'s own times a day', () => {
    const item = exerciseToItem(ex());
    expect(withItemDose(item, { ...itemDose(item), sessionsPerDay: null }).sessionsPerDay).toBe(2);
  });
  it('turns a saved template row back into an editable item', () => {
    const ti: ExerciseTemplateItem = { ...exerciseToItem(ex()), sortOrder: 0, sourceExerciseId: 'e1' } as unknown as ExerciseTemplateItem;
    expect(templateItemToInput(ti)).toMatchObject({ title: 'Quad Sets', sourceExerciseId: 'e1' });
  });
});

describe('sections', () => {
  const items = [
    exerciseToItem(ex({ id: 'a', title: 'Squat', phase: 'strengthening' })),
    exerciseToItem(ex({ id: 'b', title: 'Marching', phase: 'warm_up' })),
    exerciseToItem(ex({ id: 'c', title: 'Lunge', phase: 'strengthening' })),
    exerciseToItem(ex({ id: 'd', title: 'Calf stretch', phase: 'cool_down' })),
  ];
  it('groups in session order, keeping the order added inside a section, and leaves out empty sections', () => {
    const g = groupItemsByPhase(items);
    expect(g.map((s) => s.phase)).toEqual(['warm_up', 'strengthening', 'cool_down']);
    expect(g[1].rows.map((r) => r.item.title)).toEqual(['Squat', 'Lunge']);
    expect(orderBySection(items).map((i) => i.title)).toEqual(['Marching', 'Squat', 'Lunge', 'Calf stretch']);
  });
  it('moves within a section only', () => {
    expect(moveWithinSection(items, 0, 1).map((i) => i.title)).toEqual(['Lunge', 'Marching', 'Squat', 'Calf stretch']);
    expect(moveWithinSection(items, 1, -1)).toBe(items); // Marching is alone in its section
    expect(moveWithinSection(items, 3, 1)).toBe(items);
  });
  it('lists what the patient needs once each, without None', () => {
    const list = [{ equipment: ['Towel', 'None'] }, { equipment: ['Chair', 'Towel'] }, { equipment: [] }];
    expect(itemsNeed(list)).toEqual(['Towel', 'Chair']);
  });
  it('estimates at least one minute', () => {
    expect(itemsMinutes([])).toBe(1);
    expect(itemsMinutes(items)).toBeGreaterThanOrEqual(1);
  });
});

describe('blocks: warm-up, main exercises, cool-down', () => {
  const mixed = [
    exerciseToItem(ex({ id: 'A', title: 'A', phase: 'cool_down' })),
    exerciseToItem(ex({ id: 'B', title: 'B', phase: 'strengthening' })),
    exerciseToItem(ex({ id: 'C', title: 'C', phase: 'warm_up' })),
    exerciseToItem(ex({ id: 'D', title: 'D', phase: 'other' })),
    exerciseToItem(ex({ id: 'E', title: 'E', phase: 'mobility' })),
  ];
  const titles = (list: { title: string }[]) => list.map((i) => i.title);

  it('saves in session order: warm-up, the six types, other, then cool-down', () => {
    expect(titles(orderBySection(mixed))).toEqual(['C', 'E', 'B', 'D', 'A']);
    expect(groupItemsByPhase(mixed).map((s) => s.phase)).toEqual(['warm_up', 'mobility', 'strengthening', 'other', 'cool_down']);
  });

  it('knows which block a phase belongs to', () => {
    expect(blockOf('warm_up')).toBe('warm_up');
    expect(blockOf('cool_down')).toBe('cool_down');
    expect(blockOf('strengthening')).toBe('main');
    expect(blockOf('other')).toBe('main');
  });

  it('splits a program into its three blocks, with indexes into the whole list', () => {
    const b = programBlocks(mixed);
    expect(b.warmUp.map((r) => [r.item.title, r.index])).toEqual([['C', 2]]);
    expect(b.coolDown.map((r) => [r.item.title, r.index])).toEqual([['A', 0]]);
    expect(b.main.map((s) => s.phase)).toEqual(['mobility', 'strengthening', 'other']);
    expect(b.main.map((s) => s.rows.map((r) => r.item.title))).toEqual([['E'], ['B'], ['D']]);
  });

  it('main keeps the order added inside each section, and empty blocks are empty', () => {
    const items = [
      exerciseToItem(ex({ id: '1', title: 'Squat', phase: 'strengthening' })),
      exerciseToItem(ex({ id: '2', title: 'Bridge', phase: 'activation' })),
      exerciseToItem(ex({ id: '3', title: 'Lunge', phase: 'strengthening' })),
    ];
    const b = programBlocks(items);
    expect(b.warmUp).toEqual([]);
    expect(b.coolDown).toEqual([]);
    expect(b.main.map((s) => [s.phase, s.rows.map((r) => r.item.title)])).toEqual([['activation', ['Bridge']], ['strengthening', ['Squat', 'Lunge']]]);
    expect(programBlocks([])).toEqual({ warmUp: [], main: [], coolDown: [] });
  });

  it('moving to warm-up puts the item at the end of the warm-up, which is saved first', () => {
    const moved = moveToBlock(mixed, 1, 'warm_up', 'strengthening');
    expect(moved).not.toBe(mixed);
    expect(moved.find((i) => i.title === 'B')?.phase).toBe('warm_up');
    expect(titles(orderBySection(moved))).toEqual(['C', 'B', 'E', 'D', 'A']);
    expect(mixed[1].phase).toBe('strengthening'); // the input is untouched
  });

  it('moving to cool-down puts the item at the end of the cool-down, which is saved last', () => {
    const moved = moveToBlock(mixed, 4, 'cool_down', 'mobility');
    expect(titles(orderBySection(moved))).toEqual(['C', 'B', 'D', 'A', 'E']);
  });

  it('moving to main exercises uses the given phase and lands at the end of that section', () => {
    const items = [...mixed, exerciseToItem(ex({ id: 'F', title: 'F', phase: 'mobility' }))];
    const moved = moveToBlock(items, 2, 'main', 'mobility');
    expect(moved.find((i) => i.title === 'C')?.phase).toBe('mobility');
    expect(titles(orderBySection(moved))).toEqual(['E', 'F', 'C', 'B', 'D', 'A']);
  });

  it('never loses an item: the list keeps every item once', () => {
    const moved = moveToBlock(mixed, 0, 'main', 'other');
    expect(moved).toHaveLength(mixed.length);
    expect(titles(moved).sort()).toEqual(['A', 'B', 'C', 'D', 'E']);
  });

  it('a main phase that is not a main section lands in Other', () => {
    expect(moveToBlock(mixed, 2, 'main', 'cool_down').find((i) => i.title === 'C')?.phase).toBe('other');
    expect(moveToBlock(mixed, 2, 'main', 'warm_up').find((i) => i.title === 'C')?.phase).toBe('other');
  });

  it('an index outside the list changes nothing', () => {
    expect(moveToBlock(mixed, 9, 'warm_up', 'other')).toBe(mixed);
    expect(moveToBlock(mixed, -1, 'warm_up', 'other')).toBe(mixed);
  });

  it('back to main: the source exercise type when it is one of the six, otherwise Other', () => {
    const library = [{ id: 'm', phase: 'balance' as const }, { id: 'w', phase: 'warm_up' as const }, { id: 'c', phase: 'cool_down' as const }, { id: 'o', phase: 'other' as const }];
    expect(mainPhaseFor({ sourceExerciseId: 'm' }, library)).toBe('balance');
    expect(mainPhaseFor({ sourceExerciseId: 'w' }, library)).toBe('other'); // legacy warm-up exercise
    expect(mainPhaseFor({ sourceExerciseId: 'c' }, library)).toBe('other'); // legacy cool-down exercise
    expect(mainPhaseFor({ sourceExerciseId: 'o' }, library)).toBe('other');
    expect(mainPhaseFor({ sourceExerciseId: 'gone' }, library)).toBe('other'); // source deleted
    expect(mainPhaseFor({ sourceExerciseId: null }, library)).toBe('other');
  });

  it('an item whose source is unknown moves back to main as Other, never lost', () => {
    const warm = moveToBlock(mixed, 1, 'warm_up', 'strengthening');
    const idx = warm.findIndex((i) => i.title === 'B');
    const back = moveToBlock(warm, idx, 'main', mainPhaseFor(warm[idx], []));
    expect(back.find((i) => i.title === 'B')?.phase).toBe('other');
    expect(titles(orderBySection(back))).toEqual(['C', 'E', 'D', 'B', 'A']);
  });

  it('picker additions into warm-up or cool-down take that block; into main they keep their own type', () => {
    const picked = [exerciseToItem(ex({ id: 'p', phase: 'balance' })), exerciseToItem(ex({ id: 'q', phase: 'other' }))];
    expect(intoBlock(picked, 'cool_down').map((i) => i.phase)).toEqual(['cool_down', 'cool_down']);
    expect(intoBlock(picked, 'warm_up').map((i) => i.phase)).toEqual(['warm_up', 'warm_up']);
    expect(intoBlock(picked, 'main').map((i) => i.phase)).toEqual(['balance', 'other']);
    expect(picked.map((i) => i.phase)).toEqual(['balance', 'other']); // the input is untouched
  });

  it('moving up or down still never crosses into another section or block', () => {
    // C (warm-up) is alone in its block; B is alone in strengthening.
    expect(moveWithinSection(mixed, 2, -1)).toBe(mixed);
    expect(moveWithinSection(mixed, 2, 1)).toBe(mixed);
    expect(moveWithinSection(mixed, 1, 1)).toBe(mixed);
    expect(moveWithinSection(mixed, 0, 1)).toBe(mixed);
  });
});
