// One row model for the Programs list: the table and the phone cards are both drawn from this, so they can never
// disagree (amendment 66). Pure functions: the clock (today) and the data window are passed in.
import { EXERCISE_PHASE_LABELS, addDaysISO, computeProgramAdherence, sectionSkipPattern, type ProgramStatus, type SkipReason } from '@/domain/hep';
import { formatDateDM } from '@/domain/fiscalYear';
import type { ProgramBundle } from '@/services/hepService';

export type ProgramBucket = 'attention' | 'active' | 'ended' | 'past';
export type SignalTone = 'red' | 'amber' | 'blue' | 'grey' | 'green';

export interface ProgramSignal {
  key: string;
  label: string;
  tone: SignalTone;
  /** Counts toward "Needs attention". Grey and informational signals do not. */
  attention: boolean;
}

export interface ProgramRow {
  id: string;
  patientId: string;
  patientName: string;
  title: string;
  therapistId: string | null;
  therapistName: string | null;
  status: ProgramStatus;
  /** Active, but its last day has passed: waits for a decision (extend, complete, prescribe next). */
  ended: boolean;
  startedLabel: string;
  exerciseCount: number;
  /** "Day 4 of 7", "Day 4" when ongoing, "Ended". */
  dayLabel: string;
  durationDays: number | null;
  todayCompleted: number;
  todayTarget: number;
  /** null until the first day has finished ("Too early"). */
  habitPercent: number | null;
  finishedDays: number;
  lastActive: string | null;
  lastActiveLabel: string;
  signals: ProgramSignal[];
  needsAttention: boolean;
  /** Where it is listed besides Needs attention: Active, Ended or Past. */
  bucket: Exclude<ProgramBucket, 'attention'>;
}

const SKIP_REASON_LABEL: Record<SkipReason, string> = {
  pain: 'Pain', no_time: 'No time', too_hard: 'Too hard', forgot: 'Forgot', didnt_understand: "Didn't understand", other: 'Other',
};

function daysBetween(a: string, b: string): number {
  return Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000);
}

export function lastActiveLabel(lastActive: string | null, today: string): string {
  if (!lastActive) return '—';
  const n = daysBetween(lastActive, today);
  if (n <= 0) return 'Today';
  if (n === 1) return 'Yesterday';
  return `${n} days ago`;
}

/** The most common reason the patient gave for skipping, if any. */
function topSkipReason(logs: ProgramBundle['logs']): SkipReason | null {
  const counts = new Map<SkipReason, number>();
  for (const l of logs) if (l.skipped && l.skipReason) counts.set(l.skipReason, (counts.get(l.skipReason) ?? 0) + 1);
  return [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
}

/**
 * Builds the row for one program. `windowStart` is the first day of log data that was fetched: "no activity" is
 * measured from the later of that day and the program's start, and shown as "N+ days" when it hit the edge.
 */
export function buildProgramRow(bundle: ProgramBundle, opts: { today: string; windowStart: string }): ProgramRow {
  const { program, logs, sessionFeedback, access } = bundle;
  const { today, windowStart } = opts;
  const items = program.items.filter((i) => i.removedOn == null);
  const lastDay = program.durationDays ? addDaysISO(program.startDate, program.durationDays - 1) : null;
  const running = program.status === 'active';
  const ended = running && lastDay != null && today > lastDay;
  const live = running && !ended;
  const paused = program.status === 'paused';

  const adherence = computeProgramAdherence({ startDate: program.startDate, today, items: program.items, logs, durationDays: program.durationDays });
  const lastActive = logs.reduce<string | null>((m, l) => (m == null || l.logDate > m ? l.logDate : m), null);

  const signals: ProgramSignal[] = [];

  // Pain of 7+ that no one has looked at yet (opening the program on the chart marks it seen for everyone).
  if (program.status !== 'completed') {
    const reviewed = program.painReviewedThrough ?? null;
    const unseen = sessionFeedback.filter((f) => f.painScore != null && f.painScore >= 7 && (reviewed == null || f.createdAt > reviewed));
    if (unseen.length > 0) {
      const worst = unseen.reduce((a, b) => ((b.painScore ?? 0) > (a.painScore ?? 0) ? b : a));
      const marked = worst.painItemIds.map((id) => program.items.find((i) => i.id === id)?.title).find(Boolean);
      signals.push({ key: 'pain', label: `Pain ${worst.painScore}/10${marked ? ` after ${marked}` : ''}`, tone: 'red', attention: true });
    }
  }

  if (ended) {
    const reason = topSkipReason(logs);
    const met = adherence.finishedDaysPercent != null && adherence.finishedDaysPercent >= program.targetPct;
    signals.push(
      met
        ? { key: 'ended', label: `Met ${adherence.finishedDaysPercent}%`, tone: 'green', attention: true }
        : { key: 'ended', label: reason ? `Not met: ${SKIP_REASON_LABEL[reason]}` : `Not met${adherence.finishedDaysPercent != null ? ` (${adherence.finishedDaysPercent}%)` : ''}`, tone: 'amber', attention: true },
    );
  }

  if (live) {
    const sinceStart = daysBetween(program.startDate, today);
    if (lastActive == null && access && access.openCount > 0) {
      signals.push({ key: 'opened', label: `Opened ${access.openCount}×, nothing ticked`, tone: 'grey', attention: false });
    } else if (lastActive == null && access && access.openCount === 0 && sinceStart >= 2) {
      signals.push({ key: 'link', label: 'Link not opened yet', tone: 'amber', attention: true });
    } else if (lastActive == null && sinceStart >= 2) {
      const base = windowStart > program.startDate ? windowStart : program.startDate;
      const n = daysBetween(base, today);
      signals.push({ key: 'idle', label: `No activity ${n}${windowStart > program.startDate ? '+' : ''} days`, tone: 'amber', attention: true });
    } else if (lastActive != null && daysBetween(lastActive, today) >= 2) {
      signals.push({ key: 'idle', label: `No activity ${daysBetween(lastActive, today)} days`, tone: 'amber', attention: true });
    }
    if (program.checkinOn && program.checkinOn <= today) signals.push({ key: 'checkin', label: 'Check-in due', tone: 'blue', attention: true });
    const skip = sectionSkipPattern({ items: program.items, logs, startDate: program.startDate, today, durationDays: program.durationDays })[0];
    if (skip) signals.push({ key: 'skip', label: `Skipping ${EXERCISE_PHASE_LABELS[skip.phase]}: ${skip.missedDays} of last ${skip.ofDays} days`, tone: 'amber', attention: false });
  }
  if (paused) signals.push({ key: 'paused', label: 'Paused', tone: 'grey', attention: false });

  const dayNumber = Math.max(1, daysBetween(program.startDate, today) + 1);
  return {
    id: program.id,
    patientId: program.patientId,
    patientName: bundle.patientName,
    title: program.title,
    therapistId: program.therapistId,
    therapistName: bundle.therapistName,
    status: program.status,
    ended,
    startedLabel: `Started ${formatDateDM(program.startDate)}`,
    exerciseCount: items.length,
    dayLabel: program.status === 'completed' ? 'Completed' : ended ? 'Ended' : program.durationDays ? `Day ${Math.min(dayNumber, program.durationDays)} of ${program.durationDays}` : `Day ${dayNumber}`,
    durationDays: program.durationDays,
    todayCompleted: adherence.todayCompleted,
    todayTarget: adherence.todayTarget,
    habitPercent: adherence.finishedDaysPercent,
    finishedDays: adherence.finishedDays,
    lastActive,
    lastActiveLabel: lastActiveLabel(lastActive, today),
    signals,
    needsAttention: program.status !== 'completed' && signals.some((s) => s.attention),
    bucket: program.status === 'completed' ? 'past' : ended ? 'ended' : 'active',
  };
}

export interface ProgramFilterCounts { attention: number; active: number; ended: number; past: number }

export function countBuckets(rows: ProgramRow[]): ProgramFilterCounts {
  return {
    attention: rows.filter((r) => r.needsAttention).length,
    active: rows.filter((r) => r.bucket === 'active').length,
    ended: rows.filter((r) => r.bucket === 'ended').length,
    past: rows.filter((r) => r.bucket === 'past').length,
  };
}

export function filterRows(rows: ProgramRow[], bucket: ProgramBucket): ProgramRow[] {
  return bucket === 'attention' ? rows.filter((r) => r.needsAttention) : rows.filter((r) => r.bucket === bucket);
}

const SIGNAL_RANK: Record<SignalTone, number> = { red: 0, amber: 1, blue: 2, green: 3, grey: 4 };

/** Most urgent first: pain, then ended, no activity, check-in; within the same urgency, the one idle the longest. */
export function sortRows(rows: ProgramRow[]): ProgramRow[] {
  const urgency = (r: ProgramRow) => Math.min(...r.signals.filter((s) => s.attention).map((s) => SIGNAL_RANK[s.tone]), 9);
  return [...rows].sort((a, b) => urgency(a) - urgency(b) || (a.lastActive ?? '').localeCompare(b.lastActive ?? '') || a.patientName.localeCompare(b.patientName));
}

export function matchesProgramSearch(r: Pick<ProgramRow, 'patientName' | 'title'>, query: string): boolean {
  const q = query.trim().toLowerCase();
  return !q || `${r.patientName} ${r.title}`.toLowerCase().includes(q);
}

/** How much longer a program can be extended by, in days (one list for the Programs tab and the patient chart). */
export const EXTEND_DAYS = [7, 14, 28] as const;
