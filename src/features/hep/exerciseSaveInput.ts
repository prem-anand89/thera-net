import type { Exercise } from '@/domain/hep';
import type { SaveExerciseInput } from '@/services/hepService';

/**
 * save_exercise overwrites every field, so Archive, Restore, Delete and Duplicate send the whole exercise back with
 * one thing changed. This builds that request from a saved exercise.
 */
export function exerciseToSaveInput(ex: Exercise, over: Partial<SaveExerciseInput> = {}): SaveExerciseInput {
  return {
    id: ex.id,
    clinicId: ex.clinicId,
    title: ex.title,
    otherNames: ex.otherNames,
    bodyRegion: ex.bodyRegion,
    alsoRegions: ex.alsoRegions,
    equipment: ex.equipment,
    phase: ex.phase,
    instructions: ex.instructions,
    mediaType: ex.mediaType,
    mediaKeys: ex.mediaKeys,
    mediaCaptions: ex.mediaCaptions,
    thumbKey: ex.thumbKey,
    defaultSets: ex.defaultSets,
    doseType: ex.doseType,
    defaultReps: ex.defaultReps,
    defaultHoldSeconds: ex.defaultHoldSeconds,
    defaultDurationSeconds: ex.defaultDurationSeconds,
    defaultRestSeconds: ex.defaultRestSeconds,
    defaultSessionsPerDay: ex.defaultSessionsPerDay,
    side: ex.side,
    stopIf: ex.stopIf,
    active: ex.active,
    ...over,
  };
}
