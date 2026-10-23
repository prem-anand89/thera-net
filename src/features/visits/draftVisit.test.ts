import { describe, expect, it } from 'vitest';
import { adjustmentSurvives, canChangePatient, draftLinesToVisitLines, initialRowsForPatient, PACKAGE_NOT_OPEN, rowsForNewPatient } from './draftVisit';
import type { DraftLine, OpenPackage } from './ServiceRows';

const pkg = (logged: number): OpenPackage => ({
  packageGroupId: 'g1',
  serviceCatalogId: 'rehab',
  serviceName: 'Rehab',
  logged,
  packageTotal: 10,
  startedOn: '2026-09-01',
});
const plain = (id: string, assist: string | null = null): DraftLine => ({ key: id, serviceCatalogId: id, assistingTherapistId: assist });
const pkgRow = (p: OpenPackage): DraftLine => ({ key: 'p', continuation: p, assistingTherapistId: null });

describe('draftLinesToVisitLines', () => {
  it('uses the fresh session number, not the row snapshot', () => {
    const out = draftLinesToVisitLines([pkgRow(pkg(4)), plain('a', 't2')], [pkg(5)]);
    expect('lines' in out && out.lines).toEqual([
      { serviceCatalogId: 'rehab', assistingTherapistId: null, packageContinuation: { packageGroupId: 'g1', sessionIndex: 6, packageTotal: 10 } },
      { serviceCatalogId: 'a', assistingTherapistId: 't2' },
    ]);
  });
  it('blocks a package that is no longer open, on its row', () => {
    const out = draftLinesToVisitLines([plain('a'), pkgRow(pkg(4))], []);
    expect('errors' in out && out.errors.get(1)).toBe(PACKAGE_NOT_OPEN);
  });
  it('flags an empty row', () => {
    const out = draftLinesToVisitLines([{ key: 'x', assistingTherapistId: null }], []);
    expect('errors' in out && out.errors.get(0)).toBe('Pick a service.');
  });
});

describe('adjustmentSurvives', () => {
  it('keeps a discount that still fits', () => expect(adjustmentSurvives(50000, 'discount', 'amount', '200')).toBe(true));
  it('drops a rupee discount larger than the subtotal', () => expect(adjustmentSurvives(50000, 'discount', 'amount', '600')).toBe(false));
  it('keeps a percent discount and an extra', () => {
    expect(adjustmentSurvives(50000, 'discount', 'percent', '50')).toBe(true);
    expect(adjustmentSurvives(50000, 'extra', 'amount', '900')).toBe(true);
  });
  it('drops any adjustment at a zero subtotal', () => expect(adjustmentSurvives(0, 'extra', 'amount', '10')).toBe(false));
});

describe('initialRowsForPatient', () => {
  it('continues the only open package', () => {
    const rows = initialRowsForPatient([pkg(4)]);
    expect(rows).toHaveLength(1);
    expect(rows[0].continuation?.packageGroupId).toBe('g1');
  });
  it('starts empty with none or several', () => {
    for (const list of [[], [pkg(1), { ...pkg(2), packageGroupId: 'g2' }]]) {
      const rows = initialRowsForPatient(list);
      expect(rows).toHaveLength(1);
      expect(rows[0].continuation).toBeUndefined();
      expect(rows[0].serviceCatalogId).toBeUndefined();
    }
  });
});

describe('rowsForNewPatient', () => {
  it('first pick keeps chosen services and adds the continuation in front', () => {
    const rows = rowsForNewPatient([plain('a'), { key: 'e', assistingTherapistId: null }], [pkg(4)], null);
    expect(rows.map((r) => r.continuation?.packageGroupId ?? r.serviceCatalogId)).toEqual(['g1', 'a']);
  });
  it('first pick with no open package keeps services, or one empty row when none', () => {
    expect(rowsForNewPatient([plain('a')], [], null).map((r) => r.serviceCatalogId)).toEqual(['a']);
    const empty = rowsForNewPatient([{ key: 'e', assistingTherapistId: null }], [], null);
    expect(empty).toHaveLength(1);
    expect(empty[0].serviceCatalogId).toBeUndefined();
  });
  it('several open packages add nothing', () => {
    const rows = rowsForNewPatient([plain('a')], [pkg(1), { ...pkg(2), packageGroupId: 'g2' }], null);
    expect(rows.map((r) => r.serviceCatalogId)).toEqual(['a']);
  });
  it('a pick after a different patient starts over', () => {
    const rows = rowsForNewPatient([plain('a'), pkgRow(pkg(4))], [], 'patient-a');
    expect(rows).toHaveLength(1);
    expect(rows[0].serviceCatalogId).toBeUndefined();
    expect(rows[0].continuation).toBeUndefined();
  });
  it('never duplicates a package row and never carries a continuation over', () => {
    const rows = rowsForNewPatient([pkgRow(pkg(4)), plain('a')], [pkg(4)], null);
    expect(rows.filter((r) => r.continuation)).toHaveLength(1);
    expect(rows.map((r) => r.continuation?.packageGroupId ?? r.serviceCatalogId)).toEqual(['g1', 'a']);
  });
  it('a hand-chosen package purchase is not joined by the auto continuation', () => {
    const rows = rowsForNewPatient([plain('bigpack'), plain('a')], [pkg(4)], null, (r) => r.serviceCatalogId === 'bigpack');
    expect(rows.map((r) => r.serviceCatalogId)).toEqual(['bigpack', 'a']);
    expect(rows.some((r) => r.continuation)).toBe(false);
  });
});

describe('canChangePatient', () => {
  it('is offered when the patient was picked on the page', () => {
    expect(canChangePatient({})).toBe(true);
  });
  it('is hidden for a linked patient and for the repeat-visit flow', () => {
    expect(canChangePatient({ patientId: 'p1' })).toBe(false);
    expect(canChangePatient({ repeatVisitId: 'v1' })).toBe(false);
  });
});
