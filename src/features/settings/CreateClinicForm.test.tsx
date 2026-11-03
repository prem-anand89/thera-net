// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

const rpc = vi.fn();
const putLocal = vi.fn(async (_clinic: unknown) => {});
const put = vi.fn(async (_clinic: unknown) => {});
vi.mock('@tanstack/react-router', () => ({ useNavigate: () => vi.fn() }));
vi.mock('@/app/useActiveClinic', () => ({ setActiveClinic: vi.fn(async () => {}) }));
vi.mock('@/app/signOut', () => ({ signOutSafely: vi.fn() }));
vi.mock('@/features/onboarding/OnboardingProgress', () => ({ OnboardingProgress: () => null }));
vi.mock('@/components/PhoneField', () => ({ PhoneField: () => null }));
vi.mock('@/services', () => ({ repos: { clinics: { putLocal: (c: unknown) => putLocal(c), put: (c: unknown) => put(c) } } }));
vi.mock('@/lib/supabase', () => ({
  getSupabase: () => ({
    auth: { getUser: async () => ({ data: { user: { id: 'u1' } } }) },
    rpc: (...a: unknown[]) => rpc(...a),
    storage: { from: () => ({ upload: async () => ({ error: null }) }) },
  }),
}));

import { CreateClinicForm } from './CreateClinicForm';

beforeEach(() => {
  rpc.mockReset().mockImplementation(async (_name: string, args: { p_name: string; p_invoice_prefix: string }) => ({
    data: {
      id: 'c1',
      name: args.p_name,
      email: null,
      phone: null,
      address: null,
      gst_no: null,
      logo_path: null,
      partner_hospital_name: null,
      partner_hospital_logo_path: null,
      invoice_prefix: args.p_invoice_prefix,
      clinic_split_pct: 100,
      tax_pct: 0,
      tds_basis: 'gross_bill',
      fy_start_month: 4,
      enable_therapist_split: false,
      updated_at: '2026-11-02T00:00:00Z',
    },
    error: null,
  }));
  putLocal.mockClear();
  put.mockClear();
});
afterEach(cleanup);

describe('CreateClinicForm', () => {
  it('starts both the invoice numbers and the Patient IDs from the clinic code made from the name', async () => {
    render(<CreateClinicForm onSuccess={vi.fn()} variant="dialog" />);
    fireEvent.change(screen.getByPlaceholderText('e.g., Sunrise Physiotherapy'), { target: { value: 'Beyond Mechanics' } });
    fireEvent.click(screen.getByRole('button', { name: /create/i }));
    await waitFor(() => expect(rpc).toHaveBeenCalled());
    expect(rpc.mock.calls[0][1]).toMatchObject({ p_name: 'Beyond Mechanics', p_invoice_prefix: 'BM' });
    // The Patient ID prefix is not an RPC argument: it goes out through the normal outbox push.
    await waitFor(() => expect(put).toHaveBeenCalled());
    expect(put.mock.calls[0][0]).toMatchObject({ invoicePrefix: 'BM', walkInMrnoPrefix: 'BM' });
  });

  it('falls back to INV (and no patient prefix) for a name with no letters', async () => {
    render(<CreateClinicForm onSuccess={vi.fn()} variant="dialog" />);
    fireEvent.change(screen.getByPlaceholderText('e.g., Sunrise Physiotherapy'), { target: { value: '123' } });
    fireEvent.click(screen.getByRole('button', { name: /create/i }));
    await waitFor(() => expect(rpc).toHaveBeenCalled());
    expect(rpc.mock.calls[0][1]).toMatchObject({ p_invoice_prefix: 'INV' });
    expect(putLocal.mock.calls[0][0]).toMatchObject({ walkInMrnoPrefix: null });
    expect(put).not.toHaveBeenCalled();
  });

  it('renders a single bordered outer card in the page variant, with form having plain space-y-4', () => {
    const { container } = render(<CreateClinicForm onSuccess={vi.fn()} variant="page" />);
    const form = container.querySelector('form');
    expect(form).toHaveClass('space-y-4');
    expect(form?.className).not.toContain('border');
    expect(form?.className).not.toContain('rounded-[10px]');
  });

  it('shows live code preview in the header preview panel when a clinic name produces a code, and hides when empty or no code', () => {
    render(<CreateClinicForm onSuccess={vi.fn()} variant="page" />);
    expect(screen.queryByTestId('invoice-code-preview')).not.toBeInTheDocument();

    const input = screen.getByPlaceholderText('e.g., Sunrise Physiotherapy');
    fireEvent.change(input, { target: { value: 'Beyond Mechanics' } });
    const preview = screen.getByTestId('invoice-code-preview');
    expect(preview).toBeInTheDocument();
    expect(preview.textContent).toMatch(/Invoices BM\/.*\/0001 · Patient IDs BM.*-0001/);

    // Number-only name produces no clinicCode letters
    fireEvent.change(input, { target: { value: '1234' } });
    expect(screen.queryByTestId('invoice-code-preview')).not.toBeInTheDocument();
  });

  it('renders address in the preview with whitespace-pre-line so line breaks are preserved', () => {
    render(<CreateClinicForm onSuccess={vi.fn()} variant="page" />);
    const addressInput = screen.getByLabelText('Address');
    fireEvent.change(addressInput, { target: { value: '12 Main Street\nBangalore, KA — 560001' } });
    const aside = screen.getByLabelText('Invoice header preview');
    const renderedAddress = aside.querySelector('p.whitespace-pre-line');
    expect(renderedAddress).toBeInTheDocument();
    expect(renderedAddress?.textContent).toBe('12 Main Street\nBangalore, KA — 560001');
  });
});
