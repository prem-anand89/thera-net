import { describe, expect, it } from 'vitest';
import {
  defaultPaymentMethod,
  isCashInHand,
  isFullyPartnerCollected,
  partnerPaymentsByVisit,
  paymentMethodLabel,
  paymentMethodOptions,
} from './paymentMethods';

const solo = { hasPartner: false };
const hospital = { hasPartner: true, partnerHospitalName: 'Health Valley' };

describe('payment method labels and options', () => {
  it('names the partner, falling back to a plain word', () => {
    expect(paymentMethodLabel('partner', hospital)).toBe('Collected by Health Valley');
    expect(paymentMethodLabel('partner', { hasPartner: true, partnerShareLabel: 'HV' })).toBe('Collected by HV');
    expect(paymentMethodLabel('partner', { hasPartner: true })).toBe('Collected by partner');
    expect(paymentMethodLabel('upi', solo)).toBe('UPI');
  });

  it('offers the partner option only to a clinic with a partner', () => {
    expect(paymentMethodOptions(solo).map((o) => o.value)).not.toContain('partner');
    expect(paymentMethodOptions(hospital).map((o) => o.value)).toContain('partner');
  });

  it('partner money is not cash in hand', () => {
    expect(isCashInHand('partner')).toBe(false);
    expect(isCashInHand('cash')).toBe(true);
    expect(isCashInHand('upi')).toBe(true);
  });
});

describe('defaultPaymentMethod', () => {
  it('uses UPI when nothing is set', () => {
    expect(defaultPaymentMethod(solo)).toBe('upi');
  });

  it('the clinic default beats what the device used last', () => {
    expect(defaultPaymentMethod({ ...solo, defaultPaymentMethod: 'card' }, 'cash')).toBe('card');
  });

  it('the device memory applies only when the clinic set no default', () => {
    expect(defaultPaymentMethod(solo, 'cash')).toBe('cash');
  });

  it('the partner collecting wins over everything', () => {
    expect(defaultPaymentMethod({ ...hospital, partnerCollects: true, defaultPaymentMethod: 'cash' }, 'upi')).toBe('partner');
  });

  it('skips a partner method the clinic can no longer use', () => {
    expect(defaultPaymentMethod({ ...solo, defaultPaymentMethod: 'partner' }, 'partner')).toBe('upi');
    expect(defaultPaymentMethod({ hasPartner: false, partnerCollects: true })).toBe('upi');
  });
});

describe('partner-collected visits', () => {
  it('sums only partner payments per visit', () => {
    const map = partnerPaymentsByVisit([
      { visitId: 'v1', method: 'partner', amountPaise: 50000 },
      { visitId: 'v1', method: 'cash', amountPaise: 10000 },
      { visitId: 'v2', method: 'cash', amountPaise: 20000 },
    ]);
    expect(map.get('v1')).toBe(50000);
    expect(map.has('v2')).toBe(false);
  });

  it('is fully partner-collected only when the partner took the whole bill', () => {
    expect(isFullyPartnerCollected(50000, 50000)).toBe(true);
    expect(isFullyPartnerCollected(50000, 20000)).toBe(false);
    expect(isFullyPartnerCollected(0, 0)).toBe(false);
    expect(isFullyPartnerCollected(50000, undefined)).toBe(false);
  });
});
