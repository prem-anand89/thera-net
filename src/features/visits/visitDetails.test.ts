import { describe, expect, it } from 'vitest';
import type { VisitCredit, VisitItem } from '@/domain/types';
import { buildVisitDetails } from './visitDetails';

const line = (id: string, name: string, pos: number, assist: string | null, deleted = false) =>
  ({ id, visitId: 'v1', serviceName: name, position: pos, assistingTherapistId: assist, deleted }) as VisitItem;
const credit = (t: string, amountPaise: number) =>
  ({ id: t, visitId: 'v1', therapistId: t, amountPaise, deleted: false }) as VisitCredit;
const names: Record<string, string> = { p: 'Dr R', s: 'Dr S' };
const nameOf = (id: string) => names[id] ?? '?';

describe('buildVisitDetails', () => {
  it('lists live services in order with assistants, and the shares when shared', () => {
    const d = buildVisitDetails(
      [line('b', 'Dry needling', 1, 's'), line('a', 'Assessment', 0, null), line('c', 'Gone', 2, null, true)],
      [credit('p', 86700), credit('s', 43300)],
      nameOf,
      true
    ).get('v1')!;
    expect(d.services).toEqual([
      { name: 'Assessment', assistantName: null },
      { name: 'Dry needling', assistantName: 'Dr S' },
    ]);
    expect(d.shares).toEqual([
      { name: 'Dr R', amountPaise: 86700 },
      { name: 'Dr S', amountPaise: 43300 },
    ]);
  });
  it('shows no shares for a single row or when split is off, and nothing for a visit without lines', () => {
    expect(buildVisitDetails([line('a', 'A', 0, null)], [credit('p', 100)], nameOf, true).get('v1')!.shares).toBeNull();
    expect(
      buildVisitDetails([line('a', 'A', 0, 's')], [credit('p', 50), credit('s', 50)], nameOf, false).get('v1')!.shares
    ).toBeNull();
    expect(buildVisitDetails([], [credit('p', 100)], nameOf, true).size).toBe(0);
  });
});
