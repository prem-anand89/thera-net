// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';

const mockClinic = vi.hoisted(() => ({
  value: { id: 'c1', name: 'Physio Clinic', address: '1 Main Road', clinicType: 'individual', hasPartner: false, invoicePrefix: 'PC', walkInMrnoPrefix: 'PC', fyStartMonth: 4 } as Record<string, unknown>,
}));
vi.mock('@/app/clinicContext', () => ({ useClinic: () => mockClinic.value }));
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

  it('a complete profile opens as a summary with Edit, and Edit shows the form', () => {
    const before = mockClinic.value;
    mockClinic.value = { ...before, phone: '+91 9876543210' };
    try {
      render(<ClinicProfileSection onDirtyChange={vi.fn()} />);
      expect(screen.getAllByText('1 Main Road').length).toBeGreaterThan(0);
      expect(screen.queryByRole('textbox', { name: /Clinic code/ })).toBeNull();
      fireEvent.click(screen.getByRole('button', { name: 'Edit' }));
      expect(screen.getByRole('textbox', { name: /Clinic code/ })).toBeInTheDocument();
      fireEvent.click(screen.getByRole('button', { name: 'Hide' }));
      expect(screen.queryByRole('textbox', { name: /Clinic code/ })).toBeNull();
    } finally {
      mockClinic.value = before;
    }
  });

  it('has one Clinic code field for patient IDs and invoices, and no separate prefix fields', () => {
    render(<ClinicProfileSection onDirtyChange={vi.fn()} />);
    expect(screen.getByRole('textbox', { name: /Clinic code/ })).toBeInTheDocument();
    expect(screen.queryByText('Patient ID Prefix')).toBeNull();
    expect(screen.queryByText('Invoice prefix')).toBeNull();
  });

  it('keeps the tall invoice preview folded on phones until asked for', () => {
    render(<ClinicProfileSection onDirtyChange={vi.fn()} />);
    const toggle = screen.getByRole('button', { name: 'Show invoice preview' });
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    fireEvent.click(toggle);
    expect(screen.getByRole('button', { name: 'Hide invoice preview' })).toHaveAttribute('aria-expanded', 'true');
  });

  it('the name, address, phone and email boxes are labelled (tapping the label focuses the box)', () => {
    render(<ClinicProfileSection onDirtyChange={vi.fn()} />);
    for (const name of ['Clinic name', 'Address', 'Email']) expect(screen.getByLabelText(name)).toBeInTheDocument();
    expect(screen.getByLabelText('Address').tagName).toBe('TEXTAREA');
  });

  it('the email box gives a phone the email keyboard, with no auto-capital or spell-check', () => {
    render(<ClinicProfileSection onDirtyChange={vi.fn()} />);
    const email = screen.getByLabelText('Email');
    expect(email).toHaveAttribute('type', 'email');
    expect(email).toHaveAttribute('inputmode', 'email');
    expect(email).toHaveAttribute('autocomplete', 'email');
    expect(email).toHaveAttribute('autocapitalize', 'none');
    expect(email).toHaveAttribute('spellcheck', 'false');
    expect(screen.getByLabelText('Address')).toHaveAttribute('autocomplete', 'street-address');
  });

  it('an email that cannot be an address is called out and cannot be saved; a good one (or none) can', () => {
    render(<ClinicProfileSection onDirtyChange={vi.fn()} />);
    const email = screen.getByLabelText('Email');
    fireEvent.change(email, { target: { value: 'not-an-email' } });
    expect(screen.getByRole('alert')).toHaveTextContent('Enter a valid email address');
    expect(email).toHaveAttribute('aria-invalid', 'true');
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled();
    fireEvent.change(email, { target: { value: ' clinic@example.com ' } });
    expect(email).toHaveValue('clinic@example.com');
    expect(screen.queryByText(/Enter a valid email address/)).toBeNull();
    expect(screen.getByRole('button', { name: 'Save' })).not.toBeDisabled();
    fireEvent.change(email, { target: { value: '' } });
    expect(screen.queryByText(/Enter a valid email address/)).toBeNull();
  }, 30000);
});

