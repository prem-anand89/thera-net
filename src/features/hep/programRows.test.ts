import { describe, expect, it } from 'vitest';
import type { Program, ProgramItem, ProgramLog, SessionsPerDay } from '@/domain/hep';
import type { ProgramBundle, SessionFeedback } from '@/services/hepService';
import { buildProgramRow, countAttentionPrograms, countBuckets, filterRows, hasClinicPainAlert, lastActiveLabel, matchesProgramSearch, sortRows } from './programRows';

const TODAY = '2026-11-13';
const item = (id: string, over: Partial<ProgramItem> = {}): ProgramItem => ({
  id, programId: 'p1', title: `Item ${id}`, bodyRegion: 'Knee', phase: 'strengthening', equipment: [], instructions: '', mediaType: 'none', mediaKeys: [], mediaCaptions: [], doseType: 'reps', sets: 3, reps: 10,
  holdSeconds: null, durationSeconds: null, restSeconds: 30, side: 'none', sessionsPerDay: 1, optional: false, sessionsSchedule: [], stopIf: '', specialInstructions: '', sortOrder: 0, addedOn: '2026-11-09', removedOn: null, ...over,
});
const program = (over: Partial<Program> = {}): Program => ({
  id: 'p1', clinicId: 'c1', patientId: 'pt1', therapistId: 't1', title: 'Knee week 1', status: 'active', startDate: '2026-11-09', durationDays: 7, targetPct: 70, checkinOn: null,
  feedbackDefault: 'pain', sessionsPerDay: 1, firstOpenedAt: null, painReviewedThrough: null, items: [item('a'), item('b')], createdAt: '', updatedAt: '', ...over,
});
const log = (itemId: string, logDate: string, over: Partial<ProgramLog> = {}): ProgramLog => ({ id: `${itemId}${logDate}`, programItemId: itemId, logDate, sessionIndex: 1 as SessionsPerDay, skipped: false, completedAt: `${logDate}T08:00:00Z`, ...over });
const fb = (over: Partial<SessionFeedback> = {}): SessionFeedback => ({ id: 'f1', programId: 'p1', logDate: TODAY, sessionIndex: 1, painScore: 8, effortScore: null, painItemIds: ['a'], hardItemIds: [], createdAt: '2026-11-13T09:00:00Z', ...over });
const bundle = (over: Partial<ProgramBundle> = {}, p: Partial<Program> = {}): ProgramBundle => ({
  program: program(p), patientName: 'Ravi Kumar', therapistName: 'Meera Rao', logs: [], sessionFeedback: [], access: { token: 't', linkRevoked: false, openCount: 2, lastOpenedAt: null }, patientPhone: null, ...over,
});
const row = (b: ProgramBundle, today = TODAY) => buildProgramRow(b, { today, windowStart: '2026-10-31' });
const doneEveryDay = (days: string[]) => days.flatMap((d) => [log('a', d), log('b', d)]);

describe('buildProgramRow', () => {
  it('describes a running program: day, exercises, today, habit over finished days, last active', () => {
    const r = row(bundle({ logs: doneEveryDay(['2026-11-09', '2026-11-10', '2026-11-11', '2026-11-12', '2026-11-13']) }));
    expect(r).toMatchObject({ patientName: 'Ravi Kumar', dayLabel: 'Day 5 of 7', exerciseCount: 2, todayCompleted: 2, todayTarget: 2, habitPercent: 100, finishedDays: 4, lastActiveLabel: 'Today', bucket: 'active', startedLabel: 'Started 09/11' });
    expect(r.signals).toEqual([]);
    expect(r.needsAttention).toBe(false);
  });

  it('says "Too early" (no percent) on the first day', () => {
    const r = row(bundle({}, { startDate: TODAY }));
    expect(r.habitPercent).toBeNull();
    expect(r.dayLabel).toBe('Day 1 of 7');
  });

  it('pain of 7 or more that nobody has reviewed is red, names the exercise and needs attention; reviewed pain does not', () => {
    const unseen = row(bundle({ sessionFeedback: [fb()] }));
    expect(unseen.signals[0]).toMatchObject({ key: 'pain', label: 'Pain 8/10 after Item a', tone: 'red', attention: true });
    expect(unseen.needsAttention).toBe(true);
    const seen = row(bundle({ sessionFeedback: [fb()] }, { painReviewedThrough: '2026-11-13T10:00:00Z' }));
    expect(seen.signals.find((s) => s.key === 'pain')).toBeUndefined();
    const newer = row(bundle({ sessionFeedback: [fb({ createdAt: '2026-11-13T11:00:00Z' })] }, { painReviewedThrough: '2026-11-13T10:00:00Z' }));
    expect(newer.signals.find((s) => s.key === 'pain')).toBeDefined();
    expect(row(bundle({ logs: doneEveryDay([TODAY]), sessionFeedback: [fb({ painScore: 6 })] })).signals).toEqual([]);
  });

  it('shows the worst unreviewed pain score', () => {
    const r = row(bundle({ sessionFeedback: [fb({ painScore: 7, id: 'x' }), fb({ painScore: 9, id: 'y', painItemIds: [] })] }));
    expect(r.signals[0].label).toBe('Pain 9/10');
  });

  it('no activity for 2 or more days is amber and needs attention; yesterday is fine', () => {
    expect(row(bundle({ logs: [log('a', '2026-11-11')] })).signals).toContainEqual({ key: 'idle', label: 'No activity 2 days', tone: 'amber', attention: true });
    expect(row(bundle({ logs: [log('a', '2026-11-12')] })).signals.find((s) => s.key === 'idle')).toBeUndefined();
  });

  it('opened but nothing ticked is grey and NOT needs attention; never opened after 2 days is "Link not opened yet"', () => {
    const opened = row(bundle({ access: { token: 't', linkRevoked: false, openCount: 6, lastOpenedAt: null } }));
    expect(opened.signals).toEqual([{ key: 'opened', label: 'Opened 6×, nothing ticked', tone: 'grey', attention: false }]);
    expect(opened.needsAttention).toBe(false);
    const never = row(bundle({ access: { token: 't', linkRevoked: false, openCount: 0, lastOpenedAt: null } }));
    expect(never.signals).toEqual([{ key: 'link', label: 'Link not opened yet', tone: 'amber', attention: true }]);
    expect(row(bundle({ access: { token: 't', linkRevoked: false, openCount: 0, lastOpenedAt: null } }, { startDate: '2026-11-12' })).signals).toEqual([]);
  });

  it('a check-in that has come due is blue and needs attention', () => {
    const r = row(bundle({ logs: doneEveryDay([TODAY]) }, { checkinOn: '2026-11-13' }));
    expect(r.signals).toContainEqual({ key: 'check' + 'in', label: 'Check-in due', tone: 'blue', attention: true });
    expect(row(bundle({ logs: doneEveryDay([TODAY]) }, { checkinOn: '2026-11-14' })).signals).toEqual([]);
  });

  it('an ended program waits for a decision: Met % when the target was reached, Not met with the usual reason when not', () => {
    const met = row(bundle({ logs: doneEveryDay(['2026-11-09', '2026-11-10', '2026-11-11', '2026-11-12', '2026-11-13', '2026-11-14', '2026-11-15']) }), '2026-11-17');
    expect(met).toMatchObject({ ended: true, bucket: 'ended', dayLabel: 'Ended', needsAttention: true });
    expect(met.signals.find((s) => s.key === 'ended')).toMatchObject({ label: 'Met 100%', tone: 'green' });
    const skipped = [log('a', '2026-11-09', { skipped: true, skipReason: 'pain' }), log('a', '2026-11-10', { skipped: true, skipReason: 'pain' }), log('b', '2026-11-10', { skipped: true, skipReason: 'forgot' })];
    const notMet = row(bundle({ logs: skipped }), '2026-11-17');
    expect(notMet.signals.find((s) => s.key === 'ended')).toMatchObject({ label: 'Not met: Pain', tone: 'amber' });
  });

  it('completed programs are Past and never need attention; a paused one is Active with a grey Paused', () => {
    const past = row(bundle({ sessionFeedback: [fb()] }, { status: 'completed' }));
    expect(past).toMatchObject({ bucket: 'past', needsAttention: false, dayLabel: 'Completed' });
    const paused = row(bundle({}, { status: 'paused' }));
    expect(paused.bucket).toBe('active');
    expect(paused.signals).toEqual([{ key: 'paused', label: 'Paused', tone: 'grey', attention: false }]);
    expect(paused.needsAttention).toBe(false);
  });

  it('an ongoing program (no length) never ends and reads "Day N"', () => {
    const r = row(bundle({ logs: doneEveryDay([TODAY]) }, { durationDays: null, startDate: '2026-10-20' }));
    expect(r).toMatchObject({ ended: false, dayLabel: 'Day 25', bucket: 'active' });
  });

  it('a removed exercise is not counted', () => {
    expect(row(bundle({}, { items: [item('a'), item('b', { removedOn: '2026-11-11' })] })).exerciseCount).toBe(1);
  });

  it('shows "Skipping Strengthening: 4 of last 5 days" without making it needs attention', () => {
    const items = [item('a', { phase: 'warm_up' }), item('b', { phase: 'strengthening' })];
    const days = ['2026-11-08', '2026-11-09', '2026-11-10', '2026-11-11', '2026-11-12'];
    const logs = days.map((d) => log('a', d));
    const r = buildProgramRow(bundle({ logs }, { items, startDate: '2026-11-08', durationDays: 14 }), { today: TODAY, windowStart: '2026-10-31' });
    expect(r.signals).toContainEqual({ key: 'skip', label: 'Skipping Strengthening: 4 of last 5 days', tone: 'amber', attention: false });
    expect(r.needsAttention).toBe(false);
  });
});

describe('list helpers', () => {
  const rows = [
    row(bundle({ sessionFeedback: [fb()] })),
    row(bundle({ logs: [log('a', '2026-11-10')] }, { id: 'p2', title: 'Shoulder' })),
    row(bundle({ logs: doneEveryDay([TODAY]) }, { id: 'p3', title: 'Back' })),
    row(bundle({}, { id: 'p4', status: 'completed', title: 'Old' })),
  ];
  it('counts and filters: Needs attention, Active, Ended, Past', () => {
    expect(countBuckets(rows)).toMatchObject({ attention: 2, active: 3, ended: 0, past: 1 });
    expect(filterRows(rows, 'attention').map((r) => r.title)).toEqual(['Knee week 1', 'Shoulder']);
    expect(filterRows(rows, 'past').map((r) => r.title)).toEqual(['Old']);
  });
  it('sorts the most urgent first: pain before idle', () => {
    expect(sortRows(rows).map((r) => r.title).slice(0, 2)).toEqual(['Knee week 1', 'Shoulder']);
  });
  it('searches patient or program', () => {
    expect(matchesProgramSearch(rows[1], 'ravi')).toBe(true);
    expect(matchesProgramSearch(rows[1], 'shoulder')).toBe(true);
    expect(matchesProgramSearch(rows[1], 'nobody')).toBe(false);
  });
  it('words the last-active date', () => {
    expect(lastActiveLabel(null, TODAY)).toBe('—');
    expect(lastActiveLabel('2026-11-12', TODAY)).toBe('Yesterday');
    expect(lastActiveLabel('2026-11-09', TODAY)).toBe('4 days ago');
  });
});

describe('ending this week, strip and phone', () => {
  it('an active program whose last day is today..today+6 is Ending (and still Active); later, paused or ended is not', () => {
    const ending = row(bundle()); // last day 2026-11-15
    expect(ending.ending).toBe(true);
    expect(ending.bucket).toBe('active');
    expect(row(bundle({}, { durationDays: 14 })).ending).toBe(false);
    expect(row(bundle({}, { startDate: '2026-11-07', durationDays: 7 })).ending).toBe(true); // last day is today
    expect(row(bundle({}, { startDate: '2026-11-13', durationDays: 7 })).ending).toBe(true); // today + 6
    expect(row(bundle({}, { startDate: '2026-11-13', durationDays: 8 })).ending).toBe(false);
    expect(row(bundle({}, { status: 'paused' })).ending).toBe(false);
    expect(row(bundle({}, { startDate: '2026-11-01', durationDays: 7 })).ending).toBe(false);
    expect(row(bundle({}, { durationDays: null })).ending).toBe(false);
  });

  it('countBuckets and filterRows know "ending"', () => {
    const rows = [row(bundle()), row(bundle({}, { durationDays: 30 }))];
    expect(countBuckets(rows)).toMatchObject({ active: 2, ending: 1 });
    expect(filterRows(rows, 'ending')).toHaveLength(1);
  });

  it('carries 14 day cells and the patient phone', () => {
    const r = row(bundle({ patientPhone: '+91 98765 43210' }));
    expect(r.days).toHaveLength(14);
    expect(r.days.at(-1)?.date).toBe(TODAY);
    expect(r.patientPhone).toBe('+91 98765 43210');
  });

  it('countAttentionPrograms counts attention bundles via buildProgramRow + countBuckets', () => {
    const bundles = [
      bundle({ sessionFeedback: [fb()] }),
      bundle({ logs: [log('a', '2026-11-10')] }, { id: 'p2' }),
      bundle({ logs: doneEveryDay([TODAY]) }, { id: 'p3' }),
      bundle({}, { id: 'p4', status: 'completed' }),
    ];
    expect(countAttentionPrograms(bundles, { today: TODAY, windowStart: '2026-10-31' })).toBe(2);
    expect(countAttentionPrograms([bundle({ logs: doneEveryDay([TODAY]) })], { today: TODAY, windowStart: '2026-10-31' })).toBe(0);
  });

  it('hasClinicPainAlert detects unreviewed high pain on non-completed programs only', () => {
    expect(hasClinicPainAlert([{ status: 'active', painReviewedThrough: null, feedback: [{ painScore: 7, createdAt: '2026-11-13T09:00:00Z' }] }])).toBe(true);
    expect(hasClinicPainAlert([{ status: 'active', painReviewedThrough: '2026-11-13T10:00:00Z', feedback: [{ painScore: 9, createdAt: '2026-11-13T09:00:00Z' }] }])).toBe(false);
    expect(hasClinicPainAlert([{ status: 'active', painReviewedThrough: '2026-11-13T10:00:00Z', feedback: [{ painScore: 8, createdAt: '2026-11-13T11:00:00Z' }] }])).toBe(true);
    expect(hasClinicPainAlert([{ status: 'completed', painReviewedThrough: null, feedback: [{ painScore: 10, createdAt: '2026-11-13T09:00:00Z' }] }])).toBe(false);
    expect(hasClinicPainAlert([{ status: 'active', painReviewedThrough: null, feedback: [{ painScore: 6, createdAt: '2026-11-13T09:00:00Z' }] }])).toBe(false);
  });
});
