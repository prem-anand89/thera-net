import { describe, expect, it } from 'vitest';
import {
  buildLineItems,
  groupVisitsForInvoicing,
  invoiceLineGroupKey,
  invoicePeriod,
  isV2Line,
  lineRatePerSessionPaise,
  lineReconciles,
  linePeriod,
  normalizeAuthorizedCount,
  sessionCountLabel,
  sessionDatesDisplay,
} from './invoiceLine';
import type { InvoiceLineItem, Visit } from './types';
import { rupeesToPaise as rs } from './money';

let seq = 0;
function makeVisit(overrides: Partial<Visit> & Pick<Visit, 'actualBillPaise'>): Visit {
  seq += 1;
  return {
    id: overrides.id ?? `visit-${seq}`,
    clinicId: 'clinic-1',
    patientId: 'patient-1',
    therapistId: 'therapist-1',
    visitDate: '2026-01-01',
    condition: null,
    treatmentNotes: null,
    serviceCatalogId: 'svc-1',
    catalogPricePaise: overrides.actualBillPaise,
    adjustmentPaise: 0,
    adjustmentReason: null,
    sessionIndex: null,
    packageTotal: null,
    packageGroupId: null,
    bmSplitPct: 100,
    taxPct: 0,
    tdsBasis: 'gross_bill',
    bmSharePaise: overrides.actualBillPaise,
    postTaxPaise: overrides.actualBillPaise,
    tdsPaise: 0,
    hvPaise: 0,
    invoiceId: null,
    deleted: false,
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

const CATALOG_NAMES = new Map([
  ['svc-1', 'Physiotherapy'],
  ['svc-2', 'Manual Therapy'],
]);

describe('normalizeAuthorizedCount', () => {
  it('treats 0 as "not a package", not as a divisor', () => {
    expect(normalizeAuthorizedCount(0)).toBeNull();
  });
  it('treats null/undefined as "not a package"', () => {
    expect(normalizeAuthorizedCount(null)).toBeNull();
    expect(normalizeAuthorizedCount(undefined)).toBeNull();
  });
  it('passes through a real positive count', () => {
    expect(normalizeAuthorizedCount(10)).toBe(10);
  });
});

describe('isV2Line', () => {
  it('is true only when lineItemVersion is exactly 2', () => {
    const legacy: InvoiceLineItem = {
      serviceName: 'X',
      sessionCount: 1,
      sessionDates: [],
      catalogPricePaise: 100,
      adjustmentPaise: 0,
      adjustmentReason: null,
      totalPaise: 100,
    };
    expect(isV2Line(legacy)).toBe(false);
    expect(isV2Line({ ...legacy, lineItemVersion: 2 })).toBe(true);
  });
});

describe('lineRatePerSessionPaise', () => {
  it('never divides by zero — legacy line with sessionCount 0 floors to 1', () => {
    const li: InvoiceLineItem = {
      serviceName: 'X',
      sessionCount: 0,
      sessionDates: [],
      catalogPricePaise: rs(500),
      adjustmentPaise: 0,
      adjustmentReason: null,
      totalPaise: rs(500),
    };
    expect(lineRatePerSessionPaise(li)).toBe(rs(500));
    expect(Number.isFinite(lineRatePerSessionPaise(li))).toBe(true);
  });

  it('uses the snapshotted v2 rate directly, not a re-derivation', () => {
    const li: InvoiceLineItem = {
      serviceName: 'X',
      sessionCount: 10,
      sessionDates: [],
      catalogPricePaise: rs(5000),
      adjustmentPaise: 0,
      adjustmentReason: null,
      totalPaise: rs(5000),
      lineItemVersion: 2,
      ratePerSessionPaise: rs(999), // deliberately not catalogPricePaise/10
    };
    expect(lineRatePerSessionPaise(li)).toBe(rs(999));
  });
});

describe('sessionCountLabel', () => {
  it('reads "N sessions" for a legacy line', () => {
    const li: InvoiceLineItem = {
      serviceName: 'X',
      sessionCount: 3,
      sessionDates: [],
      catalogPricePaise: rs(1500),
      adjustmentPaise: 0,
      adjustmentReason: null,
      totalPaise: rs(1500),
    };
    expect(sessionCountLabel(li)).toBe('3 sessions');
  });

  it('reads "N of M sessions" for a partial v2 package', () => {
    const li: InvoiceLineItem = {
      serviceName: 'X',
      sessionCount: 10,
      sessionDates: [],
      catalogPricePaise: rs(5000),
      adjustmentPaise: 0,
      adjustmentReason: null,
      totalPaise: rs(5000),
      lineItemVersion: 2,
      billedSessionCount: 3,
      authorizedSessionCount: 10,
    };
    expect(sessionCountLabel(li)).toBe('3 of 10 sessions');
  });

  it('clamps billed to authorized rather than ever printing "11 of 10"', () => {
    const li: InvoiceLineItem = {
      serviceName: 'X',
      sessionCount: 10,
      sessionDates: [],
      catalogPricePaise: rs(5000),
      adjustmentPaise: 0,
      adjustmentReason: null,
      totalPaise: rs(5000),
      lineItemVersion: 2,
      billedSessionCount: 11,
      authorizedSessionCount: 10,
    };
    expect(sessionCountLabel(li)).toBe('10 sessions');
  });
});

describe('sessionDatesDisplay', () => {
  function lineWithDates(dates: string[]): InvoiceLineItem {
    return {
      serviceName: 'X',
      sessionCount: dates.length,
      sessionDates: dates,
      catalogPricePaise: rs(dates.length * 500),
      adjustmentPaise: 0,
      adjustmentReason: null,
      totalPaise: rs(dates.length * 500),
    };
  }

  it('lists every date at or under the threshold (8)', () => {
    const dates = Array.from({ length: 8 }, (_, i) => `2026-01-${String(i + 1).padStart(2, '0')}`);
    expect(sessionDatesDisplay(lineWithDates(dates))).toEqual({ mode: 'list', dates });
  });

  it('condenses to a range once past the threshold', () => {
    const dates = Array.from({ length: 24 }, (_, i) => `2026-01-${String(i + 1).padStart(2, '0')}`);
    expect(sessionDatesDisplay(lineWithDates(dates))).toEqual({
      mode: 'range',
      from: '2026-01-01',
      to: '2026-01-24',
      count: 24,
    });
  });

  it('sorts unsorted input before taking the range endpoints', () => {
    const dates = [
      '2026-03-10',
      '2026-01-05',
      '2026-02-20',
      '2026-01-01',
      '2026-04-01',
      '2026-01-15',
      '2026-02-01',
      '2026-03-01',
      '2026-04-15',
    ];
    expect(sessionDatesDisplay(lineWithDates(dates))).toEqual({
      mode: 'range',
      from: '2026-01-01',
      to: '2026-04-15',
      count: 9,
    });
  });
});

describe('linePeriod / invoicePeriod', () => {
  it('spans the earliest to latest date, unsorted input included', () => {
    const li: InvoiceLineItem = {
      serviceName: 'X',
      sessionCount: 3,
      sessionDates: ['2026-01-15', '2026-01-01', '2026-01-08'],
      catalogPricePaise: rs(1500),
      adjustmentPaise: 0,
      adjustmentReason: null,
      totalPaise: rs(1500),
    };
    expect(linePeriod(li)).toEqual({ from: '2026-01-01', to: '2026-01-15' });
  });

  it('null for a line with no dates', () => {
    const li: InvoiceLineItem = {
      serviceName: 'X',
      sessionCount: 0,
      sessionDates: [],
      catalogPricePaise: 0,
      adjustmentPaise: 0,
      adjustmentReason: null,
      totalPaise: 0,
    };
    expect(linePeriod(li)).toBeNull();
  });

  it('spans across every line on the invoice', () => {
    const a: InvoiceLineItem = {
      serviceName: 'A',
      sessionCount: 1,
      sessionDates: ['2026-02-01'],
      catalogPricePaise: 0,
      adjustmentPaise: 0,
      adjustmentReason: null,
      totalPaise: 0,
    };
    const b: InvoiceLineItem = {
      serviceName: 'B',
      sessionCount: 1,
      sessionDates: ['2026-01-05'],
      catalogPricePaise: 0,
      adjustmentPaise: 0,
      adjustmentReason: null,
      totalPaise: 0,
    };
    expect(invoicePeriod([a, b])).toEqual({ from: '2026-01-05', to: '2026-02-01' });
  });
});

describe('lineReconciles', () => {
  it('is always false for a legacy line — nothing to check', () => {
    const li: InvoiceLineItem = {
      serviceName: 'X',
      sessionCount: 3,
      sessionDates: [],
      catalogPricePaise: rs(1500),
      adjustmentPaise: 0,
      adjustmentReason: null,
      totalPaise: rs(1500),
    };
    expect(lineReconciles(li)).toBe(false);
  });

  it('is true for a fully-billed v2 package whose price divides evenly', () => {
    const li: InvoiceLineItem = {
      serviceName: 'X',
      sessionCount: 10,
      sessionDates: [],
      catalogPricePaise: rs(5000),
      adjustmentPaise: 0,
      adjustmentReason: null,
      totalPaise: rs(5000),
      lineItemVersion: 2,
      billedSessionCount: 10,
      authorizedSessionCount: 10,
      ratePerSessionPaise: rs(500),
    };
    expect(lineReconciles(li)).toBe(true);
  });

  it('is false for a fully-billed package whose price does NOT divide evenly (rounding) — the case the old proxy condition missed', () => {
    // ₹5,000 / 3 = ₹1,666.666..., rounds to ₹1,666.67 per session.
    // 3 * 1,666.67 = 5,000.01 =/= 5,000 exactly.
    const ratePerSessionPaise = Math.round(rs(5000) / 3);
    const li: InvoiceLineItem = {
      serviceName: 'X',
      sessionCount: 3,
      sessionDates: [],
      catalogPricePaise: rs(5000),
      adjustmentPaise: 0,
      adjustmentReason: null,
      totalPaise: rs(5000),
      lineItemVersion: 2,
      billedSessionCount: 3,
      authorizedSessionCount: 3,
      ratePerSessionPaise,
    };
    expect(lineReconciles(li)).toBe(false);
  });

  it('is false for a genuine partial package (3 of 10 delivered, full price charged)', () => {
    const li: InvoiceLineItem = {
      serviceName: 'X',
      sessionCount: 10,
      sessionDates: [],
      catalogPricePaise: rs(5000),
      adjustmentPaise: 0,
      adjustmentReason: null,
      totalPaise: rs(5000),
      lineItemVersion: 2,
      billedSessionCount: 3,
      authorizedSessionCount: 10,
      ratePerSessionPaise: rs(500),
    };
    expect(lineReconciles(li)).toBe(false);
  });
});

describe('invoiceLineGroupKey', () => {
  it('keys on packageGroupId when present', () => {
    const v = makeVisit({ actualBillPaise: rs(500), packageGroupId: 'pkg-1' });
    expect(invoiceLineGroupKey(v)).toBe('pkg-1');
  });

  it('falls back to a svc: namespaced key of service + price for non-package visits', () => {
    const v = makeVisit({ actualBillPaise: rs(800), serviceCatalogId: 'svc-1' });
    expect(invoiceLineGroupKey(v)).toBe(`svc:svc-1:${rs(800)}`);
  });
});

describe('groupVisitsForInvoicing + buildLineItems', () => {
  it('full package (10/10): one line, no fraction, catalogPricePaise sums correctly across ₹0 continuations', () => {
    const pkg = 'pkg-full';
    const visits = [
      makeVisit({
        id: 'v1',
        packageGroupId: pkg,
        sessionIndex: 1,
        packageTotal: 10,
        visitDate: '2026-01-01',
        catalogPricePaise: rs(5000),
        actualBillPaise: rs(5000),
      }),
      ...Array.from({ length: 9 }, (_, i) =>
        makeVisit({
          id: `v${i + 2}`,
          packageGroupId: pkg,
          sessionIndex: i + 2,
          packageTotal: 10,
          visitDate: `2026-01-${String(i + 2).padStart(2, '0')}`,
          catalogPricePaise: 0,
          actualBillPaise: 0,
        })
      ),
    ];
    const { lineItems, totalPaise, therapistId } = buildLineItems(
      groupVisitsForInvoicing(visits),
      CATALOG_NAMES
    );
    expect(lineItems).toHaveLength(1);
    const li = lineItems[0];
    expect(li.billedSessionCount).toBe(10);
    expect(li.authorizedSessionCount).toBe(10);
    expect(li.catalogPricePaise).toBe(rs(5000));
    expect(li.totalPaise).toBe(rs(5000));
    expect(lineReconciles(li)).toBe(true);
    expect(totalPaise).toBe(rs(5000));
    expect(therapistId).toBe('therapist-1');
  });

  it('partial package (3 of 10): sessionCount reads correctly, caption condition (lineReconciles) is false', () => {
    const pkg = 'pkg-partial';
    const visits = [
      makeVisit({
        id: 'v1',
        packageGroupId: pkg,
        sessionIndex: 1,
        packageTotal: 10,
        visitDate: '2026-01-01',
        catalogPricePaise: rs(5000),
        actualBillPaise: rs(5000),
      }),
      makeVisit({
        id: 'v2',
        packageGroupId: pkg,
        sessionIndex: 2,
        packageTotal: 10,
        visitDate: '2026-01-02',
        catalogPricePaise: 0,
        actualBillPaise: 0,
      }),
      makeVisit({
        id: 'v3',
        packageGroupId: pkg,
        sessionIndex: 3,
        packageTotal: 10,
        visitDate: '2026-01-03',
        catalogPricePaise: 0,
        actualBillPaise: 0,
      }),
    ];
    const { lineItems } = buildLineItems(groupVisitsForInvoicing(visits), CATALOG_NAMES);
    const li = lineItems[0];
    expect(li.billedSessionCount).toBe(3);
    expect(li.authorizedSessionCount).toBe(10);
    expect(li.totalPaise).toBe(rs(5000));
    expect(lineReconciles(li)).toBe(false);
    expect(sessionCountLabel(li)).toBe('3 of 10 sessions');
  });

  it('ten independent (non-package) home visits of the same service+price merge into one "10 sessions" line, not "1"', () => {
    const visits = Array.from({ length: 10 }, (_, i) =>
      makeVisit({
        id: `home-${i}`,
        serviceCatalogId: 'svc-1',
        visitDate: `2026-01-${String(i + 1).padStart(2, '0')}`,
        catalogPricePaise: rs(800),
        actualBillPaise: rs(800),
      })
    );
    const { lineItems, totalPaise } = buildLineItems(
      groupVisitsForInvoicing(visits),
      CATALOG_NAMES
    );
    expect(lineItems).toHaveLength(1);
    const li = lineItems[0];
    expect(li.billedSessionCount).toBe(10);
    expect(li.authorizedSessionCount).toBeNull();
    expect(li.sessionCount).toBe(10);
    expect(li.catalogPricePaise).toBe(rs(8000));
    expect(li.totalPaise).toBe(rs(8000));
    expect(totalPaise).toBe(rs(8000));
    // Bug 4's identity: summed catalogPricePaise + adjustmentPaise = totalPaise, exactly.
    expect(li.catalogPricePaise + li.adjustmentPaise).toBe(li.totalPaise);
  });

  it('two visits of the same service at DIFFERENT catalog prices stay on separate lines', () => {
    const visits = [
      makeVisit({
        id: 'a',
        serviceCatalogId: 'svc-1',
        catalogPricePaise: rs(800),
        actualBillPaise: rs(800),
      }),
      makeVisit({
        id: 'b',
        serviceCatalogId: 'svc-1',
        catalogPricePaise: rs(900),
        actualBillPaise: rs(900),
      }),
    ];
    const { lineItems } = buildLineItems(groupVisitsForInvoicing(visits), CATALOG_NAMES);
    expect(lineItems).toHaveLength(2);
  });

  it('a group spanning two therapists dedupes therapistIds on the line and picks the invoice-level therapist by highest total billed', () => {
    const pkg = 'pkg-shared';
    const visits = [
      makeVisit({
        id: 'v1',
        packageGroupId: pkg,
        therapistId: 'therapist-a',
        visitDate: '2026-01-01',
        catalogPricePaise: rs(1000),
        actualBillPaise: rs(1000),
      }),
      makeVisit({
        id: 'v2',
        packageGroupId: pkg,
        therapistId: 'therapist-b',
        visitDate: '2026-01-02',
        catalogPricePaise: 0,
        actualBillPaise: 0,
      }),
    ];
    const { lineItems, therapistId } = buildLineItems(
      groupVisitsForInvoicing(visits),
      CATALOG_NAMES
    );
    expect(lineItems[0].therapistIds).toEqual(
      expect.arrayContaining(['therapist-a', 'therapist-b'])
    );
    expect(lineItems[0].therapistIds).toHaveLength(2);
    // therapist-a billed 1000, therapist-b billed 0 -> therapist-a wins.
    expect(therapistId).toBe('therapist-a');
  });

  it('a group with two different adjustment reasons keeps both distinctly, joined for the legacy string', () => {
    const pkg = 'pkg-adj';
    const visits = [
      makeVisit({
        id: 'v1',
        packageGroupId: pkg,
        visitDate: '2026-01-01',
        catalogPricePaise: rs(1000),
        actualBillPaise: rs(900),
        adjustmentPaise: -rs(100),
        adjustmentReason: 'Loyalty discount',
      }),
      makeVisit({
        id: 'v2',
        packageGroupId: pkg,
        visitDate: '2026-01-02',
        catalogPricePaise: 0,
        actualBillPaise: rs(50),
        adjustmentPaise: rs(50),
        adjustmentReason: 'Late fee',
      }),
    ];
    const { lineItems } = buildLineItems(groupVisitsForInvoicing(visits), CATALOG_NAMES);
    const li = lineItems[0];
    expect(li.adjustmentReasons).toEqual(expect.arrayContaining(['Loyalty discount', 'Late fee']));
    expect(li.adjustmentReason).toBe('Loyalty discount; Late fee');
    expect(li.adjustmentPaise).toBe(-rs(50));
    expect(li.totalPaise).toBe(rs(950));
  });

  it('sorts a group by visitDate then id, so the "which visit wins" pick is deterministic regardless of input order', () => {
    const pkg = 'pkg-order';
    const first = makeVisit({
      id: 'v1',
      packageGroupId: pkg,
      visitDate: '2026-01-01',
      catalogPricePaise: rs(1000),
      actualBillPaise: rs(1000),
      adjustmentReason: 'from-first',
    });
    const second = makeVisit({
      id: 'v2',
      packageGroupId: pkg,
      visitDate: '2026-01-02',
      catalogPricePaise: 0,
      actualBillPaise: 0,
    });
    // Pass in reverse order — result must be identical to forward order.
    const forward = buildLineItems(groupVisitsForInvoicing([first, second]), CATALOG_NAMES);
    const reverse = buildLineItems(groupVisitsForInvoicing([second, first]), CATALOG_NAMES);
    expect(forward.lineItems).toEqual(reverse.lineItems);
  });
});
