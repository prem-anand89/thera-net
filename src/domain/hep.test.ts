import { describe, expect, it } from 'vitest';
import {
  applySessionsPerDayEdit,
  canonicalRegion,
  computeProgramAdherence,
  estimateItemSeconds,
  estimateSessionMinutes,
  EXERCISE_PHASES,
  EXERCISE_TYPES,
  EXERCISE_TYPE_TONE,
  EXERCISE_TYPE_DEFINITIONS,
  hepAvailableForClinic,
  HEP_POSITIONS,
  SESSION_ORDER,
  isMainType,
  positionsOf,
  HEP_BODY_ORDER,
  isFourDigitPin,
  isHighPainAlert,
  matchesExerciseSearch,
  nextSessionSlotToday,
  regionTree,
  scheduledSessionsPerDayForTomorrow,
  sectionAdherence,
  sectionSkipPattern,
  sessionsPerDayOnDate,
  skippedSlotsToday,
  snapshotExerciseToTemplateItem,
  snapshotTemplateItemToProgramItem,
  suggestedDoseType,
  type Exercise,
  type ProgramItem,
  type ProgramLog,
} from './hep';

function exercise(over: Partial<Exercise> = {}): Exercise {
  return {
    id: 'ex-1', clinicId: 'c-1', title: 'Wall Slides', positions: [], otherNames: [], bodyRegion: 'Shoulder', alsoRegions: [], equipment: [],
    phase: 'strengthening', instructions: 'Slide arms up slowly', mediaType: 'gif', mediaKeys: ['clinics/c-1/exercises/ex-1/0'],
    mediaCaptions: [], thumbKey: null, defaultSets: 3, doseType: 'hold', defaultReps: 10, defaultHoldSeconds: 5, defaultDurationSeconds: null,
    defaultRestSeconds: 30, defaultSessionsPerDay: 2, side: 'both', stopIf: 'Sharp pinching pain', isFavorite: false, active: true,
    deleted: false, version: 1, createdAt: '2026-11-01T00:00:00Z', updatedAt: '2026-11-01T00:00:00Z', ...over,
  };
}

function item(over: Partial<ProgramItem> = {}): ProgramItem {
  return {
    id: 'pi-1', programId: 'p-1', title: 'Bridges', bodyRegion: 'Spine / Back', phase: 'strengthening', equipment: [], instructions: '',
    mediaType: 'none', mediaKeys: [], mediaCaptions: [], doseType: 'reps', sets: 3, reps: 10, holdSeconds: null, durationSeconds: null,
    restSeconds: 30, sessionsPerDay: 2, sessionsSchedule: [{ from: '2026-11-09', sessionsPerDay: 2 }], side: 'none', optional: false, stopIf: '',
    specialInstructions: '', sortOrder: 0, addedOn: '2026-11-09', removedOn: null, ...over,
  };
}

const log = (programItemId: string, logDate: string, sessionIndex: 1 | 2 | 3, skipped = false): ProgramLog => ({
  id: `${programItemId}-${logDate}-${sessionIndex}`, programItemId, logDate, sessionIndex, skipped, completedAt: `${logDate}T10:00:00Z`,
});

describe('PIN and pain', () => {
  it('accepts exactly four digits as a PIN and nothing else', () => {
    expect(isFourDigitPin('3210')).toBe(true);
    expect(isFourDigitPin('321')).toBe(false);
    expect(isFourDigitPin('32100')).toBe(false);
    expect(isFourDigitPin('32a0')).toBe(false);
  });
  it('flags a session pain score of 7 or more', () => {
    expect(isHighPainAlert(6)).toBe(false);
    expect(isHighPainAlert(7)).toBe(true);
    expect(isHighPainAlert(10)).toBe(true);
    expect(isHighPainAlert(null)).toBe(false);
  });
});

describe('snapshots are copies, not links', () => {
  it('later library or template edits never change a saved copy', () => {
    const lib = exercise({ equipment: ['Wall'], mediaCaptions: ['Start'] });
    const tmpl = snapshotExerciseToTemplateItem(lib, 0);
    const prog = snapshotTemplateItemToProgramItem(tmpl, '2026-11-08', 0);
    lib.title = 'CHANGED';
    lib.mediaKeys.push('x');
    lib.equipment.push('Chair');
    tmpl.title = 'CHANGED TOO';
    expect(prog.title).toBe('Wall Slides');
    expect(prog.mediaKeys).toEqual(['clinics/c-1/exercises/ex-1/0']);
    expect(prog.equipment).toEqual(['Wall']);
    expect(prog.mediaCaptions).toEqual(['Start']);
    expect(prog).toMatchObject({ doseType: 'hold', sets: 3, reps: 10, holdSeconds: 5, restSeconds: 30, side: 'both', optional: false, addedOn: '2026-11-08' });
  });
});

describe('times a day: today sticks, the change starts tomorrow', () => {
  it('keeps today at the old number and applies the new one from tomorrow', () => {
    const edited = applySessionsPerDayEdit(item({ sessionsSchedule: [{ from: '2026-11-08', sessionsPerDay: 2 }], addedOn: '2026-11-08' }), 3, '2026-11-10');
    expect(edited.sessionsPerDay).toBe(2);
    expect(sessionsPerDayOnDate(edited, '2026-11-10')).toBe(2);
    expect(sessionsPerDayOnDate(edited, '2026-11-11')).toBe(3);
    expect(scheduledSessionsPerDayForTomorrow(edited, '2026-11-10')).toBe(3);
  });
  it('a skipped morning session stays open for the evening one', () => {
    const it = item({ sessionsSchedule: [{ from: '2026-11-10', sessionsPerDay: 2 }], addedOn: '2026-11-10' });
    const morningSkipped = log('pi-1', '2026-11-10', 1, true);
    const after1 = nextSessionSlotToday(it, [morningSkipped], '2026-11-10');
    expect(after1).toMatchObject({ nextSlot: 2, completedCount: 0, skippedCount: 1, target: 2 });
    const after2 = nextSessionSlotToday(it, [morningSkipped, log('pi-1', '2026-11-10', 2)], '2026-11-10');
    expect(after2).toMatchObject({ nextSlot: null, completedCount: 1, skippedCount: 1 });
    expect(skippedSlotsToday(it, [morningSkipped, log('pi-1', '2026-11-10', 2)], '2026-11-10')).toEqual([1]);
  });
});

describe('habit over finished days', () => {
  const a = item({ id: 'pi-1' });
  const addedToday = item({ id: 'pi-2', sessionsPerDay: 1, sessionsSchedule: [{ from: '2026-11-10', sessionsPerDay: 1 }], addedOn: '2026-11-10' });
  const logs = [log('pi-1', '2026-11-09', 1), log('pi-1', '2026-11-09', 2, true), log('pi-1', '2026-11-10', 1)];

  it('counts finished days only, leaves out an exercise added today, and shows today apart', () => {
    const r = computeProgramAdherence({ startDate: '2026-11-09', today: '2026-11-10', items: [a, addedToday], logs });
    expect(r.finishedDaysPercent).toBe(50); // yesterday 1 of 2; the skipped session does not count
    expect(r.finishedDays).toBe(1);
    expect(r.todayCompleted).toBe(1);
    expect(r.todayTarget).toBe(3);
    expect(r.missedYesterday).toBe(true);
  });
  it('is null before the first day has finished', () => {
    expect(computeProgramAdherence({ startDate: '2026-11-10', today: '2026-11-10', items: [a], logs: [] }).finishedDaysPercent).toBeNull();
  });
  it('ignores optional exercises everywhere (today, the habit and yesterday)', () => {
    const opt = item({ id: 'pi-3', optional: true });
    const r = computeProgramAdherence({ startDate: '2026-11-09', today: '2026-11-10', items: [a, addedToday, opt], logs });
    expect(r.finishedDaysPercent).toBe(50);
    expect(r.todayTarget).toBe(3);
  });
  it('does not count days after the program\'s last day', () => {
    const r = computeProgramAdherence({
      startDate: '2026-11-01', today: '2026-11-12', durationDays: 3, items: [item({ id: 'pi-1', sessionsPerDay: 1, sessionsSchedule: [], addedOn: '2026-11-01' })],
      logs: [log('pi-1', '2026-11-01', 1), log('pi-1', '2026-11-02', 1), log('pi-1', '2026-11-03', 1)],
    });
    expect(r.finishedDaysPercent).toBe(100);
    expect(r.finishedDays).toBe(3);
  });
});

describe('sections: how a patient does only some of it', () => {
  const mobility = item({ id: 'm', phase: 'mobility', sessionsPerDay: 1, sessionsSchedule: [], addedOn: '2026-11-01' });
  const strength = item({ id: 's', phase: 'strengthening', sessionsPerDay: 1, sessionsSchedule: [], addedOn: '2026-11-01' });
  const common = { items: [mobility, strength], startDate: '2026-11-01', today: '2026-11-08' };
  const mobilityOnly = ['2026-11-02', '2026-11-03', '2026-11-04', '2026-11-05', '2026-11-06', '2026-11-07'].map((d) => log('m', d, 1));

  it('gives a percent per section', () => {
    const r = sectionAdherence({ ...common, logs: mobilityOnly, days: 6 });
    expect(r.find((x) => x.phase === 'mobility')).toMatchObject({ percent: 100 });
    expect(r.find((x) => x.phase === 'strengthening')).toMatchObject({ percent: 0, expected: 6 });
  });
  it('lists sections in session order: other before cool-down', () => {
    const cool = item({ id: 'c', phase: 'cool_down', sessionsPerDay: 1, sessionsSchedule: [], addedOn: '2026-11-01' });
    const other = item({ id: 'o', phase: 'other', sessionsPerDay: 1, sessionsSchedule: [], addedOn: '2026-11-01' });
    const r = sectionAdherence({ ...common, items: [cool, other, mobility], logs: [] });
    expect(r.map((x) => x.phase)).toEqual(['mobility', 'other', 'cool_down']);
  });
  it('signals a section skipped on 4 or more of the last 5 finished days while the rest was done', () => {
    expect(sectionSkipPattern({ ...common, logs: mobilityOnly })).toEqual([{ phase: 'strengthening', missedDays: 5, ofDays: 5 }]);
  });
  it('does not signal when the whole program was missed, or a section is only occasionally missed', () => {
    expect(sectionSkipPattern({ ...common, logs: [] })).toEqual([]);
    const sometimes = [...mobilityOnly, log('s', '2026-11-07', 1), log('s', '2026-11-06', 1)];
    expect(sectionSkipPattern({ ...common, logs: sometimes })).toEqual([]);
  });
  it('needs at least 4 finished days', () => {
    expect(sectionSkipPattern({ items: [mobility, strength], startDate: '2026-11-05', today: '2026-11-08', logs: mobilityOnly })).toEqual([]);
  });
});

describe('regions and the Library side list', () => {
  const ex = (bodyRegion: string, phase: Exercise['phase'], alsoRegions: string[] = [], active = true) => ({ bodyRegion, phase, alsoRegions, active, deleted: false });

  it('canonicalises region names: case, plural, and unknown names kept tidy', () => {
    expect(canonicalRegion('shoulders')).toBe('Shoulder');
    expect(canonicalRegion('  KNEE ')).toBe('Knee');
    expect(canonicalRegion('pelvic floor: women')).toBe('Pelvic floor: Women');
    expect(canonicalRegion('  temporomandibular   joint ')).toBe('Temporomandibular joint');
  });

  it('lists regions head to toe with counts and types in session order; also-regions count too', () => {
    const tree = regionTree([ex('Hip', 'strengthening', ['Core', 'Pelvic floor: Women']), ex('Hip', 'warm_up'), ex('Shoulder', 'stretching'), ex('shoulders', 'mobility')]);
    expect(tree.map((n) => n.region)).toEqual([...HEP_BODY_ORDER]);
    const get = (r: string) => tree.find((n) => n.region === r)!;
    expect(get('Hip')).toMatchObject({ count: 2, types: [{ phase: 'warm_up', count: 1 }, { phase: 'strengthening', count: 1 }] });
    expect(get('Core').count).toBe(1);
    expect(get('Shoulder').types.map((t) => t.phase)).toEqual(['mobility', 'stretching']);
    expect(get('Neck').count).toBe(0);
  });

  it('puts Pelvic floor Women and Men inside one group', () => {
    const tree = regionTree([ex('Hip', 'strengthening', ['Pelvic floor: Women']), ex('Pelvic floor: Men', 'activation')]);
    const pf = tree.find((n) => n.region === 'Pelvic floor')!;
    expect(pf.count).toBe(2);
    expect(pf.children!.map((c) => [c.region, c.count])).toEqual([['Pelvic floor: Women', 1], ['Pelvic floor: Men', 1]]);
  });

  it('adds the clinic\'s own regions after the fixed ones, A to Z, and hides archived and deleted exercises', () => {
    const tree = regionTree([ex('Jaw', 'activation'), ex('Chest', 'mobility'), ex('Knee', 'balance', [], false), { ...ex('Knee', 'balance'), deleted: true }]);
    expect(tree.slice(-2).map((n) => n.region)).toEqual(['Chest', 'Jaw']);
    expect(tree.find((n) => n.region === 'Knee')!.count).toBe(0);
    expect(regionTree([ex('Knee', 'balance', [], false)], { includeArchived: true }).find((n) => n.region === 'Knee')!.count).toBe(1);
  });

});

describe('search forgives wording (other names, plurals, hyphens, typos)', () => {
  const slr = exercise({ title: 'Straight Leg Raise', otherNames: ['SLR'], bodyRegion: 'Knee', alsoRegions: ['Hip'], phase: 'strengthening', equipment: [] });
  const clams = exercise({ title: 'Clamshells', otherNames: ['Clams'], bodyRegion: 'Hip', phase: 'strengthening', equipment: ['Theraband / resistance band'] });
  const hamstring = exercise({ title: 'Hamstring Stretch', bodyRegion: 'Knee', phase: 'stretching', equipment: ['Towel'] });
  const rows = exercise({ title: 'Wall Push-up', bodyRegion: 'Shoulder', equipment: ['Wall'] });

  it.each([
    ['slr', slr], ['SLR', slr], ['straight leg raises', slr], ['clam', clams], ['clams', clams], ['band', clams], ['theraband', clams],
    ['hamstrig', hamstring], ['hamstring stretches', hamstring], ['push up', rows], ['pushup wall', rows], ['stretching knee', hamstring], ['', slr],
  ])('"%s" finds the exercise', (query, target) => {
    expect(matchesExerciseSearch(target, query as string)).toBe(true);
  });

  it.each([['slr', clams], ['shoulder', hamstring], ['knee towel stretch band', hamstring], ['ham', rows]])('"%s" does not find an unrelated exercise', (query, target) => {
    expect(matchesExerciseSearch(target, query as string)).toBe(false);
  });

  it('allows a typo only in longer words', () => {
    expect(matchesExerciseSearch(slr, 'slx')).toBe(false);
  });
});

describe('suggested kind and session time estimate', () => {
  it('suggests the kind from the type', () => {
    expect(suggestedDoseType('stretching')).toBe('hold');
    expect(suggestedDoseType('activation')).toBe('hold');
    expect(suggestedDoseType('cool_down')).toBe('hold');
    expect(suggestedDoseType('balance')).toBe('timed');
    for (const p of ['warm_up', 'mobility', 'strengthening', 'functional', 'other'] as const) expect(suggestedDoseType(p)).toBe('reps');
    expect(EXERCISE_PHASES[1]).toBe('mobility'); // moving before holding
  });

  const base = { doseType: 'reps' as const, sets: 3, reps: 10, holdSeconds: null, durationSeconds: null, restSeconds: 30, side: 'none' as const, sessionsPerDay: null };

  it('counts reps at about 4 s, holds and timed with the fixed pauses, both sides twice, rest between sets, and 20 s to change exercise', () => {
    expect(estimateItemSeconds(base)).toBe(3 * 10 * 4 + 2 * 30 + 20); // 200
    expect(estimateItemSeconds({ ...base, doseType: 'hold', sets: 1, reps: 10, holdSeconds: 5, restSeconds: 0 })).toBe(5 + 10 * 8 + 9 * 4 + 20); // 141
    expect(estimateItemSeconds({ ...base, doseType: 'timed', sets: 2, reps: null, durationSeconds: 30, restSeconds: 15 })).toBe(2 * (5 + 30 + 3) + 15 + 20); // 111
    expect(estimateItemSeconds({ ...base, side: 'both' })).toBe(2 * 3 * 10 * 4 + 2 * 30 + 20); // 320
  });

  it('rounds the session to whole minutes (at least 1) with no upper limit and no warning', () => {
    expect(estimateSessionMinutes([], 1)).toBe(1);
    expect(estimateSessionMinutes([base], 1)).toBe(3);
    expect(estimateSessionMinutes(Array.from({ length: 20 }, () => base), 1)).toBe(67);
  });

  it('counts only the exercises that fall in that session (override or the program\'s times a day)', () => {
    const items = [{ ...base }, { ...base, sessionsPerDay: 1 }];
    expect(estimateSessionMinutes(items, 2, 1)).toBe(7); // 400 s
    expect(estimateSessionMinutes(items, 2, 2)).toBe(3); // only the one that follows the program's 2 a day
  });
});

describe('exercise types, positions and session order', () => {
  it('orders a session warm-up first, cool-down last, other second to last', () => {
    expect(SESSION_ORDER[0]).toBe('warm_up');
    expect(SESSION_ORDER[SESSION_ORDER.length - 1]).toBe('cool_down');
    expect(SESSION_ORDER[SESSION_ORDER.length - 2]).toBe('other');
    expect([...SESSION_ORDER].sort()).toEqual([...EXERCISE_PHASES].sort());
  });
  it('has exactly the six main types, each defined, and isMainType tells them from the rest', () => {
    expect([...EXERCISE_TYPES]).toEqual(['mobility', 'stretching', 'activation', 'strengthening', 'balance', 'functional']);
    for (const t of EXERCISE_TYPES) expect(EXERCISE_TYPE_DEFINITIONS[t].length).toBeGreaterThan(0);
    expect(EXERCISE_TYPE_DEFINITIONS.mobility).toBe('Active or assisted range of motion. Default dosage: repetitions.');
    expect(isMainType('balance')).toBe(true);
    for (const p of ['warm_up', 'cool_down', 'other'] as const) expect(isMainType(p)).toBe(false);
  });
  it('gives every phase a tone', () => {
    for (const p of EXERCISE_PHASES) expect(EXERCISE_TYPE_TONE[p], p).toBeTruthy();
    expect(EXERCISE_TYPE_TONE.mobility).toBe('sky');
    expect(EXERCISE_TYPE_TONE.warm_up).toBe('slate');
  });
  it('lists the seven positions, and positionsOf copes with old rows that have none', () => {
    expect(HEP_POSITIONS).toHaveLength(7);
    expect(positionsOf({} as Pick<Exercise, 'positions'>)).toEqual([]);
    expect(positionsOf({ positions: ['Prone'] })).toEqual(['Prone']);
  });
  it('finds an exercise by its position in search', () => {
    const base = { title: 'Bridge', otherNames: [], bodyRegion: 'Hip', alsoRegions: [], phase: 'strengthening' as const, equipment: [] };
    expect(matchesExerciseSearch({ ...base, positions: ['Supine'] }, 'Supine')).toBe(true);
    expect(matchesExerciseSearch({ ...base, positions: ['Prone'] }, 'Supine')).toBe(false);
    expect(matchesExerciseSearch(base as never, 'bridge')).toBe(true);
  });
});

describe('hepAvailableForClinic', () => {
  it('enables HEP only for Beyond Mechanics and Physio Clinic (case-insensitive, trimmed)', () => {
    expect(hepAvailableForClinic({ name: 'Beyond Mechanics' })).toBe(true);
    expect(hepAvailableForClinic({ name: '  beyond mechanics  ' })).toBe(true);
    expect(hepAvailableForClinic({ name: 'Physio Clinic' })).toBe(true);
    expect(hepAvailableForClinic({ name: 'physio clinic' })).toBe(true);
    expect(hepAvailableForClinic({ name: 'Sunrise Physio' })).toBe(false);
    expect(hepAvailableForClinic({ name: '' })).toBe(false);
    expect(hepAvailableForClinic(null)).toBe(false);
  });
});
