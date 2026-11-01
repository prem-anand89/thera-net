import { describe, expect, it } from 'vitest';
import {
  closedGapLabel,
  describeShifts,
  envelopeOf,
  operatingFromDays,
  operatingFromShifts,
  shiftsFromIntervals,
  shiftsFromOperating,
  shiftsProblem,
  splitSession,
  type Shifts,
} from './operatingHours';

const split: Shifts = { s1: [540, 780], s2: [960, 1200] }; // 9–1, 4–8
const single: Shifts = { s1: [540, 1020], s2: null };

describe('operatingFromShifts / shiftsFromOperating', () => {
  it('writes the pattern on every weekday and reads it back as one uniform pattern', () => {
    const hours = operatingFromShifts(split);
    expect(Object.keys(hours)).toHaveLength(7);
    expect(hours['3']).toEqual([[540, 780], [960, 1200]]);
    const read = shiftsFromOperating(hours, [1, 2, 3, 4, 5, 6], { startHour: 9, endHour: 17 });
    expect(read.uniform).toEqual(split);
  });

  it('with nothing stored the clinic is one block, every open day', () => {
    const read = shiftsFromOperating(null, [1, 2, 3], { startHour: 9, endHour: 17 });
    expect(read.uniform).toEqual({ s1: [540, 1020], s2: null });
  });

  it('reports days that differ, and ignores closed weekdays when judging', () => {
    const hours = operatingFromDays({ 1: split, 2: split, 3: single }, [1, 2, 3]);
    expect(shiftsFromOperating(hours, [1, 2, 3], { startHour: 9, endHour: 17 }).uniform).toBeNull();
    // Wednesday closed: Monday and Tuesday agree
    expect(shiftsFromOperating(hours, [1, 2], { startHour: 9, endHour: 17 }).uniform).toEqual(split);
  });

  it('a day with no entry reads as the clinic block', () => {
    const hours = operatingFromDays({ 1: split }, [1]);
    expect(shiftsFromOperating(hours, [1, 2], { startHour: 9, endHour: 17 }).perDay[2]).toEqual({ s1: [540, 1020], s2: null });
  });
});

describe('shiftsFromIntervals', () => {
  it('takes one or two sessions in any order, nothing else', () => {
    expect(shiftsFromIntervals([[960, 1200], [540, 780]])).toEqual(split);
    expect(shiftsFromIntervals([[540, 1020]])).toEqual(single);
    expect(shiftsFromIntervals([])).toBeNull();
    expect(shiftsFromIntervals([[1, 2], [3, 4], [5, 6]])).toBeNull();
    expect(shiftsFromIntervals('x')).toBeNull();
  });
});

describe('envelopeOf', () => {
  it('rounds the earliest start down and the latest end up to whole hours', () => {
    expect(envelopeOf(operatingFromShifts({ s1: [570, 780], s2: [960, 1230] }))).toEqual({ startHour: 9, endHour: 21 });
  });

  it('is null with no intervals', () => {
    expect(envelopeOf({})).toBeNull();
  });
});

describe('shiftsProblem', () => {
  it('accepts a single session and a proper split', () => {
    expect(shiftsProblem(single)).toBeNull();
    expect(shiftsProblem(split)).toBeNull();
  });

  it('explains what is wrong', () => {
    expect(shiftsProblem({ s1: [780, 540], s2: null })).toMatch(/first session must end after it starts/);
    expect(shiftsProblem({ s1: [540, 780], s2: [700, 1200] })).toMatch(/second session must start after the first one ends/);
    expect(shiftsProblem({ s1: [540, 780], s2: [1300, 1200] }), 'bad second').toMatch(/second session must end after it starts/);
    expect(shiftsProblem({ s1: [540, 780], s2: [780, 1200] }), 'no gap').toMatch(/second session must start after/);
  });
});

describe('labels', () => {
  it('names the closed stretch and describes the sessions', () => {
    expect(closedGapLabel(split)).toBe('Closed 1:00 PM – 4:00 PM');
    expect(closedGapLabel(single)).toBeNull();
    expect(describeShifts(split)).toBe('9:00 AM – 1:00 PM, 4:00 PM – 8:00 PM');
  });
});

describe('splitSession', () => {
  it('cuts a day in two with a gap in the middle, always a valid pair', () => {
    expect(splitSession([540, 1200])).toEqual({ s1: [540, 810], s2: [930, 1200] }); // 9:00-1:30, 3:30-8:00
    for (const day of [[540, 1020], [480, 1260], [600, 1080]] as [number, number][]) {
      expect(shiftsProblem(splitSession(day))).toBeNull();
    }
  });

  it('leaves a very short day as one session', () => {
    expect(splitSession([540, 560])).toEqual({ s1: [540, 560], s2: null });
  });
});
