// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { Clinic } from '@/domain/types';

const clinicRef: { current: Partial<Clinic> } = { current: {} };
const put = vi.fn(async (row: Partial<Clinic>) => {
  clinicRef.current = row;
});
vi.mock('@/app/clinicContext', () => ({ useClinic: () => clinicRef.current }));
vi.mock('@/services', () => ({
  repos: { clinics: { get: async () => clinicRef.current, put: (row: Partial<Clinic>) => put(row) } },
  visitService: { recomputeUninvoicedSplits: async () => ({ updated: 0 }) },
}));
const inpatientOnPlan = { current: true };
vi.mock('@/app/useEntitlements', () => ({
  useEntitlements: () => ({ planPending: false, can: () => inpatientOnPlan.current }),
}));
vi.mock('@/lib/supabase', () => ({ getSupabase: () => null, publicLogoUrl: () => null }));

import { CareLocationsSection } from './ClinicSections';

beforeEach(() => {
  clinicRef.current = { id: 'c1', name: 'Physio Clinic' };
  put.mockClear();
  inpatientOnPlan.current = true;
});
afterEach(cleanup);

const sw = (name: string) => screen.getByRole('switch', { name: new RegExp(name) });

describe('Places you see patients', () => {
  it('a clinic that never set it shows Clinic on, Home off and no Save button', () => {
    render(<CareLocationsSection onDirtyChange={vi.fn()} />);
    expect(sw('Clinic')).toBeChecked();
    expect(sw('Home visit')).not.toBeChecked();
    expect(screen.queryByRole('button', { name: 'Save' })).toBeNull();
    expect(sw('Inpatient')).not.toBeChecked();
  });

  it('turning Home on and saving stores clinic and home', async () => {
    render(<CareLocationsSection onDirtyChange={vi.fn()} />);
    fireEvent.click(sw('Home visit'));
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(put).toHaveBeenCalled());
    expect(put.mock.calls[0][0].careLocations).toEqual(['clinic', 'home']);
  });

  it('the last place that is on cannot be turned off; a home-only clinic can swap by turning Clinic off', () => {
    render(<CareLocationsSection onDirtyChange={vi.fn()} />);
    expect(sw('Clinic')).toBeDisabled();
    fireEvent.click(sw('Home visit'));
    fireEvent.click(sw('Clinic'));
    expect(sw('Clinic')).not.toBeChecked();
    expect(sw('Home visit')).toBeChecked();
    expect(sw('Home visit')).toBeDisabled();
  });

  it('turning Inpatient on stores it with Clinic; a plan without it shows the plan instead of a switch', async () => {
    const { unmount } = render(<CareLocationsSection onDirtyChange={vi.fn()} />);
    fireEvent.click(sw('Inpatient'));
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(put).toHaveBeenCalled());
    expect(put.mock.calls[0][0].careLocations).toEqual(['clinic', 'ward']);
    unmount();

    inpatientOnPlan.current = false;
    clinicRef.current = { id: 'c1', name: 'Physio Clinic' };
    render(<CareLocationsSection onDirtyChange={vi.fn()} />);
    expect(screen.queryByRole('switch', { name: /Inpatient/ })).toBeNull();
    expect(screen.getByText('Clinic plan and above')).toBeInTheDocument();
  });

  it('disables the Inpatient toggle with Coming soon for clinics other than Physio Clinic', () => {
    clinicRef.current = { id: 'c2', name: 'Apex Physio' };
    inpatientOnPlan.current = true;
    render(<CareLocationsSection onDirtyChange={vi.fn()} />);
    const inpatientSwitch = sw('Inpatient');
    expect(inpatientSwitch).toBeDisabled();
    expect(inpatientSwitch).not.toBeChecked();
    expect(screen.getByText('Coming soon')).toBeInTheDocument();
    fireEvent.click(inpatientSwitch);
    expect(screen.queryByRole('button', { name: 'Save' })).toBeNull();
  });
});
