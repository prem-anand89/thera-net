import { describe, expect, it } from 'vitest';
import { rankTreatmentsByUsage } from './treatmentUsage';
import type { TreatmentItem } from './types';

const t = (name: string): TreatmentItem => ({
  id: name,
  clinicId: 'c1',
  name,
  active: true,
  updatedAt: '2026-01-01T00:00:00Z',
});

describe('rankTreatmentsByUsage', () => {
  it('returns everything alphabetical in "rest" when below the grouping threshold', () => {
    const items = [t('Ultrasound'), t('TENS'), t('IFC')];
    const result = rankTreatmentsByUsage(items, [{ treatmentId: 'TENS', count: 50 }]);
    expect(result.frequent).toEqual([]);
    expect(result.rest.map((i) => i.name)).toEqual(['IFC', 'TENS', 'Ultrasound']);
  });

  it('returns everything alphabetical in "rest" when there is no usage data yet', () => {
    const items = Array.from({ length: 10 }, (_, i) => t(`Treatment ${i}`));
    const result = rankTreatmentsByUsage(items, []);
    expect(result.frequent).toEqual([]);
    expect(result.rest).toHaveLength(10);
  });

  it('ranks the frequent group by usage count, capped, and keeps the rest alphabetical', () => {
    const items = [
      t('Alpha'), t('Bravo'), t('Charlie'), t('Delta'), t('Echo'),
      t('Foxtrot'), t('Golf'), t('Hotel'), t('India'),
    ];
    const usage = [
      { treatmentId: 'Hotel', count: 30 },
      { treatmentId: 'Alpha', count: 20 },
      { treatmentId: 'Delta', count: 10 },
    ];
    const result = rankTreatmentsByUsage(items, usage, { maxFrequent: 2 });
    expect(result.frequent.map((i) => i.name)).toEqual(['Hotel', 'Alpha']);
    // Delta (used, but past the cap) falls back into the alphabetical rest.
    expect(result.rest.map((i) => i.name)).toEqual([
      'Bravo', 'Charlie', 'Delta', 'Echo', 'Foxtrot', 'Golf', 'India',
    ]);
  });

  it('respects a custom grouping threshold', () => {
    const items = [t('A'), t('B'), t('C'), t('D')];
    const usage = [{ treatmentId: 'B', count: 5 }];
    expect(rankTreatmentsByUsage(items, usage, { minTotalForGrouping: 10 }).frequent).toEqual([]);
    const grouped = rankTreatmentsByUsage(items, usage, { minTotalForGrouping: 4 });
    expect(grouped.frequent.map((i) => i.name)).toEqual(['B']);
  });
});
