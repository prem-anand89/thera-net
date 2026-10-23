import { describe, expect, it } from 'vitest';
import type { VisitCredit, VisitItem } from '@/domain/types';
import { buildVisitDetails, splitDisplay } from './visitDetails';

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
    expect(buildVisitDetails([], [], nameOf, true).size).toBe(0);
  });
});

describe('legacy visits and share rows', () => {
  it('a visit without lines but with share rows gets shares-only details', () => {
    const d = buildVisitDetails([], [credit('p', 60000), credit('s', 40000)], nameOf, true).get('v1')!;
    expect(d.services).toEqual([]);
    expect(d.shares).toEqual([
      { name: 'Dr R', amountPaise: 60000 },
      { name: 'Dr S', amountPaise: 40000 },
    ]);
    expect(d.hasShareRows).toBe(true);
  });
  it('legacy visit edited to 40% shows 40% (share rows), not the old 25%', () => {
    const d = buildVisitDetails([], [credit('p', 60000), credit('s', 40000)], nameOf, true).get('v1');
    const flags = splitDisplay(d, { sharedTherapistId: 's' });
    expect(flags).toEqual({ hasSplit: true, legacySplit: false });
    expect(d!.shares![1].amountPaise).toBe(40000);
  });
  it('a legacy visit with no share rows keeps the old line and the Edit split label', () => {
    expect(splitDisplay(undefined, { sharedTherapistId: 's' })).toEqual({ hasSplit: true, legacySplit: true });
  });
  it('a legacy visit with no split given one now shows the share line and Edit split', () => {
    const d = buildVisitDetails([], [credit('p', 70000), credit('s', 30000)], nameOf, true).get('v1');
    expect(splitDisplay(d, {})).toEqual({ hasSplit: true, legacySplit: false });
    expect(d!.shares).not.toBeNull();
  });
  it('removing the assistant leaves no assistant line and the plain label', () => {
    const d = buildVisitDetails([], [credit('p', 100000)], nameOf, true).get('v1');
    expect(d!.shares).toBeNull();
    expect(splitDisplay(d, { sharedTherapistId: 's' })).toEqual({ hasSplit: false, legacySplit: false });
  });
});
