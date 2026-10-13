import { describe, expect, it } from 'vitest';
import { patientsBackLink } from './router';

describe('patientsBackLink', () => {
  it('maps undefined or /patients to Ledger Patients tab', () => {
    expect(patientsBackLink()).toEqual({
      to: '/ledger',
      search: { tab: 'patients' },
    });
    expect(patientsBackLink('/patients')).toEqual({
      to: '/ledger',
      search: { tab: 'patients' },
    });
  });

  it('preserves other explicit back targets without search params', () => {
    expect(patientsBackLink('/workspace')).toEqual({ to: '/workspace' });
    expect(patientsBackLink('/ledger')).toEqual({ to: '/ledger' });
    expect(patientsBackLink('/schedule')).toEqual({ to: '/schedule' });
  });
});
