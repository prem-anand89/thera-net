// The program sheet's working copy of a program and the rules around it: where it starts from, what Times a day does to
// the rows, the time estimate, the settings that go to the database and when Save is allowed. Pure and tested.
import { EXERCISE_PHASES, addDaysISO, estimateSessionMinutes, type ExercisePhase, type ExerciseTemplate, type SessionsPerDay } from '@/domain/hep';
import { isDoseValid } from '@/domain/hepDose';
import { summarizeProgramChanges, type ProgramChange } from '@/domain/programChanges';
import type { HepItemInput, ProgramBundle, ProgramSettings } from '@/services/hepService';
import { itemDose, programItemToInput, templateItemToInput } from './hepItems';

export interface ProgramDraft {
  title: string;
  items: HepItemInput[];
  sessionsPerDay: SessionsPerDay;
  /** null = ongoing. */
  durationDays: number | null;
  /** A new program starts today (0) or tomorrow (1). */
  startOffset: 0 | 1;
  /** A new program: days until the check-in; null = none. */
  checkinDays: number | null;
  /** An edit: the check-in date; null = none. */
  checkinOn: string | null;
  feedbackDefault: 'pain' | 'effort';
  targetPct: number;
  /** The therapist's own 4 digits; empty = automatic. */
  customPin: string;
  therapistId: string | null;
}

export const LENGTH_CHOICES: Array<{ label: string; days: number | null }> = [
  { label: '1 week', days: 7 }, { label: '2 weeks', days: 14 }, { label: '3 weeks', days: 21 }, { label: '4 weeks', days: 28 }, { label: 'Ongoing', days: null },
];
export const CHECKIN_CHOICES: Array<{ label: string; days: number | null }> = [{ label: 'In 7 days', days: 7 }, { label: 'In 14 days', days: 14 }, { label: 'None', days: null }];
export const TARGET_CHOICES = [50, 70, 90] as const;

export const blankDraft = (therapistId: string | null = null): ProgramDraft => ({
  title: '', items: [], sessionsPerDay: 1, durationDays: 7, startOffset: 0, checkinDays: 7, checkinOn: null, feedbackDefault: 'pain', targetPct: 70, customPin: '', therapistId,
});

/** The program's times a day for a set of rows: the commonest value (so only the odd ones read as overrides). */
export function commonSessionsPerDay(items: Pick<HepItemInput, 'sessionsPerDay'>[]): SessionsPerDay {
  const counts = new Map<number, number>();
  for (const i of items) counts.set(i.sessionsPerDay, (counts.get(i.sessionsPerDay) ?? 0) + 1);
  const best = [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0] - b[0])[0]?.[0];
  return (best ?? 1) as SessionsPerDay;
}

/** A new program from a template: the program name starts as the template's name and the therapist edits it. */
export function draftFromTemplate(t: ExerciseTemplate, therapistId: string | null): ProgramDraft {
  const items = t.items.map(templateItemToInput);
  return { ...blankDraft(therapistId), title: t.title, items, sessionsPerDay: commonSessionsPerDay(items) };
}

/**
 * From a program that exists. `edit` keeps the row ids (a save updates them and anything left out is removed);
 * `copy` is for "Same as last time" and "Earlier program": the rows and settings, as a brand new program.
 */
export function draftFromBundle(b: ProgramBundle, how: 'edit' | 'copy'): ProgramDraft {
  const p = b.program;
  const live = p.items.filter((i) => i.removedOn == null);
  const items = live.map((i) => (how === 'edit' ? programItemToInput(i) : { ...programItemToInput(i), id: undefined }));
  return {
    title: p.title,
    items,
    sessionsPerDay: p.sessionsPerDay,
    durationDays: p.durationDays,
    startOffset: 0,
    checkinDays: how === 'copy' ? 7 : null,
    checkinOn: how === 'edit' ? p.checkinOn : null,
    feedbackDefault: p.feedbackDefault,
    targetPct: p.targetPct,
    customPin: '',
    therapistId: p.therapistId,
  };
}

/** The most recent program that is completed, or active but past its last day. */
export function latestEarlierProgram(bundles: ProgramBundle[], today: string): ProgramBundle | null {
  const earlier = bundles.filter(({ program: p }) => p.status === 'completed' || (p.status === 'active' && p.durationDays != null && today > addDaysISO(p.startDate, p.durationDays - 1)));
  return [...earlier].sort((a, b) => b.program.startDate.localeCompare(a.program.startDate) || b.program.createdAt.localeCompare(a.program.createdAt))[0] ?? null;
}

/** Changing the program's times a day moves every row that matched the old value; a row that was an override stays. */
export function changeSessionsPerDay(items: HepItemInput[], from: SessionsPerDay, to: SessionsPerDay): HepItemInput[] {
  return items.map((i) => (i.sessionsPerDay === from ? { ...i, sessionsPerDay: to } : i));
}

export const isSectionOptional = (items: HepItemInput[], phase: ExercisePhase) => {
  const rows = items.filter((i) => i.phase === phase);
  return rows.length > 0 && rows.every((i) => i.optional);
};
export const setSectionOptional = (items: HepItemInput[], phase: ExercisePhase, optional: boolean): HepItemInput[] => items.map((i) => (i.phase === phase ? { ...i, optional } : i));

const SESSION_NAMES: Record<number, string[]> = { 1: [''], 2: ['morning', 'evening'], 3: ['morning', 'afternoon', 'evening'] };

/** "About 14 min a session", or "23 min morning · 18 min evening" when the sessions differ. No warning at any length. */
export function estimateLabel(items: HepItemInput[], sessionsPerDay: SessionsPerDay): string {
  if (items.length === 0) return '';
  const minutes = Array.from({ length: sessionsPerDay }, (_, s) => estimateSessionMinutes(items, sessionsPerDay, s + 1));
  if (minutes.every((m) => m === minutes[0])) return `About ${minutes[0]} min a session`;
  return minutes.map((m, s) => `${m} min ${SESSION_NAMES[sessionsPerDay][s]}`).join(' · ');
}

export function createSettings(d: ProgramDraft): ProgramSettings {
  return { durationDays: d.durationDays, targetPct: d.targetPct, checkinDays: d.checkinDays, feedbackDefault: d.feedbackDefault, sessionsPerDay: d.sessionsPerDay };
}
export function updateSettings(d: ProgramDraft): ProgramSettings {
  return { durationDays: d.durationDays, targetPct: d.targetPct, checkinOn: d.checkinOn, feedbackDefault: d.feedbackDefault, sessionsPerDay: d.sessionsPerDay };
}

export const isPinOk = (pin: string) => pin === '' || /^\d{4}$/.test(pin);

/** Why Save is off, or null when it can go ahead. */
export function draftProblem(d: ProgramDraft, needsPatient: boolean, hasPatient: boolean): string | null {
  if (needsPatient && !hasPatient) return 'Choose the patient.';
  if (d.title.trim().length === 0) return 'Give the program a name.';
  if (d.items.length === 0) return 'Add at least one exercise.';
  if (!d.items.every((i) => isDoseValid(itemDose(i)))) return 'Check the numbers on the exercises.';
  if (!isPinOk(d.customPin)) return 'The PIN must be exactly 4 digits.';
  return null;
}

/** What changes with this save, worked out from the rows (never typed by hand). */
export function changesFor(before: HepItemInput[], after: HepItemInput[]): ProgramChange[] {
  return summarizeProgramChanges(before, after);
}

export const sameDraft = (a: ProgramDraft, b: ProgramDraft) => JSON.stringify(a) === JSON.stringify(b);

export { EXERCISE_PHASES };
