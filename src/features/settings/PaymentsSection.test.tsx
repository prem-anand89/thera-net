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

  it('has no default payment method setting: only UPI collection', () => {
    render(<PaymentsSection onDirtyChange={vi.fn()} />);
    expect(screen.queryByText('Default payment method')).toBeNull();
    expect(screen.queryByRole('combobox')).toBeNull();
    expect(screen.getByText('Show UPI QR at collection')).toBeInTheDocument();
  });
});

describe('Billing & invoicing', () => {
  it('is titled Invoicing and no longer holds the UPI settings', () => {
    render(<BillingSection onDirtyChange={vi.fn()} />);
    expect(screen.getByRole('heading', { name: 'Invoicing' })).toBeInTheDocument();
    expect(screen.queryByText('UPI collection')).toBeNull();
    expect(screen.queryByText('Show UPI QR at collection')).toBeNull();
  });

  it('no longer holds the invoice prefix: that is the Clinic code in General → Clinic profile', () => {
    render(<BillingSection onDirtyChange={vi.fn()} />);
    expect(screen.queryByText('Invoice prefix')).toBeNull();
  });

  it('has no "Bills after a visit" setting: the Give bill button after a visit is the only way to offer a bill', () => {
    render(<BillingSection onDirtyChange={vi.fn()} />);
    expect(screen.queryByText('Bills after a visit')).toBeNull();
    expect(screen.queryByText(/Never remind|Always — open the bill step/)).toBeNull();
  });
});
