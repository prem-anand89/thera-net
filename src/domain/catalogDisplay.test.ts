import { describe, expect, it } from 'vitest';
import { groupServices, orderedServices, perSessionLabel, serviceSubline, usageLabel } from './catalogDisplay';

const s = (name: string, category = '', sessionCount = 1, basePricePaise = 100000, durationMinutes: number | null = null) => ({
  name, category, sessionCount, basePricePaise, durationMinutes,
});

describe('per-session price and the line under a service', () => {
  it('rounds the per-session price to whole rupees, with no qualifier', () => {
    expect(perSessionLabel({ basePricePaise: 500000, sessionCount: 3 })).toBe('₹1,667 each');
    expect(perSessionLabel({ basePricePaise: 1000000, sessionCount: 10 })).toBe('₹1,000 each');
  });

  it('leaves out parts that do not apply', () => {
    expect(serviceSubline(s('Session'))).toBe('');
    expect(serviceSubline(s('Assessment', '', 1, 100000, 45))).toBe('45 min');
    expect(serviceSubline(s('Pkg', '', 3, 500000))).toBe('3 sessions · ₹1,667 each');
    expect(serviceSubline(s('Pkg', '', 10, 1000000, 45))).toBe('10 sessions · ₹1,000 each · 45 min');
  });

  it('adds usage only when it is given', () => {
    expect(serviceSubline(s('Session'), 412)).toBe('412 visits');
    expect(serviceSubline(s('Pkg', '', 3, 500000), 1)).toBe('3 sessions · ₹1,667 each · 1 visit');
    expect(serviceSubline(s('New'), 0)).toBe('not used yet');
    expect(usageLabel(0)).toBe('Not used yet');
  });
});

describe('groupServices — one ordering rule for Settings and the visit picker', () => {
  it('no named groups: one flat list, alphabetical, no headings', () => {
    const g = groupServices([s('Taping'), s('Assessment')]);
    expect(g).toEqual({ kind: 'flat', items: [s('Assessment'), s('Taping')] });
    expect(orderedServices([s('Taping'), s('Assessment')]).map((r) => r.heading)).toEqual(['', '']);
  });

  it('mixed: named groups first (alphabetical), ungrouped last under "Other"', () => {
    const rows = orderedServices([s('Home visit'), s('Session', 'Physiotherapy'), s('Follow-up', 'Consultation'), s('Initial', 'Consultation')]);
    expect(rows.map((r) => `${r.heading}: ${r.item.name}`)).toEqual([
      'Consultation: Follow-up',
      'Consultation: Initial',
      'Physiotherapy: Session',
      'Other: Home visit',
    ]);
  });

  it('only named groups: no "Other" at all; spaces around a group name are ignored', () => {
    const g = groupServices([s('A', ' Consultation '), s('B', 'Consultation')]);
    expect(g).toEqual({ kind: 'grouped', groups: [['Consultation', [s('A', ' Consultation '), s('B', 'Consultation')]]], other: [] });
  });
});
