// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';

vi.mock('@/app/clinicContext', () => ({
  useClinic: () => ({ id: 'c1', name: 'Physio Clinic', address: '1 Main Road', clinicType: 'individual', hasPartner: false }),
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
});
