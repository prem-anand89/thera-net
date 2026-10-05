// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { LetterheadPreview } from './LetterheadPreview';
import type { Clinic } from '@/domain/types';

const mockClinic = {
  id: 'c1',
  name: 'Real Clinic Name',
  address: 'Real Address',
  phone: '1234567890',
  email: 'real@example.com',
  gstNo: 'GST123',
  partnerHospitalName: 'Partner Hospital',
  logoPath: 'real-logo.png',
  signaturePath: null,
  clinicType: 'individual',
  partnerHospitalLogoPath: null,
  invoicingAccess: 'everyone' as const,
  invoicePrefix: 'INV',
  billingEnabled: true,
  invoicePolicy: 'on_request' as const,
  fyStartMonth: 4,
  clinicalDocsEnabled: false,
};

vi.mock('@/app/clinicContext', () => ({
  useClinic: () => mockClinic as unknown as Clinic,
}));

describe('LetterheadPreview', () => {
  beforeEach(() => {
    global.ResizeObserver = vi.fn().mockImplementation(() => ({
      observe: vi.fn(),
      unobserve: vi.fn(),
      disconnect: vi.fn(),
    }));
  });

  afterEach(() => {
    cleanup();
  });

  it('renders clinic name and address from draft', () => {
    render(
      <LetterheadPreview
        draft={{
          name: 'Draft Clinic',
          address: 'Draft Address',
          phone: null,
          email: null,
          gstNo: null,
          partnerHospitalName: null,
        }}
        logoUrl={null}
        partnerLogoUrl={null}
      />
    );

    expect(screen.getByText('Draft Clinic')).toBeInTheDocument();
    expect(screen.getByText('Draft Address')).toBeInTheDocument();
  });

  it('shows placeholder when draft name is empty', () => {
    render(
      <LetterheadPreview
        draft={{
          name: '',
          address: null,
          phone: null,
          email: null,
          gstNo: null,
          partnerHospitalName: null,
        }}
        logoUrl={null}
        partnerLogoUrl={null}
      />
    );

    expect(screen.getByText('Your clinic name')).toBeInTheDocument();
  });

  it('shows logo img only when logoUrl is provided', () => {
    const { rerender } = render(
      <LetterheadPreview
        draft={{ name: 'Draft Clinic', address: null, phone: null, email: null, gstNo: null, partnerHospitalName: null }}
        logoUrl={null}
        partnerLogoUrl={null}
      />
    );

    expect(screen.queryByRole('presentation', { hidden: true })).not.toBeInTheDocument();

    rerender(
      <LetterheadPreview
        draft={{ name: 'Draft Clinic', address: null, phone: null, email: null, gstNo: null, partnerHospitalName: null }}
        logoUrl="https://example.com/logo.png"
        partnerLogoUrl={null}
      />
    );

    const logo = screen.getByRole('presentation', { hidden: true });
    expect(logo).toBeInTheDocument();
    expect(logo).toHaveAttribute('src', 'https://example.com/logo.png');
  });
});
