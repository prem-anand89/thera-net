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

import { BillingSection } from './BillingSections';

beforeEach(() => {
  clinicRef.current = {
    id: 'c1',
    name: 'Physio Clinic',
    invoicePrefix: 'BM',
    careLocations: ['clinic', 'home'],
    fyStartMonth: 4,
    invoicingAccess: 'everyone',
  };
  put.mockClear();
});
afterEach(cleanup);

describe('BillingSection - IP invoice prefix', () => {
  it('does NOT render IP invoice prefix when clinic does not have ward (IP)', () => {
    clinicRef.current = {
      ...clinicRef.current,
      careLocations: ['clinic', 'home'],
    };
    render(<BillingSection onDirtyChange={vi.fn()} />);
    expect(screen.queryByLabelText(/IP invoice prefix/i)).not.toBeInTheDocument();
  });

  it('renders IP invoice prefix when clinic includes ward, shows sample number, validates uniqueness and saves on put', async () => {
    clinicRef.current = {
      ...clinicRef.current,
      careLocations: ['clinic', 'ward'],
      invoicePrefix: 'BM',
    };
    render(<BillingSection onDirtyChange={vi.fn()} />);

    // Should render the field
    const input = screen.getByLabelText(/IP invoice prefix/i);
    expect(input).toBeInTheDocument();

    // Check sample number hint
    expect(screen.getByText(/Sample IP invoice number: BMIP\/\d{2}-\d{2}\/0001/i)).toBeInTheDocument();

    // Entering the same prefix as clinic.invoicePrefix triggers error
    fireEvent.change(input, { target: { value: 'BM' } });
    expect(screen.getByText(/IP invoice prefix must differ from the main invoice prefix/i)).toBeInTheDocument();

    // Entering an invalid format triggers error
    fireEvent.change(input, { target: { value: 'B M' } });
    expect(screen.getByText(/Use 2–10 letters or digits \(no spaces or slashes\)/i)).toBeInTheDocument();

    // Entering a valid prefix clears error and allows save
    fireEvent.change(input, { target: { value: 'BMIP2' } });
    expect(screen.queryByText(/IP invoice prefix must differ from the main invoice prefix/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/Use 2–10 letters or digits/i)).not.toBeInTheDocument();

    const saveButton = screen.getByRole('button', { name: 'Save' });
    fireEvent.click(saveButton);

    await waitFor(() => expect(put).toHaveBeenCalledTimes(1));
    expect(put.mock.calls[0][0]).toMatchObject({ ipInvoicePrefix: 'BMIP2' });
  });

  it('saves null when cleared', async () => {
    clinicRef.current = {
      ...clinicRef.current,
      careLocations: ['clinic', 'ward'],
      invoicePrefix: 'BM',
      ipInvoicePrefix: 'BMIP2',
    };
    render(<BillingSection onDirtyChange={vi.fn()} />);

    const input = screen.getByLabelText(/IP invoice prefix/i);
    expect(input).toHaveValue('BMIP2');

    fireEvent.change(input, { target: { value: '' } });
    const saveButton = screen.getByRole('button', { name: 'Save' });
    fireEvent.click(saveButton);

    await waitFor(() => expect(put).toHaveBeenCalledTimes(1));
    expect(put.mock.calls[0][0]).toMatchObject({ ipInvoicePrefix: null });
  });
});
