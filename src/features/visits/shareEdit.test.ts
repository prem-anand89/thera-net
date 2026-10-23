import { describe, expect, it } from 'vitest';
import type { Visit, VisitCredit, VisitItem } from '@/domain/types';
import {
  addShareRow,
  applyShareEdit,
  initialShares,
  removeShareRow,
  sharesAreOutdated,
  sharesTotalMismatch,
  BILL_BELOW_SHARES,
  lastEditedBy,
} from './shareEdit';
import { SHARE_BELOW_PACKAGE, SHARE_TOO_LARGE } from '@/domain/visitLines';

const visit = (over: Partial<Visit> = {}): Visit =>
  ({
    id: 'v1',
    clinicId: 'c1',
    therapistId: 'p',
    actualBillPaise: 130000,
    creditsMode: 'auto',
    ...over,
  }) as Visit;
const line = (id: string, price: number, over: Partial<VisitItem> = {}): VisitItem => ({
  id,
  clinicId: 'c1',
  visitId: 'v1',
  position: Number(id.replace(/\D/g, '')) || 0,
  serviceCatalogId: id,
  serviceName: id,
  catalogPricePaise: price,
  pricePaise: price,
  assistingTherapistId: null,
  durationMinutes: null,
  isPackageLine: false,
  deleted: false,
  updatedAt: '',
  ...over,
});
const credit = (therapistId: string, amountPaise: number, over: Partial<VisitCredit> = {}): VisitCredit => ({
  id: `cr-${therapistId}`,
  clinicId: 'c1',
  visitId: 'v1',
  therapistId,
  amountPaise,
  deleted: false,
  updatedAt: '2026-10-22T10:00:00Z',
  ...over,
});

const ctx = { primaryId: 'p', billPaise: 130000, locked: null };

describe('applyShareEdit', () => {
  const rows = [
    { therapistId: 'p', amountPaise: 130000 },
    { therapistId: 's', amountPaise: 0 },
  ];
  it('editing % updates ₹ and the remainder', () => {
    const out = applyShareEdit(rows, { therapistId: 's', pct: '40' }, ctx);
    expect(out.error).toBeNull();
    expect(out.rows).toEqual([
      { therapistId: 'p', amountPaise: 78000 },
      { therapistId: 's', amountPaise: 52000 },
    ]);
  });
  it('editing ₹ updates the remainder', () => {
    const out = applyShareEdit(rows, { therapistId: 's', rupees: '433' }, ctx);
    expect(out.rows.find((r) => r.therapistId === 'p')!.amountPaise).toBe(86700);
  });
  it('refuses more than bill less package money', () => {
    const locked = { therapistId: 'p', amountPaise: 50000 };
    const out = applyShareEdit(rows, { therapistId: 's', rupees: '900' }, { ...ctx, locked });
    expect(out.error).toBe(SHARE_TOO_LARGE);
    expect(out.rows).toEqual(rows);
  });
  it('keeps the last valid rows and reports an error for a share below the package money it holds', () => {
    const locked = { therapistId: 's', amountPaise: 20000 };
    const out = applyShareEdit(rows, { therapistId: 's', rupees: '100' }, { ...ctx, locked });
    expect(out.error).toBe(SHARE_BELOW_PACKAGE);
  });
  it('an empty field is an error, not a crash', () => {
    expect(applyShareEdit(rows, { therapistId: 's', rupees: '' }, ctx).error).not.toBeNull();
  });
});

describe('add / remove rows', () => {
  it('adds a therapist at ₹0 and removes one back into the primary', () => {
    const added = addShareRow([{ therapistId: 'p', amountPaise: 130000 }], 's', ctx);
    expect(added).toEqual([
      { therapistId: 'p', amountPaise: 130000 },
      { therapistId: 's', amountPaise: 0 },
    ]);
    const withShare = [
      { therapistId: 'p', amountPaise: 80000 },
      { therapistId: 's', amountPaise: 50000 },
    ];
    expect(removeShareRow(withShare, 's', ctx)).toEqual([{ therapistId: 'p', amountPaise: 130000 }]);
  });
  it('remove returns the amount to a primary row, creating it when missing', () => {
    expect(removeShareRow([{ therapistId: 's', amountPaise: 50000 }], 's', ctx)).toEqual([{ therapistId: 'p', amountPaise: 50000 }]);
  });
  it('will not remove the primary or the package holder', () => {
    const rows = [
      { therapistId: 'p', amountPaise: 80000 },
      { therapistId: 's', amountPaise: 50000 },
    ];
    expect(removeShareRow(rows, 'p', ctx)).toEqual(rows);
    expect(removeShareRow(rows, 's', { ...ctx, locked: { therapistId: 's', amountPaise: 50000 } })).toEqual(rows);
  });
});

describe('sharesAreOutdated', () => {
  const stamp = (iso: string) => ({ updatedAt: iso });
  const lines = [line('a1', 100000, stamp('2026-10-22T10:00:00Z')), line('b2', 30000, { assistingTherapistId: 's', updatedAt: '2026-10-22T10:00:00Z' })];
  const manual = visit({ creditsMode: 'manual' });
  const rows = (at: string) => [credit('p', 100000, { updatedAt: at }), credit('s', 30000, { id: 'x', updatedAt: at })];
  it('is false in auto mode', () => {
    expect(sharesAreOutdated(visit(), lines, rows('2026-10-21T00:00:00Z'))).toBe(false);
  });
  it('a hand edit alone gives no banner', () => {
    expect(sharesAreOutdated(manual, lines, rows('2026-10-23T00:00:00Z'))).toBe(false);
  });
  it('a line edited after the last share edit gives the banner', () => {
    expect(sharesAreOutdated(manual, lines, rows('2026-10-21T00:00:00Z'))).toBe(true);
  });
  it('a changed bill (rows no longer add up) gives the banner', () => {
    expect(sharesAreOutdated(manual, lines, [credit('p', 80000, { updatedAt: '2026-10-23T00:00:00Z' })])).toBe(true);
  });
  it('a legacy visit without lines never does', () => {
    expect(sharesAreOutdated(manual, [], [credit('p', 80000)])).toBe(false);
    expect(sharesAreOutdated(manual, [line('d', 1, { deleted: true })], [credit('p', 80000)])).toBe(false);
  });
});

describe('initialShares / lastEditedBy', () => {
  it('the primary absorbs a bill changed after a hand edit (and gets a row if missing)', () => {
    const v = visit({ actualBillPaise: 100000 });
    expect(initialShares(v, [credit('p', 80000), credit('s', 50000, { id: 'y' })])).toEqual([
      { therapistId: 'p', amountPaise: 50000 },
      { therapistId: 's', amountPaise: 50000 },
    ]);
    expect(initialShares(v, [credit('s', 30000, { id: 'y' })])).toEqual([
      { therapistId: 'p', amountPaise: 70000 },
      { therapistId: 's', amountPaise: 30000 },
    ]);
  });
  it('shows stored rows unchanged when the primary would fall below its floor', () => {
    const v = visit({ actualBillPaise: 40000 });
    const stored = [credit('p', 80000), credit('s', 50000, { id: 'y' })];
    const rows = initialShares(v, stored);
    expect(rows).toEqual([
      { therapistId: 'p', amountPaise: 80000 },
      { therapistId: 's', amountPaise: 50000 },
    ]);
    expect(sharesTotalMismatch(rows, 40000)).toBe(true);
    expect(BILL_BELOW_SHARES).toMatch(/lower than the shares/);
    // package money held by the primary is a floor too
    expect(
      initialShares(visit({ actualBillPaise: 100000 }), [credit('p', 70000), credit('s', 60000, { id: 'y' })], { therapistId: 'p', amountPaise: 50000 })
    ).toHaveLength(2);
    expect(sharesTotalMismatch(
      initialShares(visit({ actualBillPaise: 100000 }), [credit('p', 70000), credit('s', 60000, { id: 'y' })], { therapistId: 'p', amountPaise: 50000 }), 100000)).toBe(true);
  });

  it('uses live credit rows, else the old one-assistant split, else all to the primary', () => {
    expect(initialShares(visit(), [credit('p', 80000), credit('s', 50000, { id: 'y' })])).toEqual([
      { therapistId: 'p', amountPaise: 80000 },
      { therapistId: 's', amountPaise: 50000 },
    ]);
    expect(initialShares(visit({ sharedTherapistId: 's', sharedPct: 25 }), [])).toEqual([
      { therapistId: 'p', amountPaise: 97500 },
      { therapistId: 's', amountPaise: 32500 },
    ]);
    expect(initialShares(visit(), [])).toEqual([{ therapistId: 'p', amountPaise: 130000 }]);
  });
  it('names the latest editor, or just the time when the name is unknown', () => {
    const rows = [
      credit('p', 1, { updatedBy: 'u1', updatedAt: '2026-10-22T10:00:00Z' }),
      credit('s', 1, { id: 'z', updatedBy: 'u2', updatedAt: '2026-10-23T10:00:00Z' }),
    ];
    expect(lastEditedBy(rows, [{ userId: 'u2', name: 'Dr Sneha' }])).toEqual({ name: 'Dr Sneha', at: '2026-10-23T10:00:00Z' });
    expect(lastEditedBy(rows, [])).toEqual({ name: null, at: '2026-10-23T10:00:00Z' });
    expect(lastEditedBy([], [])).toBeNull();
  });
});
