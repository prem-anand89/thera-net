// Shared TheraNet Library service: reads the curated `starter_exercises` catalog (with offline/pre-migration fallback
// to the static STARTER_EXERCISES list) and lets Beyond Mechanics & Physio Clinic publish, update, or remove entries.
import {
  alsoPhasesOf,
  canonicalEquipment,
  canonicalRegion,
  type Exercise,
  type LibraryProvenance,
  type StarterLibraryItem,
} from '@/domain/hep';
import { doseToExerciseFields } from '@/domain/hepDose';
import { STARTER_EXERCISES, type StarterExercise } from '@/domain/hepStarterSet';
import { getSupabase } from '@/lib/supabase';
import { rowToDomain } from '@/repositories/rowMapping';
import { hepMediaService } from './hepMediaService';
import { HEP_NEEDS_CONNECTION } from './hepService';

type Row = Record<string, unknown>;

function requireOnline() {
  const supabase = getSupabase();
  if (!supabase) throw new Error('Supabase is not configured');
  if (typeof navigator !== 'undefined' && navigator.onLine === false) throw new Error(HEP_NEEDS_CONNECTION);
  return supabase;
}

export function fromStaticStarter(s: StarterExercise, index: number): StarterLibraryItem {
  const dose = doseToExerciseFields({
    kind: s.dose.kind,
    sets: s.dose.sets,
    reps: s.dose.reps ?? null,
    holdSeconds: s.dose.holdSeconds ?? null,
    durationSeconds: s.dose.durationSeconds ?? null,
    restSeconds: s.dose.restSeconds,
    side: s.dose.side,
    sessionsPerDay: s.dose.perDay,
  });
  return {
    id: `static-${index}`,
    sourceClinicId: null,
    sourceExerciseId: null,
    title: s.title,
    otherNames: s.otherNames ?? [],
    bodyRegion: canonicalRegion(s.region),
    alsoRegions: (s.alsoRegions ?? []).map(canonicalRegion),
    phase: s.phase,
    alsoPhases: [],
    positions: [...s.positions],
    equipment: (s.equipment ?? []).map(canonicalEquipment),
    instructions: s.steps.join('\n'),
    stopIf: s.stopIf,
    mediaType: 'none',
    mediaKeys: [],
    mediaCaptions: [],
    thumbKey: null,
    ...dose,
    publishedAt: null,
  };
}

export function staticStarterItems(): StarterLibraryItem[] {
  return STARTER_EXERCISES.map(fromStaticStarter);
}

function mapRow(r: Row): StarterLibraryItem {
  const m = rowToDomain<Record<string, unknown>>(r);
  return {
    id: String(m.id),
    sourceClinicId: (m.sourceClinicId as string | null) ?? null,
    sourceExerciseId: (m.sourceExerciseId as string | null) ?? null,
    title: String(m.title ?? ''),
    otherNames: (m.otherNames as string[]) ?? [],
    bodyRegion: canonicalRegion(String(m.bodyRegion ?? '')),
    alsoRegions: ((m.alsoRegions as string[]) ?? []).map(canonicalRegion),
    phase: (m.phase as StarterLibraryItem['phase']) ?? 'other',
    alsoPhases: (m.alsoPhases as StarterLibraryItem['alsoPhases']) ?? [],
    positions: (m.positions as string[]) ?? [],
    equipment: ((m.equipment as string[]) ?? []).map(canonicalEquipment),
    instructions: String(m.instructions ?? ''),
    stopIf: String(m.stopIf ?? ''),
    mediaType: (m.mediaType as StarterLibraryItem['mediaType']) ?? 'none',
    mediaKeys: (m.mediaKeys as string[]) ?? [],
    mediaCaptions: (m.mediaCaptions as string[]) ?? [],
    thumbKey: (m.thumbKey as string | null) ?? null,
    doseType: (m.doseType as StarterLibraryItem['doseType']) ?? 'reps',
    defaultSets: Number(m.defaultSets ?? 3),
    defaultReps: m.defaultReps == null ? null : Number(m.defaultReps),
    defaultHoldSeconds: m.defaultHoldSeconds == null ? null : Number(m.defaultHoldSeconds),
    defaultDurationSeconds: m.defaultDurationSeconds == null ? null : Number(m.defaultDurationSeconds),
    defaultRestSeconds: Number(m.defaultRestSeconds ?? 30),
    defaultSessionsPerDay: Number(m.defaultSessionsPerDay ?? 1) as StarterLibraryItem['defaultSessionsPerDay'],
    side: (m.side as StarterLibraryItem['side']) ?? 'none',
    publishedAt: (m.publishedAt as string | null) ?? null,
  };
}

export const starterLibraryService = {
  /** Lists active TheraNet Library items from Supabase, falling back cleanly to static STARTER_EXERCISES offline or before migration. */
  async listStarterItems(): Promise<StarterLibraryItem[]> {
    const supabase = getSupabase();
    if (!supabase || (typeof navigator !== 'undefined' && navigator.onLine === false)) {
      return staticStarterItems();
    }
    try {
      const { data, error } = await supabase
        .from('starter_exercises')
        .select('*')
        .eq('active', true)
        .order('title');
      if (error || !data) return staticStarterItems();
      const dbItems = (data as Row[]).map(mapRow);
      const seenTitles = new Set(dbItems.map((item) => item.title.trim().toLowerCase()));
      const unshadowedBuiltIns = staticStarterItems().filter(
        (item) => !seenTitles.has(item.title.trim().toLowerCase()),
      );
      return [...dbItems, ...unshadowedBuiltIns];
    } catch {
      return staticStarterItems();
    }
  },

  /** Returns the active Starter entry already published from this clinic exercise, or null. */
  async findPublishedForExercise(clinicId: string, exerciseId: string): Promise<StarterLibraryItem | null> {
    const supabase = getSupabase();
    if (!supabase || (typeof navigator !== 'undefined' && navigator.onLine === false)) return null;
    try {
      const { data, error } = await supabase
        .from('starter_exercises')
        .select('*')
        .eq('source_clinic_id', clinicId)
        .eq('source_exercise_id', exerciseId)
        .eq('active', true)
        .maybeSingle();
      if (error || !data) return null;
      return mapRow(data as Row);
    } catch {
      return null;
    }
  },

  /** Curator-only: publishes or updates a clinic exercise into the shared TheraNet Library (cloning any pictures to `starter/exercises/`). */
  async publishExercise(
    clinicId: string,
    ex: Exercise,
    existingStarterId?: string | null,
    provenance?: LibraryProvenance,
  ): Promise<string> {
    const supabase = requireOnline();
    if (ex.hidePicturesInLists) {
      throw new Error('Turn off "Hide pictures in lists" in Media and instructions before sharing to the TheraNet Library.');
    }
    const existing = existingStarterId ? null : await this.findPublishedForExercise(clinicId, ex.id);
    const starterId = existingStarterId ?? existing?.id ?? crypto.randomUUID();
    const cloned =
      ex.mediaKeys.length > 0
        ? await hepMediaService.cloneToStarter(clinicId, starterId, ex.mediaKeys, ex.thumbKey)
        : { mediaKeys: [], thumbKey: null };

    const { data, error } = await supabase.rpc('publish_starter_exercise', {
      p_clinic_id: clinicId,
      p_source_exercise_id: ex.id,
      p_starter_id: starterId,
      p_title: ex.title.trim(),
      p_other_names: ex.otherNames,
      p_body_region: ex.bodyRegion,
      p_also_regions: ex.alsoRegions,
      p_phase: ex.phase,
      p_also_phases: alsoPhasesOf(ex),
      p_positions: ex.positions ?? [],
      p_equipment: ex.equipment,
      p_instructions: ex.instructions,
      p_stop_if: ex.stopIf,
      p_media_type: ex.mediaType,
      p_media_keys: cloned.mediaKeys,
      p_media_captions: ex.mediaCaptions,
      p_thumb_key: cloned.thumbKey,
      p_dose_type: ex.doseType,
      p_default_sets: ex.defaultSets,
      p_default_reps: ex.defaultReps,
      p_default_hold_seconds: ex.defaultHoldSeconds,
      p_default_duration_seconds: ex.defaultDurationSeconds,
      p_default_rest_seconds: ex.defaultRestSeconds,
      p_default_sessions_per_day: ex.defaultSessionsPerDay,
      p_side: ex.side,
      p_image_source: cloned.mediaKeys.length > 0 ? (provenance?.imageSource ?? null) : null,
      p_image_note: cloned.mediaKeys.length > 0 ? (provenance?.imageNote ?? null) : null,
    });
    if (error) throw new Error(error.message);
    return (data as string) ?? starterId;
  },

  /**
   * Curator-only: publishes several clinic exercises one after another. Archived exercises and ones that hide their
   * pictures in lists are skipped with a reason; a failure on one does not stop the rest.
   */
  async publishMany(
    clinicId: string,
    exercises: Exercise[],
    provenance: LibraryProvenance,
    onProgress?: (done: number, total: number) => void,
  ): Promise<{ published: number; skipped: Array<{ id: string; title: string; reason: string }> }> {
    const skipped: Array<{ id: string; title: string; reason: string }> = [];
    let published = 0;
    for (const [i, ex] of exercises.entries()) {
      if (!ex.active) skipped.push({ id: ex.id, title: ex.title, reason: 'it is archived' });
      else if (ex.hidePicturesInLists) skipped.push({ id: ex.id, title: ex.title, reason: 'its pictures are hidden in lists' });
      else {
        try {
          await this.publishExercise(clinicId, ex, null, provenance);
          published += 1;
        } catch (e) {
          skipped.push({ id: ex.id, title: ex.title, reason: e instanceof Error ? e.message : 'it could not be published' });
        }
      }
      onProgress?.(i + 1, exercises.length);
    }
    return { published, skipped };
  },

  /** Curator-only: removes a TheraNet Library entry from future browsing without affecting clinics that already copied it. */
  async unpublishExercise(clinicId: string, starterId: string): Promise<void> {
    const supabase = requireOnline();
    const { error } = await supabase.rpc('unpublish_starter_exercise', {
      p_clinic_id: clinicId,
      p_starter_id: starterId,
    });
    if (error) throw new Error(error.message);
  },
};
