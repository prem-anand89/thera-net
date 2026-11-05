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

describe('Time zone picker', () => {
  const open = () => {
    render(<ClinicRegionSection onDirtyChange={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Change' }));
    return screen.getByRole('combobox', { name: /Time zone/ }) as HTMLSelectElement;
  };

  it('offers a short list by region with place names, India first, instead of every zone', () => {
    const select = open();
    expect(select.options.length).toBeLessThan(80);
    expect(select.options[0]).toHaveTextContent(/^India \(UTC\+5:30\)$/);
    expect(within(select).getByRole('option', { name: /^UAE/ })).toBeInTheDocument();
    expect(select).toHaveValue('Asia/Kolkata');
    expect([...select.querySelectorAll('optgroup')].map((g) => g.label)).toEqual(expect.arrayContaining(['India and neighbours', 'Middle East', 'Europe']));
  });

  it('a clinic saved under the old browser name reads as India, and re-saving it is not a change', () => {
    clinicRef.current = { ...clinicRef.current, timezone: 'Asia/Calcutta' };
    const select = open();
    expect(select).toHaveValue('Asia/Kolkata');
    expect(screen.queryByRole('button', { name: 'Save' })).toBeNull();
  });

  it('"Show all time zones" adds the rest, each under one current name', () => {
    const select = open();
    fireEvent.click(screen.getByRole('button', { name: 'Not listed? Show all time zones' }));
    expect(select.options.length).toBeGreaterThan(150);
    const values = [...select.options].map((o) => o.value);
    expect(new Set(values).size).toBe(values.length);
    expect(values).not.toContain('Asia/Calcutta');
    expect(screen.queryByRole('button', { name: 'Not listed? Show all time zones' })).toBeNull();
  });

  it('keeps a saved zone that is not in the short list, so it is never silently replaced', () => {
    clinicRef.current = { ...clinicRef.current, timezone: 'Africa/Windhoek' };
    const select = open();
    expect(select).toHaveValue('Africa/Windhoek');
  });
});

describe('Region and daily email', () => {
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
