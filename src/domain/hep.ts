// HEP (home exercise programs): types and the pure rules the screens, the patient page and the tests share.
// Plan: docs/superpowers/plans/2026-11-09-hep-module.md (Task 3 and amendments 14 to 22, 41 to 43, 53, 61 to 69, 78 to 81).

/**
 * HEP is temporarily restricted to Beyond Mechanics and Physio Clinic while
 * mobile layout and starter-library refinements are finished.
 */
export function hepAvailableForClinic(clinic: { name?: string | null } | null | undefined): boolean {
  const name = (clinic?.name ?? '').trim().toLowerCase();
  return name === 'beyond mechanics' || name === 'physio clinic';
}

/** Clinics allowed to publish and maintain shared Starter Library exercises. */
export function isStarterCuratorClinic(
  clinic: { starterCurator?: boolean | null } | null | undefined,
): boolean {
  return clinic?.starterCurator === true;
}

export type ExerciseMediaType = 'none' | 'gif' | 'stills';
/** How an exercise is done: dynamic reps, reps each held for a few seconds, or continuous for a set time. */
export type DoseType = 'reps' | 'hold' | 'timed';
export type ExerciseSide = 'none' | 'left' | 'right' | 'both';
export type ProgramStatus = 'active' | 'paused' | 'completed';
export type SessionsPerDay = 1 | 2 | 3;

/** The part of a session an exercise belongs to, in session order (moving before holding). Programs list items in this order. */
export const EXERCISE_PHASES = ['warm_up', 'mobility', 'stretching', 'activation', 'strengthening', 'balance', 'functional', 'cool_down', 'other'] as const;
export type ExercisePhase = (typeof EXERCISE_PHASES)[number];
export const EXERCISE_PHASE_LABELS: Record<ExercisePhase, string> = {
  warm_up: 'Warm-up',
  mobility: 'Mobility',
  stretching: 'Stretching',
  activation: 'Activation',
  strengthening: 'Strengthening',
  balance: 'Balance',
  functional: 'Functional',
  cool_down: 'Cool-down',
  other: 'Other',
};

/** The six main exercise types. Warm-up, cool-down and other are not types a therapist picks for a new exercise. */
export const EXERCISE_TYPES = ['mobility', 'stretching', 'activation', 'strengthening', 'balance', 'functional'] as const;
export type ExerciseType = (typeof EXERCISE_TYPES)[number];
export const isMainType = (p: ExercisePhase): p is ExerciseType => (EXERCISE_TYPES as readonly string[]).includes(p);

/** The order a session is shown and saved in: warm-up, the six types, other, cool-down. */
export const SESSION_ORDER: readonly ExercisePhase[] = ['warm_up', 'mobility', 'stretching', 'activation', 'strengthening', 'balance', 'functional', 'other', 'cool_down'];

export const EXERCISE_TYPE_DEFINITIONS: Record<ExerciseType, string> = {
  mobility: 'Active or assisted range of motion. Default dosage: repetitions.',
  stretching: 'Sustained end-range hold. Default dosage: holds, 3 × 30 s.',
  activation: 'Isometric or low-load motor control. Default dosage: repetitions with hold.',
  strengthening: 'Resisted or loaded exercise. Default dosage: repetitions.',
  balance: 'Static or dynamic postural control. Default dosage: timed.',
  functional: 'Task-specific training, for example sit to stand or stairs. Default dosage: repetitions.',
};

export type TypeTone = 'sky' | 'plum' | 'amber' | 'rust' | 'moss' | 'teal' | 'slate';
export const EXERCISE_TYPE_TONE: Record<ExercisePhase, TypeTone> = {
  mobility: 'sky',
  stretching: 'plum',
  activation: 'amber',
  strengthening: 'rust',
  balance: 'moss',
  functional: 'teal',
  warm_up: 'slate',
  cool_down: 'slate',
  other: 'slate',
};

export const HEP_POSITIONS = ['Standing', 'Sitting', 'Supine', 'Prone', 'Side-lying', 'Quadruped', 'Kneeling'] as const;
export type HepPosition = (typeof HEP_POSITIONS)[number];

/** Old cached rows have no positions. */
export const positionsOf = (ex: Partial<Pick<Exercise, 'positions'>>): string[] => ex.positions ?? [];

/** Secondary types (old cached rows have none), excluding duplicates and the primary phase. */
export const alsoPhasesOf = (ex: Partial<Pick<Exercise, 'phase' | 'alsoPhases'>>): ExercisePhase[] =>
  [...new Set((ex.alsoPhases ?? []).filter((p): p is ExercisePhase => (EXERCISE_PHASES as readonly string[]).includes(p) && p !== ex.phase))];

/** Primary type first, followed by any additional types. */
export const phasesOf = (ex: Pick<Exercise, 'phase'> & Partial<Pick<Exercise, 'alsoPhases'>>): ExercisePhase[] =>
  [ex.phase, ...alsoPhasesOf(ex)];

/** Key of the sharpest preview image for list cards/rows (never when "Hide pictures in lists" is on).
 *  Still exercises prefer the End position picture (explicit "End" caption, else the last photo) so therapists
 *  immediately recognise the movement without opening the exercise; single-photo stills use their only photo and
 *  GIFs keep their static thumbnail. */
export function listThumbKey(
  ex: Partial<Pick<Exercise, 'hidePicturesInLists' | 'mediaType' | 'mediaKeys' | 'mediaCaptions' | 'thumbKey'>>,
): string | null {
  if (ex.hidePicturesInLists) return null;
  if (ex.mediaType !== 'gif' && ex.mediaKeys && ex.mediaKeys.length > 0) {
    const endIdx = (ex.mediaCaptions ?? []).findIndex((c) => /\bend\b/i.test(c));
    if (endIdx >= 0 && ex.mediaKeys[endIdx]) return ex.mediaKeys[endIdx];
    const fallback = ex.mediaKeys.length > 1 ? ex.mediaKeys[ex.mediaKeys.length - 1] : ex.mediaKeys[0];
    if (fallback) return fallback;
  }
  return ex.thumbKey ?? null;
}

/** The suggested kind for a type; the therapist can always change it (amendment 62). */
export function suggestedDoseType(phase: ExercisePhase): DoseType {
  if (phase === 'stretching' || phase === 'activation' || phase === 'cool_down') return 'hold';
  if (phase === 'balance') return 'timed';
  return 'reps';
}

export interface Exercise {
  id: string;
  clinicId: string;
  title: string;
  /** Names staff also use for it ("SLR", "clams"); search only, never shown to patients. */
  otherNames: string[];
  bodyRegion: string;
  /** Extra regions it should also appear under when filtering. */
  alsoRegions: string[];
  /** What the patient needs, for example "Theraband / resistance band". */
  equipment: string[];
  phase: ExercisePhase;
  /** Extra types this exercise also belongs to for Library/Picker filtering; primary `phase` drives grouping & default dosage. */
  alsoPhases?: ExercisePhase[];
  /** Starting positions; a filter for staff, never shown to patients. */
  positions: string[];
  instructions: string;
  mediaType: ExerciseMediaType;
  mediaKeys: string[];
  mediaCaptions: string[];
  thumbKey: string | null;
  /** When staff confirmed consent from the person shown in the pictures; null = not recorded. Absent on rows cached
   *  before 20261115100000 (like positions), so optional. */
  pictureConsentAt?: string | null;
  /** Who confirmed that consent (auth user id). */
  pictureConsentBy?: string | null;
  /** Lists (Library, picker, program rows, the patient's checklist) show the name only; the exercise page still shows
   *  pictures. Absent = false. */
  hidePicturesInLists?: boolean;
  defaultSets: number;
  doseType: DoseType;
  defaultReps: number | null;
  defaultHoldSeconds: number | null;
  defaultDurationSeconds: number | null;
  defaultRestSeconds: number;
  defaultSessionsPerDay: SessionsPerDay;
  side: ExerciseSide;
  stopIf: string;
  isFavorite: boolean;
  /** False = archived: hidden from the picker, kept for history. */
  active: boolean;
  deleted: boolean;
  version: number;
  createdAt: string;
  updatedAt: string;
}

/** An item in the shared `starter_exercises` catalog (or a static fallback entry from STARTER_EXERCISES). */
export interface StarterLibraryItem {
  id: string;
  sourceClinicId: string | null;
  sourceExerciseId: string | null;
  title: string;
  otherNames: string[];
  bodyRegion: string;
  alsoRegions: string[];
  phase: ExercisePhase;
  alsoPhases: ExercisePhase[];
  positions: string[];
  equipment: string[];
  instructions: string;
  stopIf: string;
  mediaType: ExerciseMediaType;
  mediaKeys: string[];
  mediaCaptions: string[];
  thumbKey: string | null;
  doseType: DoseType;
  defaultSets: number;
  defaultReps: number | null;
  defaultHoldSeconds: number | null;
  defaultDurationSeconds: number | null;
  defaultRestSeconds: number;
  defaultSessionsPerDay: SessionsPerDay;
  side: ExerciseSide;
  publishedAt: string | null;
}

/** The dose and flags every saved copy of an exercise carries (template items and program items). */
export interface DoseFields {
  doseType: DoseType;
  sets: number;
  reps: number | null;
  holdSeconds: number | null;
  durationSeconds: number | null;
  restSeconds: number;
  side: ExerciseSide;
  sessionsPerDay: SessionsPerDay;
  /** Optional exercises do not count in today's total, the habit % or "Continue" (amendment 81). */
  optional: boolean;
}

export interface ExerciseTemplateItem extends DoseFields {
  id?: string;
  templateId?: string;
  sourceExerciseId?: string | null;
  title: string;
  bodyRegion: string;
  phase: ExercisePhase;
  equipment: string[];
  instructions: string;
  mediaType: ExerciseMediaType;
  mediaKeys: string[];
  mediaCaptions: string[];
  stopIf: string;
  sortOrder: number;
}

export interface ExerciseTemplate {
  id: string;
  clinicId: string;
  title: string;
  note: string | null;
  items: ExerciseTemplateItem[];
  deleted: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface SessionsScheduleEntry {
  from: string; // YYYY-MM-DD
  sessionsPerDay: SessionsPerDay;
}

export interface ProgramItem extends DoseFields {
  id: string;
  programId: string;
  sourceExerciseId?: string | null;
  title: string;
  bodyRegion: string;
  phase: ExercisePhase;
  equipment: string[];
  instructions: string;
  mediaType: ExerciseMediaType;
  mediaKeys: string[];
  mediaCaptions: string[];
  mediaUrls?: string[];
  sessionsSchedule: SessionsScheduleEntry[];
  stopIf: string;
  specialInstructions: string;
  sortOrder: number;
  addedOn: string; // YYYY-MM-DD
  removedOn: string | null;
}

export interface Program {
  id: string;
  clinicId: string;
  patientId: string;
  therapistId: string | null;
  sourceTemplateId?: string | null;
  title: string;
  status: ProgramStatus;
  startDate: string;
  /** Length in days; null = ongoing. */
  durationDays: number | null;
  /** The habit % that counts as completed. */
  targetPct: number;
  checkinOn: string | null;
  /** Which question opens first after a session. */
  feedbackDefault: 'pain' | 'effort';
  sessionsPerDay: SessionsPerDay;
  firstOpenedAt: string | null;
  /** Pain scores of 7 or more reported before this moment count as seen (set when any staff member opens the program). */
  painReviewedThrough?: string | null;
  items: ProgramItem[];
  createdAt: string;
  updatedAt: string;
}

export type SkipReason = 'pain' | 'no_time' | 'too_hard' | 'forgot' | 'didnt_understand' | 'other';

export interface ProgramLog {
  id: string;
  programItemId: string;
  logDate: string; // YYYY-MM-DD
  sessionIndex: SessionsPerDay;
  skipped: boolean;
  skipReason?: SkipReason | null;
  completedAt: string;
}

export function isFourDigitPin(value: string): boolean {
  return /^\d{4}$/.test(value);
}

/** A session pain score of 7 or more is reported to the prescriber. */
export function isHighPainAlert(painScore: number | null | undefined): boolean {
  return typeof painScore === 'number' && painScore >= 7;
}

// ---- Regions and equipment -------------------------------------------------

export const HEP_PELVIC_FLOOR_WOMEN = 'Pelvic floor: Women';
export const HEP_PELVIC_FLOOR_MEN = 'Pelvic floor: Men';
export const HEP_REGIONS = [
  'Neck',
  'Shoulder',
  'Elbow / Wrist / Hand',
  'Spine / Back',
  'Hip',
  'Knee',
  'Ankle / Foot',
  'Core',
  'Face',
  HEP_PELVIC_FLOOR_WOMEN,
  HEP_PELVIC_FLOOR_MEN,
  'Whole body',
] as const;
/** Head to toe, with Pelvic floor as one group (Women and Men inside it). Clinic-added regions follow, A to Z. */
export const HEP_BODY_ORDER = ['Face', 'Neck', 'Shoulder', 'Elbow / Wrist / Hand', 'Spine / Back', 'Core', 'Hip', 'Knee', 'Ankle / Foot', 'Pelvic floor', 'Whole body'] as const;
export const HEP_EQUIPMENT = [
  'None',
  'Theraband / resistance band',
  'Dumbbell',
  'Ankle weight',
  'Swiss ball',
  'Foam roller',
  'Towel',
  'Chair',
  'Wall',
  'Step',
  'Stick / wand',
  'Pulley',
  'Balance board',
  'Mat',
] as const;

const squash = (s: string) => s.trim().replace(/\s+/g, ' ');
const lowerKey = (s: string) => squash(s).toLowerCase();

function canonicalFrom(list: readonly string[], raw: string): string {
  const key = lowerKey(raw);
  const singular = key.replace(/s$/, '');
  const hit = list.find((v) => lowerKey(v) === key || lowerKey(v) === singular);
  if (hit) return hit;
  const clean = squash(raw);
  return clean ? clean.charAt(0).toUpperCase() + clean.slice(1) : '';
}

/** "shoulders" and "Shoulder" are one region; an unknown name is kept, tidied. */
export const canonicalRegion = (raw: string) => canonicalFrom(HEP_REGIONS, raw);
export const canonicalEquipment = (raw: string) => canonicalFrom(HEP_EQUIPMENT, raw);

export const isPelvicFloorRegion = (region: string) => canonicalRegion(region).startsWith('Pelvic floor');

export interface RegionTypeCount {
  phase: ExercisePhase;
  count: number;
}
export interface RegionNode {
  region: string;
  /** Exercises under this region (as the main region or in "also under"). */
  count: number;
  /** Types that have exercises, in session order. */
  types: RegionTypeCount[];
  /** Pelvic floor only: Women and Men. */
  children?: RegionNode[];
}

/**
 * The Library's side list: regions head to toe (clinic-added ones after, A to Z) with how many exercises each holds
 * and which types appear under it. An exercise counts under its main region and each "also under" region.
 * Archived and deleted exercises are left out unless `includeArchived`.
 */
export function regionTree(
  exercises: Pick<Exercise, 'bodyRegion' | 'alsoRegions' | 'phase' | 'active' | 'deleted'>[],
  opts: { includeArchived?: boolean } = {},
): RegionNode[] {
  const live = exercises.filter((e) => !e.deleted && (opts.includeArchived || e.active));
  const regionsOf = (e: (typeof live)[number]) => new Set([canonicalRegion(e.bodyRegion), ...e.alsoRegions.map(canonicalRegion)].filter(Boolean));
  const node = (region: string, match: (regions: Set<string>) => boolean): RegionNode => {
    const items = live.filter((e) => match(regionsOf(e)));
    const types = EXERCISE_PHASES.map((phase) => ({ phase, count: items.filter((e) => e.phase === phase).length })).filter((t) => t.count > 0);
    return { region, count: items.length, types };
  };
  const known = new Set<string>(HEP_BODY_ORDER);
  const extras = [...new Set(live.flatMap((e) => [...regionsOf(e)]))]
    .filter((r) => !known.has(r) && r !== HEP_PELVIC_FLOOR_WOMEN && r !== HEP_PELVIC_FLOOR_MEN)
    .sort((a, b) => a.localeCompare(b));
  const order = [...HEP_BODY_ORDER.slice(0, -1), ...HEP_BODY_ORDER.slice(-1)]; // 'Whole body' is last of the fixed list
  const nodes = order.map((region) => {
    if (region === 'Pelvic floor') {
      const parent = node(region, (rs) => rs.has(HEP_PELVIC_FLOOR_WOMEN) || rs.has(HEP_PELVIC_FLOOR_MEN));
      parent.children = [
        node('Pelvic floor: Women', (rs) => rs.has(HEP_PELVIC_FLOOR_WOMEN)),
        node('Pelvic floor: Men', (rs) => rs.has(HEP_PELVIC_FLOOR_MEN)),
      ];
      return parent;
    }
    return node(region, (rs) => rs.has(region));
  });
  return [...nodes, ...extras.map((r) => node(r, (rs) => rs.has(r)))];
}

// ---- Search ---------------------------------------------------------------

function words(text: string): string[] {
  return text.toLowerCase().replace(/[-_/,.:;()]+/g, ' ').split(/\s+/).filter(Boolean);
}
const stem = (w: string) => (w.length > 3 ? w.replace(/(es|s)$/, '') : w);

/** True when two words differ by at most one insert, delete, substitution or swap of neighbours. */
function withinOneEdit(a: string, b: string): boolean {
  if (a === b) return true;
  if (Math.abs(a.length - b.length) > 1) return false;
  let i = 0;
  while (i < a.length && i < b.length && a[i] === b[i]) i++;
  if (i === a.length || i === b.length) return true; // one extra letter at the end
  if (a.length === b.length) {
    if (a.slice(i + 1) === b.slice(i + 1)) return true; // substitution
    if (a[i] === b[i + 1] && a[i + 1] === b[i] && a.slice(i + 2) === b.slice(i + 2)) return true; // swap
    return false;
  }
  const [short, long] = a.length < b.length ? [a, b] : [b, a];
  return short.slice(i) === long.slice(i + 1); // one letter inserted or deleted
}

function wordMatches(query: string, candidate: string): boolean {
  const q = stem(query);
  const c = stem(candidate);
  if (q === c || c.startsWith(q) || candidate.startsWith(query)) return true;
  return query.length >= 5 && withinOneEdit(q, c);
}

/**
 * Library, picker and Templates search (amendment 78): title, other names, regions, type and equipment. Every word of
 * the query must match some word of the exercise: ignoring case, hyphens and a trailing "s", as a start of a word
 * ("clam" finds Clamshells), and with one typo in words of 5 letters or more ("hamstrig").
 */
export function matchesExerciseSearch(
  ex: Pick<Exercise, 'title' | 'otherNames' | 'bodyRegion' | 'alsoRegions' | 'phase' | 'equipment'> & Partial<Pick<Exercise, 'positions'>>,
  query: string,
): boolean {
  const q = words(query);
  if (q.length === 0) return true;
  const base = words([ex.title, ...ex.otherNames, ex.bodyRegion, ...ex.alsoRegions, EXERCISE_PHASE_LABELS[ex.phase], ...ex.equipment, ...positionsOf(ex)].join(' '));
  // Neighbouring words also count joined, so "pushup" finds "Push-up".
  const hay = [...base, ...base.slice(1).map((w, i) => base[i] + w)];
  return q.every((w) => hay.some((h) => wordMatches(w, h)));
}

// ---- Sessions per day and adherence ----------------------------------------

export function addDaysISO(dateStr: string, days: number): string {
  const [y, m, d] = dateStr.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

/** The number of sessions an exercise had on a date, from its schedule (the entry in force that day). */
export function sessionsPerDayOnDate(item: Pick<ProgramItem, 'sessionsPerDay' | 'sessionsSchedule'>, date: string): SessionsPerDay {
  if (!item.sessionsSchedule || item.sessionsSchedule.length === 0) return item.sessionsPerDay;
  const sorted = [...item.sessionsSchedule].sort((a, b) => a.from.localeCompare(b.from));
  let active = sorted[0].sessionsPerDay;
  for (const entry of sorted) if (entry.from <= date) active = entry.sessionsPerDay;
  return active;
}

export function scheduledSessionsPerDayForTomorrow(item: Pick<ProgramItem, 'sessionsPerDay' | 'sessionsSchedule'>, today: string): SessionsPerDay {
  return sessionsPerDayOnDate(item, addDaysISO(today, 1));
}

/** Changing times a day today keeps today's number and applies the new one from tomorrow. */
export function applySessionsPerDayEdit(item: ProgramItem, newSessionsPerDay: SessionsPerDay, today: string): ProgramItem {
  const todayTarget = sessionsPerDayOnDate(item, today);
  const tomorrow = addDaysISO(today, 1);
  const base = item.sessionsSchedule.length > 0 ? item.sessionsSchedule.filter((s) => s.from !== tomorrow) : [{ from: item.addedOn, sessionsPerDay: todayTarget }];
  const next = newSessionsPerDay !== todayTarget ? [...base, { from: tomorrow, sessionsPerDay: newSessionsPerDay }] : base;
  return { ...item, sessionsPerDay: todayTarget, sessionsSchedule: next };
}

export function isItemActiveOnDate(item: Pick<ProgramItem, 'addedOn' | 'removedOn'>, date: string): boolean {
  if (date < item.addedOn) return false;
  if (item.removedOn && date >= item.removedOn) return false;
  return true;
}

export function skippedSlotsToday(item: Pick<ProgramItem, 'id' | 'sessionsPerDay' | 'sessionsSchedule'>, logs: ProgramLog[], today: string): SessionsPerDay[] {
  const target = sessionsPerDayOnDate(item, today);
  return logs
    .filter((l) => l.programItemId === item.id && l.logDate === today && l.skipped && l.sessionIndex >= 1 && l.sessionIndex <= target)
    .map((l) => l.sessionIndex)
    .sort((a, b) => a - b);
}

/** The next open session of an exercise today: a skipped session stays available for the evening one. */
export function nextSessionSlotToday(
  item: Pick<ProgramItem, 'id' | 'sessionsPerDay' | 'sessionsSchedule'>,
  logs: ProgramLog[],
  today: string,
): { nextSlot: SessionsPerDay | null; completedCount: number; skippedCount: number; target: SessionsPerDay } {
  const target = sessionsPerDayOnDate(item, today);
  const bySlot = new Map<number, ProgramLog>();
  for (const log of logs) if (log.programItemId === item.id && log.logDate === today && log.sessionIndex <= target) bySlot.set(log.sessionIndex, log);
  let completedCount = 0;
  let skippedCount = 0;
  let nextSlot: SessionsPerDay | null = null;
  for (let s = 1; s <= target; s++) {
    const entry = bySlot.get(s);
    if (!entry) {
      if (nextSlot === null) nextSlot = s as SessionsPerDay;
    } else if (entry.skipped) skippedCount += 1;
    else completedCount += 1;
  }
  return { nextSlot, completedCount, skippedCount, target };
}

export interface ProgramAdherence {
  /** Over finished days only; null until the first day has finished. */
  finishedDaysPercent: number | null;
  finishedDays: number;
  /** Sessions done today and sessions due today (optional exercises are not counted). */
  todayCompleted: number;
  todayTarget: number;
  missedYesterday: boolean;
}

/**
 * Habit over FINISHED days: sessions completed divided by (required exercises on the program that day x sessions that
 * day). Today shows separately and does not move the percent until the day ends. Optional exercises are ignored.
 * Days after the program's last day (when it has a length) are not counted.
 */
export function computeProgramAdherence(opts: {
  startDate: string;
  today: string;
  items: Pick<ProgramItem, 'id' | 'addedOn' | 'removedOn' | 'sessionsPerDay' | 'sessionsSchedule' | 'optional'>[];
  logs: ProgramLog[];
  durationDays?: number | null;
}): ProgramAdherence {
  const required = opts.items.filter((i) => !i.optional);
  const done = new Set<string>();
  for (const log of opts.logs) if (!log.skipped) done.add(`${log.programItemId}:${log.logDate}:${log.sessionIndex}`);
  const lastDay = opts.durationDays ? addDaysISO(opts.startDate, opts.durationDays - 1) : null;

  const day = (date: string) => {
    let expected = 0;
    let completed = 0;
    for (const item of required) {
      if (!isItemActiveOnDate(item, date)) continue;
      const target = sessionsPerDayOnDate(item, date);
      expected += target;
      for (let s = 1; s <= target; s++) if (done.has(`${item.id}:${date}:${s}`)) completed += 1;
    }
    return { expected, completed };
  };

  let finishedExpected = 0;
  let finishedCompleted = 0;
  let finishedDays = 0;
  for (let cursor = opts.startDate; cursor < opts.today; cursor = addDaysISO(cursor, 1)) {
    if (lastDay && cursor > lastDay) break;
    const d = day(cursor);
    if (d.expected > 0) finishedDays += 1;
    finishedExpected += d.expected;
    finishedCompleted += d.completed;
  }
  const today = day(opts.today);
  const yesterday = addDaysISO(opts.today, -1);
  const y = yesterday >= opts.startDate ? day(yesterday) : { expected: 0, completed: 0 };
  return {
    finishedDaysPercent: finishedExpected > 0 ? Math.min(100, Math.round((finishedCompleted / finishedExpected) * 100)) : null,
    finishedDays,
    todayCompleted: today.completed,
    todayTarget: today.expected,
    missedYesterday: y.expected > 0 && y.completed < y.expected,
  };
}

export interface SectionAdherence {
  phase: ExercisePhase;
  /** Percent of that section's required sessions done over the window; null when it had none. */
  percent: number | null;
  expected: number;
  completed: number;
}

/** Last N finished days of a program (most recent first), within its dates. */
function recentFinishedDays(startDate: string, today: string, days: number, durationDays?: number | null): string[] {
  const lastDay = durationDays ? addDaysISO(startDate, durationDays - 1) : null;
  const out: string[] = [];
  for (let d = addDaysISO(today, -1); d >= startDate && out.length < days; d = addDaysISO(d, -1)) {
    if (lastDay && d > lastDay) continue;
    out.push(d);
  }
  return out;
}

type AdherenceItem = Pick<ProgramItem, 'id' | 'phase' | 'addedOn' | 'removedOn' | 'sessionsPerDay' | 'sessionsSchedule' | 'optional'>;

function sessionsDone(items: AdherenceItem[], logs: ProgramLog[], date: string) {
  const done = new Set(logs.filter((l) => !l.skipped && l.logDate === date).map((l) => `${l.programItemId}:${l.sessionIndex}`));
  const byPhase = new Map<ExercisePhase, { expected: number; completed: number }>();
  for (const item of items) {
    if (item.optional || !isItemActiveOnDate(item, date)) continue;
    const target = sessionsPerDayOnDate(item, date);
    const slot = byPhase.get(item.phase) ?? { expected: 0, completed: 0 };
    slot.expected += target;
    for (let s = 1; s <= target; s++) if (done.has(`${item.id}:${s}`)) slot.completed += 1;
    byPhase.set(item.phase, slot);
  }
  return byPhase;
}

/** Habit per section ("Mobility 90%, Strengthening 30%") over the last `days` finished days. */
export function sectionAdherence(opts: {
  items: AdherenceItem[];
  logs: ProgramLog[];
  startDate: string;
  today: string;
  days?: number;
  durationDays?: number | null;
}): SectionAdherence[] {
  const totals = new Map<ExercisePhase, { expected: number; completed: number }>();
  for (const date of recentFinishedDays(opts.startDate, opts.today, opts.days ?? 7, opts.durationDays)) {
    for (const [phase, v] of sessionsDone(opts.items, opts.logs, date)) {
      const t = totals.get(phase) ?? { expected: 0, completed: 0 };
      t.expected += v.expected;
      t.completed += v.completed;
      totals.set(phase, t);
    }
  }
  return SESSION_ORDER.filter((p) => totals.has(p)).map((phase) => {
    const t = totals.get(phase)!;
    return { phase, expected: t.expected, completed: t.completed, percent: t.expected > 0 ? Math.round((t.completed / t.expected) * 100) : null };
  });
}

/**
 * The "Skipping Strengthening: 4 of last 5 days" signal (amendment 81): a section with nothing done on a finished day
 * while most of the rest of the program was done, on at least 4 of the last 5 finished days.
 */
export function sectionSkipPattern(opts: {
  items: AdherenceItem[];
  logs: ProgramLog[];
  startDate: string;
  today: string;
  durationDays?: number | null;
}): Array<{ phase: ExercisePhase; missedDays: number; ofDays: number }> {
  const days = recentFinishedDays(opts.startDate, opts.today, 5, opts.durationDays);
  if (days.length < 4) return [];
  const missed = new Map<ExercisePhase, number>();
  for (const date of days) {
    const byPhase = sessionsDone(opts.items, opts.logs, date);
    for (const [phase, v] of byPhase) {
      if (v.expected === 0 || v.completed > 0) continue;
      let restExpected = 0;
      let restDone = 0;
      for (const [other, o] of byPhase) if (other !== phase) { restExpected += o.expected; restDone += o.completed; }
      if (restExpected > 0 && restDone / restExpected >= 0.5) missed.set(phase, (missed.get(phase) ?? 0) + 1);
    }
  }
  return [...missed.entries()].filter(([, n]) => n >= 4).map(([phase, missedDays]) => ({ phase, missedDays, ofDays: days.length }));
}

// ---- Session time estimate ---------------------------------------------------

export type EstimateItem = Pick<DoseFields, 'doseType' | 'sets' | 'reps' | 'holdSeconds' | 'durationSeconds' | 'restSeconds' | 'side'> & {
  /** null = same as the program. */
  sessionsPerDay: number | null;
};

/** Seconds for one exercise in one session: reps about 4 s each; holds and timed use the patient timers' fixed pauses. */
export function estimateItemSeconds(it: EstimateItem): number {
  const sets = Math.max(1, it.sets);
  const sides = it.side === 'both' ? 2 : 1;
  const reps = it.reps ?? 0;
  let oneSet: number;
  if (it.doseType === 'hold') oneSet = 5 + reps * ((it.holdSeconds ?? 0) + 3) + Math.max(0, reps - 1) * 4;
  else if (it.doseType === 'timed') oneSet = 5 + (it.durationSeconds ?? 0) + 3;
  else oneSet = reps * 4;
  return oneSet * sets * sides + (sets - 1) * Math.max(0, it.restSeconds) + 20;
}

/** About how many minutes one session takes (at least 1), for the exercises that fall in that session. No warning at any length. */
export function estimateSessionMinutes(items: EstimateItem[], programSessionsPerDay: number, session = 1): number {
  const seconds = items
    .filter((it) => (it.sessionsPerDay ?? programSessionsPerDay) >= session)
    .reduce((sum, it) => sum + estimateItemSeconds(it), 0);
  return Math.max(1, Math.round(seconds / 60));
}

// ---- Snapshots (copies, never links) -----------------------------------------

export function snapshotExerciseToTemplateItem(ex: Exercise, sortOrder: number): ExerciseTemplateItem {
  return {
    sourceExerciseId: ex.id,
    title: ex.title,
    bodyRegion: ex.bodyRegion,
    phase: ex.phase,
    equipment: [...ex.equipment],
    instructions: ex.instructions,
    mediaType: ex.mediaType,
    mediaKeys: [...ex.mediaKeys],
    mediaCaptions: [...ex.mediaCaptions],
    doseType: ex.doseType,
    sets: ex.defaultSets,
    reps: ex.defaultReps,
    holdSeconds: ex.defaultHoldSeconds,
    durationSeconds: ex.defaultDurationSeconds,
    restSeconds: ex.defaultRestSeconds,
    sessionsPerDay: ex.defaultSessionsPerDay,
    side: ex.side,
    optional: false,
    stopIf: ex.stopIf,
    sortOrder,
  };
}

export function snapshotTemplateItemToProgramItem(ti: ExerciseTemplateItem, today: string, sortOrder: number): Omit<ProgramItem, 'id' | 'programId'> {
  return {
    sourceExerciseId: ti.sourceExerciseId ?? null,
    title: ti.title,
    bodyRegion: ti.bodyRegion,
    phase: ti.phase,
    equipment: [...ti.equipment],
    instructions: ti.instructions,
    mediaType: ti.mediaType,
    mediaKeys: [...ti.mediaKeys],
    mediaCaptions: [...ti.mediaCaptions],
    doseType: ti.doseType,
    sets: ti.sets,
    reps: ti.reps,
    holdSeconds: ti.holdSeconds,
    durationSeconds: ti.durationSeconds,
    restSeconds: ti.restSeconds,
    sessionsPerDay: ti.sessionsPerDay,
    sessionsSchedule: [{ from: today, sessionsPerDay: ti.sessionsPerDay }],
    side: ti.side,
    optional: ti.optional,
    stopIf: ti.stopIf,
    specialInstructions: '',
    sortOrder,
    addedOn: today,
    removedOn: null,
  };
}
