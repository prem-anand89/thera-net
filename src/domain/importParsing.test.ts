import { describe, expect, it } from 'vitest';
import {
  buildCatalogName,
  canonicalizePatientName,
  groupPackageSessions,
  parseAgeSex,
  parseHistoricalDate,
  parseServiceName,
  type PackageSessionInput,
} from './importParsing';
import { rupeesToPaise as rs } from './money';

describe('parseServiceName', () => {
  it('parses a package fraction with an aliased prefix', () => {
    expect(parseServiceName('Physio 3/7')).toEqual({
      aliasBase: 'Physiotherapy',
      numerator: 3,
      denominator: 7,
    });
  });

  it('parses a single session with no fraction', () => {
    expect(parseServiceName('Manual Therapy')).toEqual({
      aliasBase: 'Manual Therapy',
      numerator: null,
      denominator: null,
    });
  });

  it('normalizes stray whitespace and case', () => {
    expect(parseServiceName(' Exercise Therapy ')).toEqual({
      aliasBase: 'Exercise Therapy',
      numerator: null,
      denominator: null,
    });
    expect(parseServiceName('Exercise therapy')).toEqual({
      aliasBase: 'Exercise Therapy',
      numerator: null,
      denominator: null,
    });
  });

  it('leaves unrecognized text as-is so it fails to match a catalog item', () => {
    // "+ KT" suffix: real sheet text, not a real package product.
    expect(parseServiceName('Exercise Therapy + KT')).toEqual({
      aliasBase: 'Exercise Therapy + KT',
      numerator: null,
      denominator: null,
    });
  });
});

describe('buildCatalogName', () => {
  it('builds a "<family> <M> Days" name for packages', () => {
    expect(buildCatalogName({ aliasBase: 'Physiotherapy', numerator: 3, denominator: 5 })).toBe(
      'Physiotherapy 5 Days'
    );
  });

  it('uses the bare family name for single sessions', () => {
    expect(buildCatalogName({ aliasBase: 'Manual Therapy', numerator: null, denominator: null })).toBe(
      'Manual Therapy'
    );
  });

  it('does not construct a "1 Days" package name for a denominator of 1', () => {
    expect(buildCatalogName({ aliasBase: 'Consultation', numerator: 1, denominator: 1 })).toBe(
      'Consultation'
    );
  });

  it('produces an unmatchable name for the real "Advanced Therapy 2/2" anomaly', () => {
    // No "Advanced Therapy 2 Days" catalog entry exists — this is intentional;
    // the row should surface as an unmatched-service flag, not a new SKU.
    expect(
      buildCatalogName({ aliasBase: 'Advanced Therapy', numerator: 2, denominator: 2 })
    ).toBe('Advanced Therapy 2 Days');
  });
});

describe('parseHistoricalDate', () => {
  it('formats a valid Date as ISO yyyy-mm-dd', () => {
    expect(parseHistoricalDate(new Date(2026, 3, 1))).toBe('2026-04-01');
  });

  it('rejects the corrupted time-only cell (a bare number, not a Date)', () => {
    expect(parseHistoricalDate(0.4)).toBeNull();
  });

  it('rejects null/undefined/invalid dates', () => {
    expect(parseHistoricalDate(null)).toBeNull();
    expect(parseHistoricalDate(undefined)).toBeNull();
    expect(parseHistoricalDate(new Date(NaN))).toBeNull();
  });
});

describe('canonicalizePatientName', () => {
  it('picks the most frequent spelling and flags ambiguity', () => {
    const result = canonicalizePatientName([
      'Sindoora Unnam',
      'Sindoora Unnam',
      'Sindhoora Unnam',
    ]);
    expect(result.canonical).toBe('Sindoora Unnam');
    expect(result.ambiguous).toBe(true);
    expect(result.variants).toHaveLength(2);
  });

  it('is not ambiguous when every visit used the same spelling', () => {
    const result = canonicalizePatientName(['Rohini Bhatia', 'Rohini Bhatia']);
    expect(result.canonical).toBe('Rohini Bhatia');
    expect(result.ambiguous).toBe(false);
  });

  it('breaks ties by preferring the longer (more complete) spelling', () => {
    const result = canonicalizePatientName(['Shaima', 'Shaima Sameera']);
    expect(result.canonical).toBe('Shaima Sameera');
  });
});

describe('parseAgeSex', () => {
  it('parses "44/M"', () => {
    expect(parseAgeSex('44/M')).toEqual({ age: 44, sex: 'M' });
  });

  it('treats an unrecognized sex letter as Other', () => {
    expect(parseAgeSex('30/X')).toEqual({ age: 30, sex: 'Other' });
  });

  it('returns nulls for missing/malformed input', () => {
    expect(parseAgeSex(null)).toEqual({ age: null, sex: null });
    expect(parseAgeSex('not a match')).toEqual({ age: null, sex: null });
  });
});

describe('groupPackageSessions', () => {
  const row = (
    key: string,
    numerator: number,
    sortKey: string,
    billRupees: number,
    packageTotal = 5
  ): PackageSessionInput => ({
    key,
    groupKey: 'krishna-chaitanya::physio5',
    sortKey,
    numerator,
    packageTotal,
    billAmountPaise: rs(billRupees),
  });

  it('restarts numbering into a new group when the same package is bought twice', () => {
    // Real data: Krishna Chaitanya bought two separate 5-day Physio
    // packages; the actual charge landed on session 2 the first time and
    // session 3 the second time (front desk didn't always bill on day 1).
    const rows: PackageSessionInput[] = [
      row('a1', 1, '2026-05-01#01', 0),
      row('a2', 2, '2026-05-02#02', 3500),
      row('a3', 3, '2026-05-03#03', 0),
      row('a4', 4, '2026-05-04#04', 0),
      row('a5', 5, '2026-05-05#05', 0),
      row('b1', 1, '2026-06-01#01', 0),
      row('b2', 2, '2026-06-02#02', 0),
      row('b3', 3, '2026-06-03#03', 3500),
      row('b4', 4, '2026-06-04#04', 0),
      row('b5', 5, '2026-06-05#05', 0),
    ];
    const results = groupPackageSessions(rows);
    expect(results).toHaveLength(10);

    const groupA = results.filter((r) => r.key.startsWith('a'));
    const groupB = results.filter((r) => r.key.startsWith('b'));
    const groupIdsA = new Set(groupA.map((r) => r.packageGroupId));
    const groupIdsB = new Set(groupB.map((r) => r.packageGroupId));
    expect(groupIdsA.size).toBe(1);
    expect(groupIdsB.size).toBe(1);
    expect([...groupIdsA][0]).not.toBe([...groupIdsB][0]); // two distinct packages

    expect(groupA.find((r) => r.key === 'a2')!.isAnchor).toBe(true);
    expect(groupA.filter((r) => r.isAnchor)).toHaveLength(1);
    expect(groupB.find((r) => r.key === 'b3')!.isAnchor).toBe(true);
    expect(groupA.every((r) => r.anomaly === null)).toBe(true);
    expect(groupB.every((r) => r.anomaly === null)).toBe(true);

    // sessionIndex trusts the sheet's own numbering, not position-in-group
    expect(groupA.find((r) => r.key === 'a3')!.sessionIndex).toBe(3);
  });

  it('flags a group with no nonzero-bill row for manual review', () => {
    const rows = [row('x1', 1, '2026-05-01#01', 0), row('x2', 2, '2026-05-02#02', 0)];
    const results = groupPackageSessions(rows);
    expect(results.every((r) => r.anomaly === 'no-anchor')).toBe(true);
    expect(results.every((r) => !r.isAnchor)).toBe(true);
  });

  it('flags a group with more than one nonzero-bill row for manual review', () => {
    const rows = [row('y1', 1, '2026-05-01#01', 3500), row('y2', 2, '2026-05-02#02', 500)];
    const results = groupPackageSessions(rows);
    expect(results.every((r) => r.anomaly === 'multiple-anchors')).toBe(true);
    expect(results.every((r) => !r.isAnchor)).toBe(true);
  });

  it('closes a group once it reaches its package size even without a numbering restart', () => {
    const rows = [
      row('z1', 1, '2026-05-01#01', 2200, 3),
      row('z2', 2, '2026-05-02#02', 0, 3),
      row('z3', 3, '2026-05-03#03', 0, 3),
      // A 4th row for the same key after a full 3-session package closed —
      // must start a new group rather than overflow the old one.
      row('z4', 1, '2026-06-01#01', 2200, 3),
    ];
    const results = groupPackageSessions(rows);
    const first3 = results.filter((r) => ['z1', 'z2', 'z3'].includes(r.key));
    const z4 = results.find((r) => r.key === 'z4')!;
    expect(new Set(first3.map((r) => r.packageGroupId)).size).toBe(1);
    expect(z4.packageGroupId).not.toBe(first3[0].packageGroupId);
  });

  it('groups independently per groupKey', () => {
    const rows: PackageSessionInput[] = [
      { ...row('p1', 1, '2026-05-01#01', 2200, 3), groupKey: 'patient-a::svc-1' },
      { ...row('p2', 1, '2026-05-01#02', 1500, 1), groupKey: 'patient-b::svc-2' },
    ];
    const results = groupPackageSessions(rows);
    expect(results.find((r) => r.key === 'p1')!.packageGroupId).not.toBe(
      results.find((r) => r.key === 'p2')!.packageGroupId
    );
  });
});
