import { describe, expect, it } from 'vitest';
import {
  DEFAULT_SHIFT_DRAFT,
  STARTER_SHIFTS,
  draftBadge,
  draftFromTemplate,
  draftProblem,
  fieldsFromDraft,
  formatDuration,
  switchMode,
  type ShiftDraft,
} from './shiftDraft';
import { formatShiftSummary, validateShiftTemplate } from './shiftUtils';
import type { ShiftTemplate } from '@/domain/types';

const template = (f: Partial<ShiftTemplate> & Pick<ShiftTemplate, 'startMinute' | 'endMinute' | 'breakDurationMinutes' | 'defaultBreakStartMinute'>): ShiftTemplate =>
  ({ id: 't', clinicId: 'c', name: 'S', active: true, updatedAt: '', ...f }) as ShiftTemplate;

const split: ShiftDraft = { ...DEFAULT_SHIFT_DRAFT, mode: 'split', s1Start: 510, s1End: 780, s2Start: 990, s2End: 1230 }; // 8:30-1:00, 4:30-8:30

describe('mapping to the four stored fields', () => {
  it('a continuous shift stores its start, end and lunch', () => {
    expect(fieldsFromDraft({ ...DEFAULT_SHIFT_DRAFT })).toEqual({ startMinute: 540, endMinute: 1020, breakDurationMinutes: 60, defaultBreakStartMinute: 780 });
    expect(fieldsFromDraft({ ...DEFAULT_SHIFT_DRAFT, lunchMinutes: 0 })).toMatchObject({ breakDurationMinutes: 0, defaultBreakStartMinute: null });
  });

  it('a split shift stores session 1 start, session 2 end, session 1 end as the break start and the gap as its length', () => {
    expect(fieldsFromDraft(split)).toEqual({ startMinute: 510, endMinute: 1230, breakDurationMinutes: 210, defaultBreakStartMinute: 780 });
  });
});

describe('round trip: what is saved opens as the same shift, and is displayed as the same kind', () => {
  const cases: [string, ShiftDraft][] = [
    ['continuous with lunch', { ...DEFAULT_SHIFT_DRAFT }],
    ['continuous without lunch', { ...DEFAULT_SHIFT_DRAFT, lunchMinutes: 0 }],
    ['continuous with a 119 minute break', { ...DEFAULT_SHIFT_DRAFT, lunchMinutes: 119 }],
    ['split, 3 hour gap', split],
    ['split, exactly 2 hours', { ...split, s1End: 780, s2Start: 900 }],
  ];
  for (const [name, draft] of cases) {
    it(name, () => {
      const t = template(fieldsFromDraft(draft));
      const back = draftFromTemplate(t);
      expect(back.mode).toBe(draft.mode);
      expect(fieldsFromDraft(back)).toEqual(fieldsFromDraft(draft));
      // the card shows "SPLIT SHIFT" exactly when the editor was in Split
      expect(formatShiftSummary(t).isSplit).toBe(draft.mode === 'split');
    });
  }
});

describe('draftProblem', () => {
  it('accepts a proper continuous and a proper split shift', () => {
    expect(draftProblem('Morning', DEFAULT_SHIFT_DRAFT)).toBeNull();
    expect(draftProblem('Split', split)).toBeNull();
  });

  it('requires a gap of 2 hours in Split, and tells you where to go for a shorter break', () => {
    expect(draftProblem('S', { ...split, s1End: 780, s2Start: 840 })).toBe('For breaks under 2 hours, use Continuous shift with a break.');
  });

  it('a continuous lunch of 2 hours or more is a split shift', () => {
    expect(draftProblem('S', { ...DEFAULT_SHIFT_DRAFT, lunchMinutes: 120, lunchStart: 720 })).toBe('A break of 2 hours or more is a split shift. Choose Split.');
  });

  it('catches backwards times and a missing name', () => {
    expect(draftProblem('', DEFAULT_SHIFT_DRAFT)).toBe('Shift name is required.');
    expect(draftProblem('S', { ...split, s2Start: 700 })).toBe('Session 2 must start after session 1 ends.');
    expect(draftProblem('S', { ...split, s1End: 500 })).toBe('Session 1 must end after it starts.');
    expect(draftProblem('S', { ...split, s2End: 900 })).toBe('Session 2 must end after it starts.');
    expect(draftProblem('S', { ...DEFAULT_SHIFT_DRAFT, end: 500 })).toMatch(/end time must be after start/);
  });

  it('keeps the existing lunch rules (inside the shift)', () => {
    expect(draftProblem('S', { ...DEFAULT_SHIFT_DRAFT, lunchStart: 1000, lunchMinutes: 60 })).toBe('Break must finish before the shift ends.');
  });
});

describe('switching tabs', () => {
  it('a continuous lunch with a long enough day opens a 3 hour gap at the lunch', () => {
    const s = switchMode({ ...DEFAULT_SHIFT_DRAFT, start: 480, end: 1260, lunchMinutes: 60, lunchStart: 780 }, 'split');
    expect(s.mode).toBe('split');
    expect(s.s1Start).toBe(480);
    expect(s.s1End).toBe(780);
    expect(s.s2Start - s.s1End).toBe(180);
    expect(s.s2End).toBe(1260);
    expect(draftProblem('S', s)).toBeNull();
  });

  it('with no lunch it cuts the day around the middle, and is always a valid split', () => {
    for (const [start, end] of [[540, 1020], [480, 1260], [600, 1080]] as [number, number][]) {
      const s = switchMode({ ...DEFAULT_SHIFT_DRAFT, start, end, lunchMinutes: 0 }, 'split');
      expect(draftProblem('S', s), `${start}-${end}`).toBeNull();
    }
  });

  it('going back to Continuous keeps the outer times and uses up to an hour of the gap as lunch', () => {
    const c = switchMode(split, 'continuous');
    expect(c).toMatchObject({ mode: 'continuous', start: 510, end: 1230, lunchMinutes: 60, lunchStart: 780 });
    expect(draftProblem('S', c)).toBeNull();
  });
});

describe('the live badge', () => {
  it('says the working time, and for a split the gap', () => {
    expect(draftBadge(DEFAULT_SHIFT_DRAFT)).toBe('7h working');
    expect(draftBadge(split)).toBe('8h 30m working · 3h 30m gap');
    expect(formatDuration(45)).toBe('45m');
    expect(formatDuration(480)).toBe('8h');
  });
});

describe('suggested shifts', () => {
  it('are all valid templates, and the split one is a split', () => {
    for (const s of STARTER_SHIFTS) {
      const f = s.fields;
      expect(validateShiftTemplate(s.name, f.startMinute, f.endMinute, f.breakDurationMinutes, f.defaultBreakStartMinute).valid, s.name).toBe(true);
      const draft = draftFromTemplate(template(f));
      expect(draftProblem(s.name, draft), s.name).toBeNull();
    }
    expect(draftFromTemplate(template(STARTER_SHIFTS[2].fields)).mode).toBe('split');
    expect(draftFromTemplate(template(STARTER_SHIFTS[0].fields)).mode).toBe('continuous');
  });
});
