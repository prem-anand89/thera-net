import { describe, expect, it } from 'vitest';
import { advancesForDepartment, inDepartmentList, isPartnerClearance, paymentsForDepartment, runningCharges } from './departmentMoney';

describe('department lists', () => {
  it('keeps each department\'s records apart, a record with no place being OP', () => {
    const rows = [{ id: 1 }, { id: 2, location: 'home' }, { id: 3, location: 'ward' }, { id: 4, location: null }];
    expect(inDepartmentList('clinic', rows).map((r) => r.id)).toEqual([1, 4]);
    expect(inDepartmentList('home', rows).map((r) => r.id)).toEqual([2]);
    expect(inDepartmentList('ward', rows).map((r) => r.id)).toEqual([3]);
  });
});

describe('paymentsForDepartment', () => {
  const visits = new Map([['vo', {}], ['vh', { location: 'home' }], ['vw', { location: 'ward' }]]);
  const payments = [{ id: 'a', visitId: 'vo' }, { id: 'b', visitId: 'vh' }, { id: 'c', visitId: 'vw' }, { id: 'd', visitId: 'unknown' }, { id: 'e', visitId: null }];

  it('a payment follows its visit; an unknown visit reads as OP; the three departments never overlap', () => {
    expect(paymentsForDepartment('clinic', payments, visits).map((p) => p.id)).toEqual(['a', 'd', 'e']);
    expect(paymentsForDepartment('home', payments, visits).map((p) => p.id)).toEqual(['b']);
    expect(paymentsForDepartment('ward', payments, visits).map((p) => p.id)).toEqual(['c']);
    const total = ['clinic', 'home', 'ward'].flatMap((d) => paymentsForDepartment(d as 'clinic', payments, visits));
    expect(total).toHaveLength(payments.length);
  });
});

describe('advancesForDepartment', () => {
  it('until advances carry a department, they are all OP', () => {
    expect(advancesForDepartment('clinic', [1, 2])).toEqual([1, 2]);
    expect(advancesForDepartment('home', [1, 2])).toEqual([]);
    expect(advancesForDepartment('ward', [1, 2])).toEqual([]);
  });
});

describe('runningCharges', () => {
  it('sums only live, unbilled ward sessions, and counts the stays they belong to', () => {
    const v = (over: object) => ({ location: 'ward', actualBillPaise: 1000, ...over });
    const out = runningCharges([
      v({ admissionId: 's1' }),
      v({ admissionId: 's1' }),
      v({ admissionId: 's2' }),
      v({ admissionId: 's3', invoiceId: 'billed' }),
      v({ admissionId: 's4', deleted: true }),
      { location: 'home', actualBillPaise: 9999 },
      { actualBillPaise: 9999 },
    ]);
    expect(out).toEqual({ paise: 3000, sessions: 3, stays: 2 });
  });
});

describe('isPartnerClearance', () => {
  it('only the partner method is clearance', () => {
    expect(isPartnerClearance('partner')).toBe(true);
    expect(isPartnerClearance('cash')).toBe(false);
  });
});
