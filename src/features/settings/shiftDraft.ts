import type { ShiftTemplate } from '@/domain/types';
import { formatShiftSummary, validateShiftTemplate } from './shiftUtils';

/**
 * The shift-template editor's model: a shift is either **continuous** (one stretch with an optional lunch) or **split**
 * (a morning session and a later one with a long gap). Both are stored in the same four `ShiftTemplate` fields, with no
 * schema change:
 *
 *   startMinute              = session 1 start
 *   endMinute                = session 2 end (or the shift end when continuous)
 *   defaultBreakStartMinute  = session 1 end (or the lunch start when continuous)
 *   breakDurationMinutes     = the gap between the sessions (or the lunch length)
 *
 * `formatShiftSummary` calls a shift "split" when the break is 2 hours or more, so the editor enforces that line in both
 * directions: a split gap is at least 2 hours, and a continuous lunch is under 2 hours. That keeps what is edited and what
 * is displayed the same shift. Pure, so the rules are tested without a screen.
 */
export type ShiftMode = 'continuous' | 'split';

/** The split rule shared with `formatShiftSummary`: a break this long is a split shift. */
export const SPLIT_MIN_GAP_MINUTES = 120;

export interface ShiftDraft {
  mode: ShiftMode;
  /** Continuous: the shift start and end, and an optional lunch (0 = none). */
  start: number;
  end: number;
  lunchMinutes: number;
  lunchStart: number;
  /** Split: session 1 and session 2. */
  s1Start: number;
  s1End: number;
  s2Start: number;
  s2End: number;
}

export interface ShiftFields {
  startMinute: number;
  endMinute: number;
  breakDurationMinutes: number;
  defaultBreakStartMinute: number | null;
}

export const DEFAULT_SHIFT_DRAFT: ShiftDraft = {
  mode: 'continuous',
  start: 540,
  end: 1020,
  lunchMinutes: 60,
  lunchStart: 780,
  s1Start: 540,
  s1End: 780,
  s2Start: 960,
  s2End: 1200,
};

const round15 = (m: number) => Math.round(m / 15) * 15;

/** What an existing template looks like in the editor: split exactly when `formatShiftSummary` says so. */
export function draftFromTemplate(t: Pick<ShiftTemplate, 'startMinute' | 'endMinute' | 'breakDurationMinutes' | 'defaultBreakStartMinute'>): ShiftDraft {
  const base = { ...DEFAULT_SHIFT_DRAFT };
  const isSplit = formatShiftSummary(t as ShiftTemplate).isSplit && t.defaultBreakStartMinute !== null;
  if (isSplit) {
    const gapStart = t.defaultBreakStartMinute as number;
    return {
      ...base,
      mode: 'split',
      start: t.startMinute,
      end: t.endMinute,
      s1Start: t.startMinute,
      s1End: gapStart,
      s2Start: gapStart + t.breakDurationMinutes,
      s2End: t.endMinute,
    };
  }
  return {
    ...base,
    mode: 'continuous',
    start: t.startMinute,
    end: t.endMinute,
    lunchMinutes: t.breakDurationMinutes,
    lunchStart: t.defaultBreakStartMinute ?? Math.min(base.lunchStart, Math.max(t.startMinute, t.endMinute - t.breakDurationMinutes)),
    s1Start: t.startMinute,
    s2End: t.endMinute,
  };
}

/** The four stored fields for a draft (see the mapping above). */
export function fieldsFromDraft(d: ShiftDraft): ShiftFields {
  if (d.mode === 'split') {
    return {
      startMinute: d.s1Start,
      endMinute: d.s2End,
      breakDurationMinutes: d.s2Start - d.s1End,
      defaultBreakStartMinute: d.s1End,
    };
  }
  return {
    startMinute: d.start,
    endMinute: d.end,
    breakDurationMinutes: d.lunchMinutes,
    defaultBreakStartMinute: d.lunchMinutes > 0 ? d.lunchStart : null,
  };
}

/** Switching tabs keeps what was typed where it can: a lunch becomes the gap, a gap becomes a one-hour lunch. */
export function switchMode(d: ShiftDraft, mode: ShiftMode): ShiftDraft {
  if (mode === d.mode) return d;
  if (mode === 'split') {
    const length = d.end - d.start;
    // A continuous lunch under 2 hours cannot be a split gap, so open the gap at 3 hours (2 hours on a short day).
    const gap = length >= 540 ? 180 : SPLIT_MIN_GAP_MINUTES;
    const s1End = d.lunchMinutes > 0 ? d.lunchStart : round15(d.start + (length - gap) / 2);
    const s2Start = s1End + gap;
    const valid = s1End > d.start && s2Start < d.end;
    return {
      ...d,
      mode,
      s1Start: d.start,
      s1End: valid ? s1End : d.start + 60,
      s2Start: valid ? s2Start : d.start + 60 + gap,
      s2End: d.end,
    };
  }
  const lunch = Math.min(60, Math.max(0, d.s2Start - d.s1End));
  return { ...d, mode, start: d.s1Start, end: d.s2End, lunchMinutes: lunch, lunchStart: d.s1End };
}

/** What is wrong, in plain words (null = fine). The shift name is checked by the same rules as before. */
export function draftProblem(name: string, d: ShiftDraft): string | null {
  const fields = fieldsFromDraft(d);
  if (d.mode === 'split') {
    if (!name.trim()) return 'Shift name is required.';
    if (d.s1End <= d.s1Start) return 'Session 1 must end after it starts.';
    if (d.s2End <= d.s2Start) return 'Session 2 must end after it starts.';
    if (d.s2Start <= d.s1End) return 'Session 2 must start after session 1 ends.';
    if (d.s2Start - d.s1End < SPLIT_MIN_GAP_MINUTES) return 'For breaks under 2 hours, use Continuous shift with a break.';
  } else if (d.lunchMinutes >= SPLIT_MIN_GAP_MINUTES) {
    return 'A break of 2 hours or more is a split shift. Choose Split.';
  }
  return validateShiftTemplate(name, fields.startMinute, fields.endMinute, fields.breakDurationMinutes, fields.defaultBreakStartMinute).error;
}

/** "8h", "8h 30m", "45m" */
export function formatDuration(minutes: number): string {
  const m = Math.max(0, Math.round(minutes));
  const h = Math.floor(m / 60);
  const rest = m % 60;
  if (h === 0) return `${rest}m`;
  return rest === 0 ? `${h}h` : `${h}h ${rest}m`;
}

/** The live badge: "8h working", or for a split "8h 30m working · 3h 30m gap". */
export function draftBadge(d: ShiftDraft): string {
  const f = fieldsFromDraft(d);
  const working = Math.max(0, f.endMinute - f.startMinute - f.breakDurationMinutes);
  if (d.mode === 'split') return `${formatDuration(working)} working · ${formatDuration(f.breakDurationMinutes)} gap`;
  return `${formatDuration(working)} working`;
}

/** The three suggested shifts offered once, for a clinic that has none. */
export const STARTER_SHIFTS: { name: string; fields: ShiftFields }[] = [
  { name: 'Morning', fields: { startMinute: 480, endMinute: 990, breakDurationMinutes: 30, defaultBreakStartMinute: 780 } }, // 8:00–4:30, 30 min lunch at 1:00
  { name: 'Evening', fields: { startMinute: 750, endMinute: 1260, breakDurationMinutes: 30, defaultBreakStartMinute: 1020 } }, // 12:30–9:00, 30 min break at 5:00
  { name: 'Split', fields: { startMinute: 510, endMinute: 1230, breakDurationMinutes: 210, defaultBreakStartMinute: 780 } }, // 8:30–1:00 and 4:30–8:30
];
