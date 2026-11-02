// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';

vi.mock('@/app/clinicContext', () => ({
  useClinic: () => ({ id: 'c1', name: 'Physio Clinic', address: '1 Main Road', clinicType: 'individual', hasPartner: false, invoicePrefix: 'PC', walkInMrnoPrefix: 'PC', fyStartMonth: 4 }),
}));
vi.mock('@/services', () => ({ repos: { clinics: { get: () => undefined, put: vi.fn() } } }));
vi.mock('@/lib/supabase', () => ({ getSupabase: () => null, publicLogoUrl: () => null }));

import { ClinicProfileSection } from './ClinicSections';

vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} });

describe('ClinicProfileSection', () => {
  afterEach(cleanup);

  it('shows the form straight away, with no Single / Multiple Therapists setting', () => {
    render(<ClinicProfileSection onDirtyChange={vi.fn()} />);
    expect(screen.queryByRole('button', { name: /Edit clinic profile/i })).toBeNull();
    expect(screen.getByDisplayValue('Physio Clinic')).toBeEnabled();
    expect(screen.queryByText('Therapist Setup')).toBeNull();
    expect(screen.queryByText(/Single Therapist|Multiple Therapists/)).toBeNull();
  });

  it('has one Clinic code field for patient IDs and invoices, and no separate prefix fields', () => {
    render(<ClinicProfileSection onDirtyChange={vi.fn()} />);
    expect(screen.getByRole('textbox', { name: /Clinic code/ })).toBeInTheDocument();
    expect(screen.queryByText('Patient ID Prefix')).toBeNull();
    expect(screen.queryByText('Invoice prefix')).toBeNull();
  });
});
