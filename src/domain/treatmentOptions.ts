/**
 * Treatment/intervention vocabulary shared between the heavy Core
 * Assessment editor's three-way split (manual therapy / therapeutic
 * exercise / modalities — see coreAssessment.ts's inline options in
 * NoteEditorPage.tsx) and the light session note's single combined
 * Intervention field. Extracted here, unchanged, so both editors draw from
 * one list rather than drifting — and so dashboardService.ts's
 * modalityUsage aggregate can recognize the modality subset regardless of
 * which note kind picked it.
 */

export const MODALITY_OPTIONS = [
  'Ultrasound',
  'TENS',
  'IFC',
  'Heat/ice',
  'Laser',
  'Shockwave',
] as const;

export const MANUAL_THERAPY_OPTIONS = [
  'Joint mobilisation',
  'Manipulation',
  'MFR',
  'Taping',
  'Dry needling',
] as const;

export const THERAPEUTIC_EXERCISE_OPTIONS = [
  'Strengthening',
  'Stretching',
  'ROM',
  'Neuromuscular',
  'Balance',
  'Plyometric',
] as const;

/** A session note's single Intervention field combines all three heavy
 *  categories — SOAP's "I" isn't modality-only, unlike the heavy editor's
 *  dedicated modalities picker. */
export const SESSION_INTERVENTION_OPTIONS = [
  ...MANUAL_THERAPY_OPTIONS,
  ...THERAPEUTIC_EXERCISE_OPTIONS,
  ...MODALITY_OPTIONS,
] as const;
