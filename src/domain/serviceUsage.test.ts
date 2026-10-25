import { describe, expect, it } from 'vitest';
import { rankServicesByUsage } from './serviceUsage';
import type { CatalogItem } from './types';

const mockItem = (id: string, name: string, active = true, sessionCount = 1): CatalogItem => ({
  id,
  clinicId: 'c1',
  category: 'Physio',
  name,
  sessionCount,
  basePricePaise: 100000,
  active,
  updatedAt: '',
});

describe('rankServicesByUsage', () => {
  it('ranks active services by usage count descending', () => {
    const items = [
      mockItem('s1', 'Assessment'),
      mockItem('s2', 'Follow-up Consultation'),
      mockItem('s3', 'Dry Needling'),
      mockItem('s4', 'Rehab Session'),
    ];
    const counts = [
      { serviceId: 's3', count: 45 },
      { serviceId: 's1', count: 30 },
      { serviceId: 's2', count: 12 },
      { serviceId: 's4', count: 2 },
    ];

    const result = rankServicesByUsage(items, counts, 3);
    expect(result.map((r) => r.id)).toEqual(['s3', 's1', 's2']);
  });

  it('excludes inactive services even if they have high usage', () => {
    const items = [
      mockItem('s1', 'Assessment', true),
      mockItem('s2', 'Old Discontinued Package', false),
      mockItem('s3', 'Follow-up', true),
    ];
    const counts = [
      { serviceId: 's2', count: 100 },
      { serviceId: 's3', count: 20 },
      { serviceId: 's1', count: 10 },
    ];

    const result = rankServicesByUsage(items, counts, 3);
    expect(result.map((r) => r.id)).toEqual(['s3', 's1']);
  });

  it('falls back to alphabetical name order for ties or zero usage', () => {
    const items = [
      mockItem('s1', 'Zumba Therapy'),
      mockItem('s2', 'Assessment'),
      mockItem('s3', 'Dry Needling'),
    ];

    const result = rankServicesByUsage(items, [], 2);
    expect(result.map((r) => r.name)).toEqual(['Assessment', 'Dry Needling']);
  });

  it('includes package services with sessionCount > 1', () => {
    const items = [
      mockItem('s1', 'Assessment', true, 1),
      mockItem('s2', '10-Session Rehab Package', true, 10),
    ];
    const counts = [
      { serviceId: 's2', count: 50 },
      { serviceId: 's1', count: 20 },
    ];

    const result = rankServicesByUsage(items, counts, 2);
    expect(result[0].id).toBe('s2');
    expect(result[0].sessionCount).toBe(10);
  });
});
