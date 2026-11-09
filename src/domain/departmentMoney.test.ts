import { describe, expect, it } from 'vitest';
import {
  advancesForDepartment,
  canBillInpatientStay,
  inDepartmentList,
  inpatientVisitBillingMode,
  isInpatientVisit,
  isIpBilledByPartner,
  isPartnerClearance,
  paymentsForDepartment,
  runningCharges,
} from './departmentMoney';

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
  it('filters advances by department, treating missing or null department as OP (clinic)', () => {
    const rawAdvances = [
      { id: 'a1', department: 'ward' },
      { id: 'a2', department: 'home' },
      { id: 'a3', department: 'clinic' },
      { id: 'a4', department: null },
      { id: 'a5' },
    ];
    expect(advancesForDepartment('ward', rawAdvances).map((a) => a.id)).toEqual(['a1']);
    expect(advancesForDepartment('home', rawAdvances).map((a) => a.id)).toEqual(['a2']);
    expect(advancesForDepartment('clinic', rawAdvances).map((a) => a.id)).toEqual(['a3', 'a4', 'a5']);
  });

  it('filters wrapped advance balance rows by advance.department', () => {
    const balanceRows = [
      { advance: { id: 'b1', department: 'ward' }, remainingPaise: 5000 },
      { advance: { id: 'b2', department: 'home' }, remainingPaise: 3000 },
      { advance: { id: 'b3', department: null }, remainingPaise: 2000 },
      { advance: { id: 'b4' }, remainingPaise: 1000 },
    ];
    expect(advancesForDepartment('ward', balanceRows).map((r) => r.advance.id)).toEqual(['b1']);
    expect(advancesForDepartment('home', balanceRows).map((r) => r.advance.id)).toEqual(['b2']);
    expect(advancesForDepartment('clinic', balanceRows).map((r) => r.advance.id)).toEqual(['b3', 'b4']);
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


describe('inpatient billing rules', () => {
  it('identifies inpatient visits by ward location or admissionId', () => {
    expect(isInpatientVisit({ location: 'ward' })).toBe(true);
    expect(isInpatientVisit({ location: 'clinic', admissionId: 'adm-1' })).toBe(true);
    expect(isInpatientVisit({ location: 'clinic' })).toBe(false);
    expect(isInpatientVisit({ location: 'home' })).toBe(false);
  });

  it('resolves whether hospital partner bills inpatients vs clinic stay billing', () => {
    expect(isIpBilledByPartner({ hasPartner: false, partnerCollects: false })).toBe(false);
    expect(isIpBilledByPartner({ hasPartner: true, partnerCollects: true })).toBe(true);
    expect(isIpBilledByPartner({ hasPartner: false, partnerCollects: false, ipBilledByPartner: true })).toBe(true);
    expect(isIpBilledByPartner({ hasPartner: true, partnerCollects: true, ipBilledByPartner: false })).toBe(false);
    expect(canBillInpatientStay({ ipBilledByPartner: false })).toBe(true);
    expect(canBillInpatientStay({ ipBilledByPartner: true })).toBe(false);
  });

  it('returns stay_bill or partner_billed for ward visits and null for OP/Home', () => {
    expect(inpatientVisitBillingMode({ location: 'clinic' }, { ipBilledByPartner: false })).toBeNull();
    expect(inpatientVisitBillingMode({ location: 'ward' }, { ipBilledByPartner: false })).toBe('stay_bill');
    expect(inpatientVisitBillingMode({ location: 'ward' }, { ipBilledByPartner: true })).toBe('partner_billed');
  });
});
