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
vi.mock('@/lib/supabase', () => ({ getSupabase: () => null, publicLogoUrl: () => null }));

import { PaymentsSection } from './ClinicSections';
import { BillingSection } from './BillingSections';

// A Lite clinic: no invoicing, no partner. It can still collect by UPI.
const lite: Partial<Clinic> = { id: 'c1', name: 'Physio Clinic', upiQrEnabled: false, upiVpa: null, invoicePrefix: 'BM', fyStartMonth: 4 };

beforeEach(() => {
  clinicRef.current = { ...lite };
  put.mockClear();
});
afterEach(cleanup);

describe('UPI collection in General → Payments', () => {
  it('a Lite clinic can save a UPI ID and payee name', async () => {
    render(<PaymentsSection onDirtyChange={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: 'On' }));
    fireEvent.change(screen.getByPlaceholderText('clinic@okaxis'), { target: { value: 'physio@okaxis' } });
    fireEvent.change(screen.getByPlaceholderText('Physio Clinic'), { target: { value: 'Physio Clinic LLP' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(put).toHaveBeenCalledTimes(1));
    expect(put.mock.calls[0][0]).toMatchObject({ upiQrEnabled: true, upiVpa: 'physio@okaxis', upiPayeeName: 'Physio Clinic LLP' });
  });

  it('refuses an invalid UPI ID and says why, without saving', async () => {
    render(<PaymentsSection onDirtyChange={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: 'On' }));
    fireEvent.change(screen.getByPlaceholderText('clinic@okaxis'), { target: { value: 'not a upi id' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(await screen.findByText(/Enter a valid UPI ID/)).toBeInTheDocument();
    expect(put).not.toHaveBeenCalled();
  });

  it('refuses turning the QR on with no UPI ID and no image', async () => {
    render(<PaymentsSection onDirtyChange={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: 'On' }));
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(await screen.findByText(/Add a UPI ID or upload a QR image/)).toBeInTheDocument();
    expect(put).not.toHaveBeenCalled();
  });

  it('saving the default payment method alone does not need any UPI details', async () => {
    render(<PaymentsSection onDirtyChange={vi.fn()} />);
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'cash' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(put).toHaveBeenCalledTimes(1));
    expect(put.mock.calls[0][0]).toMatchObject({ defaultPaymentMethod: 'cash', upiQrEnabled: false });
  });
});

describe('Billing & invoicing', () => {
  it('is titled Billing & invoicing and no longer holds the UPI settings', () => {
    render(<BillingSection onDirtyChange={vi.fn()} />);
    expect(screen.getByRole('heading', { name: 'Billing & invoicing' })).toBeInTheDocument();
    expect(screen.queryByText('UPI collection')).toBeNull();
    expect(screen.queryByText('Show UPI QR at collection')).toBeNull();
  });
});
