import { canonicalEquipment, canonicalRegion, type Exercise, type StarterLibraryItem } from '@/domain/hep';
import { doseToExerciseFields } from '@/domain/hepDose';
import type { StarterExercise } from '@/domain/hepStarterSet';
import type { SaveExerciseInput } from '@/services/hepService';

/** A starter library row (text or pictured) as a save request into the receiving clinic's own Library. */
export function starterItemToSaveInput(
  clinicId: string,
  s: StarterLibraryItem,
  exerciseId: string,
  clonedMedia: { mediaKeys: string[]; thumbKey: string | null } = { mediaKeys: [], thumbKey: null },
): SaveExerciseInput {
  return {
    id: exerciseId,
    clinicId,
    title: s.title,
    otherNames: s.otherNames,
    bodyRegion: canonicalRegion(s.bodyRegion),
    alsoRegions: s.alsoRegions.map(canonicalRegion),
    equipment: s.equipment.map(canonicalEquipment),
    phase: s.phase,
    alsoPhases: s.alsoPhases,
    positions: [...s.positions],
    instructions: s.instructions,
    mediaType: clonedMedia.mediaKeys.length > 0 ? s.mediaType : 'none',
    mediaKeys: clonedMedia.mediaKeys,
    mediaCaptions: clonedMedia.mediaKeys.length > 0 ? s.mediaCaptions : [],
    thumbKey: clonedMedia.thumbKey,
    pictureConsent: clonedMedia.mediaKeys.length > 0,
    stopIf: s.stopIf,
    active: true,
    defaultSets: s.defaultSets,
    doseType: s.doseType,
    defaultReps: s.defaultReps,
    defaultHoldSeconds: s.defaultHoldSeconds,
    defaultDurationSeconds: s.defaultDurationSeconds,
    defaultRestSeconds: s.defaultRestSeconds,
    defaultSessionsPerDay: s.defaultSessionsPerDay,
    side: s.side,
  };
}

/** A starter exercise as a save request: text only, no pictures. The clinic adds photos later in the Edit form. */
export function starterToSaveInput(clinicId: string, s: StarterExercise): SaveExerciseInput {
  const dose = doseToExerciseFields({
    kind: s.dose.kind, sets: s.dose.sets, reps: s.dose.reps ?? null, holdSeconds: s.dose.holdSeconds ?? null, durationSeconds: s.dose.durationSeconds ?? null,
    restSeconds: s.dose.restSeconds, side: s.dose.side, sessionsPerDay: s.dose.perDay,
  });
  return {
    clinicId,
    title: s.title,
    otherNames: s.otherNames ?? [],
    bodyRegion: canonicalRegion(s.region),
    alsoRegions: (s.alsoRegions ?? []).map(canonicalRegion),
    equipment: (s.equipment ?? []).map(canonicalEquipment),
    phase: s.phase,
    positions: [...s.positions],
    instructions: s.steps.join('\n'),
    mediaType: 'none',
    mediaKeys: [],
    mediaCaptions: [],
    thumbKey: null,
    stopIf: s.stopIf,
    active: true,
    ...dose,
  };
}

/** The saved exercise as the local list will hold it until the next sync brings the server's row. */
export function exerciseFromSaveInput(input: SaveExerciseInput, id: string, now = new Date().toISOString()): Exercise {
  return {
    id, clinicId: input.clinicId, title: input.title, otherNames: input.otherNames ?? [], bodyRegion: input.bodyRegion, alsoRegions: input.alsoRegions ?? [], equipment: input.equipment ?? [],
    phase: input.phase, alsoPhases: input.alsoPhases ?? [], positions: input.positions ?? [], instructions: input.instructions, mediaType: input.mediaType, mediaKeys: input.mediaKeys ?? [], mediaCaptions: input.mediaCaptions ?? [], thumbKey: input.thumbKey ?? null,
    pictureConsentAt: null, pictureConsentBy: null, hidePicturesInLists: input.hidePicturesInLists ?? false,
    defaultSets: input.defaultSets, doseType: input.doseType, defaultReps: input.defaultReps, defaultHoldSeconds: input.defaultHoldSeconds, defaultDurationSeconds: input.defaultDurationSeconds,
    defaultRestSeconds: input.defaultRestSeconds, defaultSessionsPerDay: input.defaultSessionsPerDay, side: input.side, stopIf: input.stopIf, isFavorite: false, active: input.active ?? true,
    deleted: false, version: 1, createdAt: now, updatedAt: now,
  };
}
