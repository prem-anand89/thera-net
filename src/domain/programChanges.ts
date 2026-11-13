// The "Updated by your therapist" summary (amendment 45): what was added, removed or changed when a program is edited,
// worked out from the items being saved, not typed by hand.
import type { DoseType, ExerciseSide, SessionsPerDay } from './hep';

export interface ChangeItem {
  /** Present for items that already exist on the program. */
  id?: string;
  title: string;
  doseType: DoseType;
  sets: number;
  reps: number | null;
  holdSeconds: number | null;
  durationSeconds: number | null;
  restSeconds: number;
  side: ExerciseSide;
  sessionsPerDay: SessionsPerDay;
  optional: boolean;
  specialInstructions?: string;
}

export interface ProgramChange {
  title: string;
  change: 'added' | 'removed' | 'changed';
  /** For example "sets 3 to 4; reps 10 to 12". */
  detail?: string;
}

const PER_DAY = ['', 'once a day', 'twice a day', '3 times a day'];

function detailFor(a: ChangeItem, b: ChangeItem): string[] {
  const out: string[] = [];
  const num = (label: string, x: number | null, y: number | null, unit = '') => {
    if (x !== y) out.push(`${label} ${x ?? '–'} to ${y ?? '–'}${unit}`);
  };
  if (a.doseType !== b.doseType) out.push(`now ${b.doseType === 'hold' ? 'reps with hold' : b.doseType}`);
  num('sets', a.sets, b.sets);
  num('reps', a.reps, b.reps);
  num('hold', a.holdSeconds, b.holdSeconds, ' s');
  num('time', a.durationSeconds, b.durationSeconds, ' s');
  num('rest', a.restSeconds, b.restSeconds, ' s');
  if (a.side !== b.side) out.push(b.side === 'both' ? 'now each side' : b.side === 'none' ? 'no longer one side' : `now ${b.side} side`);
  if (a.sessionsPerDay !== b.sessionsPerDay) out.push(`now ${PER_DAY[b.sessionsPerDay]}`);
  if (a.optional !== b.optional) out.push(b.optional ? 'now optional' : 'no longer optional');
  if ((a.specialInstructions ?? '') !== (b.specialInstructions ?? '')) out.push('new instruction');
  return out;
}

/** Items matched by id. New items (no id, or an id that was not there) are added; missing ones are removed. */
export function summarizeProgramChanges(before: ChangeItem[], after: ChangeItem[]): ProgramChange[] {
  const old = new Map(before.filter((b) => b.id).map((b) => [b.id as string, b]));
  const keep = new Set<string>();
  const out: ProgramChange[] = [];
  for (const item of after) {
    const prev = item.id ? old.get(item.id) : undefined;
    if (!prev) {
      out.push({ title: item.title, change: 'added' });
      continue;
    }
    keep.add(item.id as string);
    const detail = detailFor(prev, item);
    if (detail.length > 0) out.push({ title: item.title, change: 'changed', detail: detail.join('; ') });
  }
  for (const b of before) if (b.id && !keep.has(b.id)) out.push({ title: b.title, change: 'removed' });
  return out;
}
