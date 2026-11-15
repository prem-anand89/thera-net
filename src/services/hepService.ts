// HEP (home exercise programs): the clinic side. Reads of the exercise library come from the local read-only cache
// (Dexie `exercises`, synced like appointments); every write goes through an online-only RPC (caps and snapshots are
// enforced by the server). The patient page has its own file: publicHepService.ts.
import { db } from '@/lib/db';
import { getSupabase } from '@/lib/supabase';
import { rowToDomain } from '@/repositories/rowMapping';
import { syncEngine } from '@/sync/engine';
import type {
  DoseType,
  Exercise,
  ExerciseMediaType,
  ExercisePhase,
  ExerciseSide,
  ExerciseTemplate,
  ExerciseTemplateItem,
  Program,
  ProgramItem,
  ProgramLog,
  ProgramStatus,
  SessionsPerDay,
} from '@/domain/hep';

export const HEP_NEEDS_CONNECTION = 'HEP changes need a connection. Reconnect and try again.';

function requireOnline() {
  const supabase = getSupabase();
  if (!supabase) throw new Error('Supabase is not configured');
  if (typeof navigator !== 'undefined' && navigator.onLine === false) throw new Error(HEP_NEEDS_CONNECTION);
  return supabase;
}

/** The database's own message (for example the free-plan limit text) is passed on as it is. */
function fail(error: { message: string }): never {
  throw new Error(error.message);
}

// ---- Inputs -----------------------------------------------------------------

export interface SaveExerciseInput {
  /** Absent for a new exercise. */
  id?: string;
  clinicId: string;
  title: string;
  otherNames?: string[];
  bodyRegion: string;
  alsoRegions?: string[];
  equipment?: string[];
  phase: ExercisePhase;
  instructions: string;
  mediaType: ExerciseMediaType;
  mediaKeys?: string[];
  mediaCaptions?: string[];
  thumbKey?: string | null;
  defaultSets: number;
  doseType: DoseType;
  defaultReps: number | null;
  defaultHoldSeconds: number | null;
  defaultDurationSeconds: number | null;
  defaultRestSeconds: number;
  defaultSessionsPerDay: SessionsPerDay;
  side: ExerciseSide;
  stopIf: string;
  /** false = archive (hidden from the picker, kept for history). */
  active?: boolean;
  /** true = delete (only for an exercise no template or program uses). */
  deleted?: boolean;
  /** Starting positions (HEP_POSITIONS); staff-only. Absent = none. */
  positions?: string[];
}

/** One exercise inside a template or program, as the RPCs read it (camelCase keys). */
export interface HepItemInput {
  /** Present when editing an exercise that is already on the program. */
  id?: string;
  sourceExerciseId?: string | null;
  title: string;
  bodyRegion: string;
  phase: ExercisePhase;
  instructions: string;
  mediaType: ExerciseMediaType;
  mediaKeys: string[];
  mediaCaptions: string[];
  equipment: string[];
  doseType: DoseType;
  sets: number;
  reps: number | null;
  holdSeconds: number | null;
  durationSeconds: number | null;
  restSeconds: number;
  sessionsPerDay: SessionsPerDay;
  side: ExerciseSide;
  optional: boolean;
  stopIf: string;
  /** Programs only. */
  specialInstructions?: string;
}

/** Program settings; a key left out keeps the database default (or, on an edit, the current value). */
export interface ProgramSettings {
  /** null = ongoing; absent on create = 7. */
  durationDays?: number | null;
  targetPct?: number;
  /** Create: days until the check-in (null = none; absent = 7). */
  checkinDays?: number | null;
  /** Edit: the check-in date (null = none). */
  checkinOn?: string | null;
  feedbackDefault?: 'pain' | 'effort';
  sessionsPerDay?: SessionsPerDay;
}

export interface CreateProgramInput {
  clinicId: string;
  /** An existing patient: prescribing never creates one. */
  patientId: string;
  therapistId: string | null;
  title: string;
  items: HepItemInput[];
  /** The therapist's own 4 digits; leave out for a random one. */
  customPin?: string | null;
  sourceTemplateId?: string | null;
  /** The clinic's today (YYYY-MM-DD). */
  today?: string;
  settings?: ProgramSettings;
}

export interface UpdateProgramInput {
  programId: string;
  title: string;
  status: ProgramStatus;
  /** The WHOLE item list: an existing exercise left out is removed from the program. */
  items: HepItemInput[];
  customPin?: string | null;
  today?: string;
  settings?: ProgramSettings;
}

export interface ProgramCreated {
  programId: string;
  patientId: string;
  token: string;
  /** Shown to the therapist ONCE (null when the patient already had a PIN). Never put it in a message. */
  pin: string | null;
}

/** Keys the RPCs read from an item. `undefined` values are dropped by JSON, so a missing optional key stays missing. */
export function itemToJson(item: HepItemInput): Record<string, unknown> {
  return {
    id: item.id,
    sourceExerciseId: item.sourceExerciseId ?? undefined,
    title: item.title,
    bodyRegion: item.bodyRegion,
    phase: item.phase,
    instructions: item.instructions,
    mediaType: item.mediaType,
    mediaKeys: item.mediaKeys,
    mediaCaptions: item.mediaCaptions,
    equipment: item.equipment,
    doseType: item.doseType,
    sets: item.sets,
    reps: item.reps,
    holdSeconds: item.holdSeconds,
    durationSeconds: item.durationSeconds,
    restSeconds: item.restSeconds,
    sessionsPerDay: item.sessionsPerDay,
    side: item.side,
    optional: item.optional,
    stopIf: item.stopIf,
    specialInstructions: item.specialInstructions,
  };
}

// ---- Reads that come back from the server -------------------------------------

export interface SessionFeedback {
  id: string;
  programId: string;
  logDate: string;
  sessionIndex: SessionsPerDay;
  painScore: number | null;
  effortScore: number | null;
  painItemIds: string[];
  hardItemIds: string[];
  createdAt: string;
}

/** What the chart and the Programs list need to know about one program. */
export interface ProgramBundle {
  program: Program;
  patientName: string;
  therapistName: string | null;
  logs: ProgramLog[];
  sessionFeedback: SessionFeedback[];
  /** null = no link yet. */
  access: { token: string; linkRevoked: boolean; openCount: number; lastOpenedAt: string | null } | null;
}

type Row = Record<string, unknown>;
const rows = <T>(list: unknown): T[] => (Array.isArray(list) ? (list as Row[]).map((r) => rowToDomain<T>(r)) : []);

/** Turns one `programs` row, with its embedded items, logs, feedback, patient and therapist, into a bundle. */
export function mapProgramRow(row: Row, access?: Row | null): ProgramBundle {
  const { program_items, program_session_feedback, patients, therapists, ...programRow } = row;
  const items = Array.isArray(program_items) ? (program_items as Row[]) : [];
  const logs: ProgramLog[] = items.flatMap((it) => rows<ProgramLog>(it.program_logs));
  const program = rowToDomain<Program>(programRow);
  program.items = items
    .map(({ program_logs: _logs, ...itemRow }) => rowToDomain<ProgramItem>(itemRow))
    .sort((a, b) => a.sortOrder - b.sortOrder);
  const patient = patients as Row | null | undefined;
  const therapist = therapists as Row | null | undefined;
  return {
    program,
    patientName: String(patient?.name ?? ''),
    therapistName: therapist?.name ? String(therapist.name) : null,
    logs,
    sessionFeedback: rows<Row>(program_session_feedback).map((f) => ({
      id: String(f.id), programId: String(f.programId), logDate: String(f.logDate), sessionIndex: f.sessionIndex as SessionsPerDay,
      painScore: (f.painScore as number | null) ?? null, effortScore: (f.effortScore as number | null) ?? null,
      painItemIds: (f.painItemIds as string[]) ?? [], hardItemIds: (f.hardItemIds as string[]) ?? [], createdAt: String(f.createdAt),
    })),
    access: access
      ? { token: String(access.token), linkRevoked: access.link_revoked_at != null, openCount: Number(access.open_count ?? 0), lastOpenedAt: (access.last_opened_at as string | null) ?? null }
      : null,
  };
}

const PROGRAM_SELECT = '*, patients(name), therapists(name), program_items(*, program_logs(*)), program_session_feedback(*)';
// Never `*`: pin_hash is not readable by staff (see the migration), so the columns are listed.
const ACCESS_COLUMNS = 'patient_id, token, link_revoked_at, open_count, last_opened_at';

export const hepService = {
  // ---- Library (read from the local cache) ----------------------------------

  /** The clinic's exercises from the offline cache, A to Z. Archived ones only when asked. Works offline. */
  async listCachedExercises(clinicId: string, opts: { includeArchived?: boolean } = {}): Promise<Exercise[]> {
    const all = await db.exercises.where('clinicId').equals(clinicId).toArray();
    return all
      .filter((e) => !e.deleted && (opts.includeArchived || e.active))
      .sort((a, b) => a.title.localeCompare(b.title));
  },

  // ---- Exercises -------------------------------------------------------------

  /** Creates or updates an exercise; returns its id. The Lite cap (10) is enforced by the server. */
  async saveExercise(input: SaveExerciseInput): Promise<string> {
    const supabase = requireOnline();
    const { data, error } = await supabase.rpc('save_exercise', {
      p_clinic_id: input.clinicId,
      p_id: input.id ?? null,
      p_title: input.title,
      p_body_region: input.bodyRegion,
      p_phase: input.phase,
      p_also_regions: input.alsoRegions ?? [],
      p_equipment: input.equipment ?? [],
      p_instructions: input.instructions,
      p_media_type: input.mediaType,
      p_media_keys: input.mediaKeys ?? [],
      p_default_sets: input.defaultSets,
      p_default_reps: input.defaultReps,
      p_default_hold_seconds: input.defaultHoldSeconds,
      p_default_sessions_per_day: input.defaultSessionsPerDay,
      p_side: input.side,
      p_stop_if: input.stopIf,
      p_deleted: input.deleted ?? false,
      p_dose_type: input.doseType,
      p_default_duration_seconds: input.defaultDurationSeconds,
      p_default_rest_seconds: input.defaultRestSeconds,
      p_media_captions: input.mediaCaptions ?? [],
      p_active: input.active ?? true,
      p_other_names: input.otherNames ?? [],
      p_thumb_key: input.thumbKey ?? null,
      p_positions: input.positions ?? [],
    });
    if (error) fail(error);
    syncEngine.schedule(0); // bring the saved row into the offline cache
    return data as string;
  },

  async toggleExerciseFavorite(exerciseId: string): Promise<boolean> {
    const supabase = requireOnline();
    const { data, error } = await supabase.rpc('toggle_exercise_favorite', { p_exercise_id: exerciseId });
    if (error) fail(error);
    syncEngine.schedule(0);
    return data === true;
  },

  /** Exercises prescribed since a date (a program item's source), for "Used this week" in the Library and the picker. */
  async recentlyUsedExerciseIds(clinicId: string, since: string): Promise<string[]> {
    const supabase = requireOnline();
    const { data, error } = await supabase
      .from('program_items')
      .select('source_exercise_id, programs!inner(clinic_id)')
      .eq('programs.clinic_id', clinicId)
      .gte('added_on', since)
      .not('source_exercise_id', 'is', null);
    if (error) fail(error);
    return [...new Set(((data ?? []) as Row[]).map((r) => String(r.source_exercise_id)))];
  },

  /** How many times each exercise has been prescribed (a grouped count in the database, not every row). Any error: {}. */
  async exerciseUseCounts(clinicId: string): Promise<Record<string, number>> {
    try {
      const supabase = requireOnline();
      const { data, error } = await supabase.rpc('exercise_use_counts', { p_clinic_id: clinicId });
      if (error) return {};
      return Object.fromEntries(((data ?? []) as Array<{ exercise_id: string; uses: number }>).map((r) => [r.exercise_id, Number(r.uses)]));
    } catch {
      return {};
    }
  },

  /** How many programs and templates carry a copy of this exercise: an exercise that is used is archived, not deleted. */
  async exerciseUsage(exerciseId: string): Promise<{ programs: number; templates: number }> {
    const supabase = requireOnline();
    const [p, t] = await Promise.all([
      supabase.from('program_items').select('id', { count: 'exact', head: true }).eq('source_exercise_id', exerciseId),
      supabase.from('exercise_template_items').select('id', { count: 'exact', head: true }).eq('source_exercise_id', exerciseId),
    ]);
    if (p.error) fail(p.error);
    if (t.error) fail(t.error);
    return { programs: p.count ?? 0, templates: t.count ?? 0 };
  },

  // ---- Templates ---------------------------------------------------------------

  async listTemplates(clinicId: string): Promise<Array<ExerciseTemplate & { usedCount: number }>> {
    const supabase = requireOnline();
    const [templates, uses] = await Promise.all([
      supabase.from('exercise_templates').select('*, exercise_template_items(*)').eq('clinic_id', clinicId).eq('deleted', false).order('updated_at', { ascending: false }),
      supabase.from('programs').select('source_template_id').eq('clinic_id', clinicId).not('source_template_id', 'is', null),
    ]);
    if (templates.error) fail(templates.error);
    if (uses.error) fail(uses.error);
    const used = new Map<string, number>();
    for (const u of (uses.data ?? []) as Array<{ source_template_id: string }>) used.set(u.source_template_id, (used.get(u.source_template_id) ?? 0) + 1);
    return ((templates.data ?? []) as Row[]).map((r) => {
      const t = rowToDomain<ExerciseTemplate>({ ...r, exercise_template_items: undefined });
      t.items = rows<ExerciseTemplateItem>(r.exercise_template_items).sort((a, b) => a.sortOrder - b.sortOrder);
      return { ...t, usedCount: used.get(t.id) ?? 0 };
    });
  },

  async saveTemplate(input: { clinicId: string; templateId?: string; title: string; note?: string | null; items: HepItemInput[]; deleted?: boolean }): Promise<string> {
    const supabase = requireOnline();
    const { data, error } = await supabase.rpc('save_template', {
      p_clinic_id: input.clinicId,
      p_template_id: input.templateId ?? null,
      p_title: input.title,
      p_items: input.items.map(itemToJson),
      p_deleted: input.deleted ?? false,
      p_note: input.note ?? null,
    });
    if (error) fail(error);
    return data as string;
  },

  async duplicateTemplate(templateId: string, newTitle?: string): Promise<string> {
    const supabase = requireOnline();
    const { data, error } = await supabase.rpc('duplicate_template', { p_template_id: templateId, p_new_title: newTitle ?? null });
    if (error) fail(error);
    return data as string;
  },

  async saveProgramAsTemplate(programId: string, title: string): Promise<string> {
    const supabase = requireOnline();
    const { data, error } = await supabase.rpc('save_program_as_template', { p_program_id: programId, p_title: title });
    if (error) fail(error);
    return data as string;
  },

  // ---- Programs ----------------------------------------------------------------

  async createProgram(input: CreateProgramInput): Promise<ProgramCreated> {
    const supabase = requireOnline();
    const { data, error } = await supabase.rpc('create_program', {
      p_clinic_id: input.clinicId,
      p_patient_id: input.patientId,
      p_therapist_id: input.therapistId,
      p_title: input.title,
      p_items: input.items.map(itemToJson),
      p_custom_pin: input.customPin ?? null,
      p_source_template_id: input.sourceTemplateId ?? null,
      ...(input.today ? { p_today: input.today } : {}),
      p_settings: input.settings ?? {},
    });
    if (error) fail(error);
    return data as ProgramCreated;
  },

  async updateProgram(input: UpdateProgramInput): Promise<void> {
    const supabase = requireOnline();
    const { error } = await supabase.rpc('update_program', {
      p_program_id: input.programId,
      p_title: input.title,
      p_status: input.status,
      p_items: input.items.map(itemToJson),
      p_custom_pin: input.customPin ?? null,
      ...(input.today ? { p_today: input.today } : {}),
      p_settings: input.settings ?? null,
    });
    if (error) fail(error);
  },

  async copyTemplateToProgram(input: { templateId: string; patientId: string; therapistId: string | null; customPin?: string | null; today?: string }): Promise<ProgramCreated> {
    const supabase = requireOnline();
    const { data, error } = await supabase.rpc('copy_template_to_program', {
      p_template_id: input.templateId,
      p_patient_id: input.patientId,
      p_therapist_id: input.therapistId,
      p_custom_pin: input.customPin ?? null,
      ...(input.today ? { p_today: input.today } : {}),
    });
    if (error) fail(error);
    return data as ProgramCreated;
  },

  async duplicateProgram(programId: string, newTitle?: string): Promise<ProgramCreated> {
    const supabase = requireOnline();
    const { data, error } = await supabase.rpc('duplicate_program', { p_program_id: programId, p_new_title: newTitle ?? null });
    if (error) fail(error);
    return data as ProgramCreated;
  },

  /** Pause, resume or complete without touching the exercises. */
  async setProgramStatus(programId: string, status: ProgramStatus): Promise<void> {
    const supabase = requireOnline();
    const { error } = await supabase.rpc('set_program_status', { p_program_id: programId, p_status: status });
    if (error) fail(error);
  },

  /** Extend an ended program by 1 to 90 days. */
  async extendProgram(programId: string, extraDays: number): Promise<void> {
    const supabase = requireOnline();
    const { error } = await supabase.rpc('extend_program', { p_program_id: programId, p_extra_days: extraDays });
    if (error) fail(error);
  },

  /** Opening the Home program tab marks pain as reviewed for everyone (shared state on the program). */
  async markPainReviewed(programId: string): Promise<void> {
    const supabase = requireOnline();
    const { error } = await supabase.rpc('mark_pain_reviewed', { p_program_id: programId });
    if (error) fail(error);
  },

  // ---- The patient's link and PIN -------------------------------------------------

  /** A new random PIN, returned ONCE. Remembered phones are signed out. */
  async resetPin(patientId: string): Promise<string> {
    const supabase = requireOnline();
    const { data, error } = await supabase.rpc('reset_hep_pin', { p_patient_id: patientId });
    if (error) fail(error);
    return data as string;
  },

  /** Stop sharing: the patient's page stops working. */
  async revokeLink(patientId: string): Promise<void> {
    const supabase = requireOnline();
    const { error } = await supabase.rpc('revoke_hep_link', { p_patient_id: patientId });
    if (error) fail(error);
  },

  /** A new link (the old one stops working); also turns sharing back on. */
  async rotateToken(patientId: string): Promise<string> {
    const supabase = requireOnline();
    const { data, error } = await supabase.rpc('rotate_hep_token', { p_patient_id: patientId });
    if (error) fail(error);
    return data as string;
  },

  /** Has the patient opened the page yet? Polled by the hand-over panel. */
  async linkStatus(patientId: string): Promise<{ firstOpenedAt: string | null; lastOpenedAt: string | null; openCount: number; linkRevoked: boolean }> {
    const supabase = requireOnline();
    const { data, error } = await supabase.rpc('hep_link_status', { p_patient_id: patientId });
    if (error) fail(error);
    const d = (data ?? {}) as Row;
    return { firstOpenedAt: (d.firstOpenedAt as string | null) ?? null, lastOpenedAt: (d.lastOpenedAt as string | null) ?? null, openCount: Number(d.openCount ?? 0), linkRevoked: d.linkRevoked === true };
  },

  // ---- Programs for the Programs tab and the patient chart ----------------------------

  /** Every program of the clinic with its items, the last days of logs and session checks, and the link state. */
  async listClinicPrograms(clinicId: string, since: string): Promise<ProgramBundle[]> {
    return fetchBundles((q) => q.eq('clinic_id', clinicId), since);
  },

  /** How many active programs the clinic has: the same rule the server's free-plan cap counts by. For the plan meter. */
  async countActivePrograms(clinicId: string): Promise<number> {
    const supabase = requireOnline();
    const { count, error } = await supabase.from('programs').select('id', { count: 'exact', head: true }).eq('clinic_id', clinicId).eq('status', 'active');
    if (error) fail(error);
    return count ?? 0;
  },

  /** One patient's programs (active, paused, completed), newest first. */
  async listPatientPrograms(patientId: string, since: string): Promise<ProgramBundle[]> {
    return fetchBundles((q) => q.eq('patient_id', patientId), since);
  },
};

// The filter receives the PostgREST query builder (its type depends on the select string, so it is left loose here).
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function fetchBundles(filter: (q: any) => any, since: string): Promise<ProgramBundle[]> {
  const supabase = requireOnline();
  const query = filter(supabase.from('programs').select(PROGRAM_SELECT))
    .gte('program_items.program_logs.log_date', since)
    .gte('program_session_feedback.log_date', since)
    .order('created_at', { ascending: false });
  const { data, error } = await query;
  if (error) fail(error);
  const list = (data ?? []) as Row[];
  const patientIds = [...new Set(list.map((r) => String(r.patient_id)))];
  const access = new Map<string, Row>();
  for (let i = 0; i < patientIds.length; i += 100) {
    const { data: a, error: e } = await supabase.from('patient_hep_access').select(ACCESS_COLUMNS).in('patient_id', patientIds.slice(i, i + 100));
    if (e) fail(e);
    for (const r of (a ?? []) as Row[]) access.set(String(r.patient_id), r);
  }
  return list.map((r) => mapProgramRow(r, access.get(String(r.patient_id)) ?? null));
}
