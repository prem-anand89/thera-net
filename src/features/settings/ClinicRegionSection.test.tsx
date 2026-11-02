// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
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

import { ClinicRegionSection } from './ClinicSections';
import { BillingSection } from './BillingSections';

beforeEach(() => {
  clinicRef.current = { id: 'c1', name: 'Physio Clinic', timezone: 'Asia/Kolkata', defaultCountryCode: '+91', fyStartMonth: 4, invoicePrefix: 'BM' };
  put.mockClear();
});
afterEach(cleanup);

describe('Region and agenda', () => {
  it('reads as one line, with the fields tucked away until Change', () => {
    render(<ClinicRegionSection onDirtyChange={vi.fn()} />);
    expect(screen.getByTestId('region-summary')).toHaveTextContent('India (+91) · India Standard Time (UTC+5:30) · Financial year from April');
    expect(screen.queryByRole('combobox', { name: /Time zone/ })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Change' }));
    expect(screen.getByRole('combobox', { name: /Time zone/ })).toBeEnabled();
    expect(screen.getByRole('combobox', { name: /Phone country code/ })).toBeInTheDocument();
    expect(screen.getByRole('combobox', { name: /Financial year starts in/ })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Done' }));
    expect(screen.queryByRole('combobox', { name: /Time zone/ })).toBeNull();
  });

  it('the financial year saves from here, with a note that it applies to invoices from now on', async () => {
    render(<ClinicRegionSection onDirtyChange={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Change' }));
    fireEvent.change(screen.getByRole('combobox', { name: /Financial year starts in/ }), { target: { value: '1' } });
    expect(screen.getByText(/Applies to invoices issued from now on/)).toBeInTheDocument();
    expect(screen.getByTestId('region-summary')).toHaveTextContent('Financial year from January');
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(put).toHaveBeenCalledTimes(1));
    expect(put.mock.calls[0][0]).toMatchObject({ fyStartMonth: 1 });
  });

  it('stays open while there are unsaved changes, so they cannot be hidden', () => {
    render(<ClinicRegionSection onDirtyChange={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Change' }));
    fireEvent.change(screen.getByRole('combobox', { name: /Phone country code/ }), { target: { value: '+44' } });
    expect(screen.queryByRole('button', { name: 'Done' })).toBeNull();
    expect(screen.getByRole('combobox', { name: /Phone country code/ })).toBeInTheDocument();
  });

  it('changing the time zone asks first; Cancel saves nothing, confirming saves', async () => {
    render(<ClinicRegionSection onDirtyChange={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Change' }));
    fireEvent.change(screen.getByRole('combobox', { name: /Time zone/ }), { target: { value: 'Asia/Dubai' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(screen.getByRole('dialog')).toHaveTextContent('Times patients and staff see in booking pages and emails will change.');
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(put).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    fireEvent.click(screen.getByRole('button', { name: 'Change time zone' }));
    await waitFor(() => expect(put).toHaveBeenCalledTimes(1));
    expect(put.mock.calls[0][0]).toMatchObject({ timezone: 'Asia/Dubai' });
  });

  it('other region changes save without asking', async () => {
    render(<ClinicRegionSection onDirtyChange={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Change' }));
    fireEvent.change(screen.getByRole('combobox', { name: /Phone country code/ }), { target: { value: '+44' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(put).toHaveBeenCalledTimes(1));
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('the Invoicing card no longer asks for the financial year', () => {
    render(<BillingSection onDirtyChange={vi.fn()} />);
    expect(screen.queryByText('Fiscal year starts in month')).toBeNull();
    expect(screen.queryByRole('combobox', { name: /Financial year starts in/ })).toBeNull();
  });
});
