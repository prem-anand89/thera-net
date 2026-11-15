import { describe, expect, it } from 'vitest';
import type { Exercise, ExerciseTemplateItem } from '@/domain/hep';
import { exerciseToItem, groupItemsByPhase, itemDose, itemsMinutes, itemsNeed, moveWithinSection, orderBySection, templateItemToInput, withItemDose } from './hepItems';

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
