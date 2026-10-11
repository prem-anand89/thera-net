import { describe, expect, it } from 'vitest';
import { columnLeaders, type RankableRow } from './therapistRanking';

const row = (name: string, over: Partial<RankableRow> = {}): RankableRow => ({
  therapistName: name,
  netPostTaxPaise: 1000,
  visitCount: 30,
  retentionPct: 50,
  utilisation: 0.6,
  ...over,
});
const all = ['net', 'visits', 'retention', 'utilisation'] as const;

describe('columnLeaders', () => {
  it('picks the best value in each column independently', () => {
    const l = columnLeaders(
      [row('A', { netPostTaxPaise: 5000, retentionPct: 40 }), row('B', { visitCount: 60, retentionPct: 70 })],
      [...all]
    );
    expect([...l.net]).toEqual(['A']);
    expect([...l.visits]).toEqual(['B']);
    expect([...l.retention]).toEqual(['B']);
  });

  it('leaves out therapists below the visit minimum', () => {
    const l = columnLeaders(
      [row('Few', { visitCount: 5, retentionPct: 100 }), row('A', { retentionPct: 50 }), row('B', { retentionPct: 40 })],
      ['retention']
    );
    expect([...l.retention]).toEqual(['A']);
  });

  it('needs two eligible therapists before anyone leads', () => {
    const l = columnLeaders([row('A'), row('Few', { visitCount: 3 })], [...all]);
    expect(l.net.size).toBe(0);
  });

  it('lets ties share the lead and ignores missing values', () => {
    const l = columnLeaders(
      [row('A', { utilisation: 0.8 }), row('B', { utilisation: 0.8 }), row('C', { utilisation: null })],
      ['utilisation']
    );
    expect([...l.utilisation].sort()).toEqual(['A', 'B']);
  });

  it('gives nobody the lead when the best value is zero', () => {
    const l = columnLeaders([row('A', { retentionPct: 0 }), row('B', { retentionPct: 0 })], ['retention']);
    expect(l.retention.size).toBe(0);
  });
});
