// The exercise rows inside a template or a program, as the editors hold them. An item is a COPY of the exercise at the
// moment it was added (never a link), so later edits to the Library never change a template or a patient's program.
import { EXERCISE_PHASES, type Exercise, type ExercisePhase, type ExerciseTemplateItem, type ProgramItem } from '@/domain/hep';
import { estimateSessionMinutes } from '@/domain/hep';
import type { DoseValue } from '@/domain/hepDose';
import type { HepItemInput } from '@/services/hepService';

/** A copy of an exercise, ready to put on a template or program. */
export function exerciseToItem(ex: Exercise): HepItemInput {
  return {
    sourceExerciseId: ex.id,
    title: ex.title,
    bodyRegion: ex.bodyRegion,
    phase: ex.phase,
    instructions: ex.instructions,
    mediaType: ex.mediaType,
    mediaKeys: [...ex.mediaKeys],
    mediaCaptions: [...ex.mediaCaptions],
    equipment: [...ex.equipment],
    doseType: ex.doseType,
    sets: ex.defaultSets,
    reps: ex.doseType === 'timed' ? null : ex.defaultReps,
    holdSeconds: ex.doseType === 'hold' ? ex.defaultHoldSeconds : null,
    durationSeconds: ex.doseType === 'timed' ? ex.defaultDurationSeconds : null,
    restSeconds: ex.defaultRestSeconds,
    sessionsPerDay: ex.defaultSessionsPerDay,
    side: ex.side,
    optional: false,
    stopIf: ex.stopIf,
  };
}

export function templateItemToInput(ti: ExerciseTemplateItem): HepItemInput {
  return {
    sourceExerciseId: ti.sourceExerciseId ?? null,
    title: ti.title, bodyRegion: ti.bodyRegion, phase: ti.phase, instructions: ti.instructions,
    mediaType: ti.mediaType, mediaKeys: [...ti.mediaKeys], mediaCaptions: [...ti.mediaCaptions], equipment: [...ti.equipment],
    doseType: ti.doseType, sets: ti.sets, reps: ti.reps, holdSeconds: ti.holdSeconds, durationSeconds: ti.durationSeconds,
    restSeconds: ti.restSeconds, sessionsPerDay: ti.sessionsPerDay, side: ti.side, optional: ti.optional, stopIf: ti.stopIf,
  };
}

/** A program item as the program sheet edits it: it keeps its id, so a save updates it instead of replacing it. */
export function programItemToInput(pi: ProgramItem): HepItemInput {
  return { ...templateItemToInput(pi as unknown as ExerciseTemplateItem), id: pi.id, specialInstructions: pi.specialInstructions };
}

export function itemDose(item: HepItemInput): DoseValue {
  return {
    kind: item.doseType, sets: item.sets, reps: item.reps, holdSeconds: item.holdSeconds, durationSeconds: item.durationSeconds,
    restSeconds: item.restSeconds, side: item.side, sessionsPerDay: item.sessionsPerDay, optional: item.optional,
  };
}

export function withItemDose(item: HepItemInput, dose: DoseValue): HepItemInput {
  return {
    ...item,
    doseType: dose.kind, sets: dose.sets, reps: dose.reps, holdSeconds: dose.holdSeconds, durationSeconds: dose.durationSeconds,
    restSeconds: dose.restSeconds, side: dose.side, sessionsPerDay: dose.sessionsPerDay ?? item.sessionsPerDay, optional: dose.optional ?? item.optional,
  };
}

export interface ItemSection {
  phase: ExercisePhase;
  /** The items of this section with their position in the whole list (for edits and moves). */
  rows: Array<{ item: HepItemInput; index: number }>;
}

/** Sections in session order (warm-up first ...), each keeping the order the items were added in. Empty sections are left out. */
export function groupItemsByPhase(items: HepItemInput[]): ItemSection[] {
  return EXERCISE_PHASES
    .map((phase) => ({ phase, rows: items.map((item, index) => ({ item, index })).filter((r) => r.item.phase === phase) }))
    .filter((s) => s.rows.length > 0);
}

/** The list in the order a patient does it: section by section. What is saved, so the sort order matches what is shown. */
export function orderBySection(items: HepItemInput[]): HepItemInput[] {
  return groupItemsByPhase(items).flatMap((s) => s.rows.map((r) => r.item));
}

/** Moves an item one place up or down inside its own section (never across sections). */
export function moveWithinSection(items: HepItemInput[], index: number, direction: -1 | 1): HepItemInput[] {
  const phase = items[index]?.phase;
  if (!phase) return items;
  let target = index + direction;
  while (target >= 0 && target < items.length && items[target].phase !== phase) target += direction;
  if (target < 0 || target >= items.length) return items;
  const next = [...items];
  [next[index], next[target]] = [next[target], next[index]];
  return next;
}

/** "Needs: Towel, Chair": equipment across the items, in the order first met, without "None". */
export function itemsNeed(items: Pick<HepItemInput, 'equipment'>[]): string[] {
  return [...new Set(items.flatMap((i) => i.equipment).filter((e) => e && e !== 'None'))];
}

/** About how many minutes the first session takes. */
export function itemsMinutes(items: HepItemInput[], programSessionsPerDay = 1): number {
  return estimateSessionMinutes(items, programSessionsPerDay);
}
