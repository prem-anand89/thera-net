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

import { AfterVisitSection } from './ClinicSections';
import { PatientCommsSection } from './BookingSections';

beforeEach(() => {
  clinicRef.current = { id: 'c1', name: 'Physio Clinic', clinicalDocsEnabled: false, enablePatientComms: false, googleReviewUrl: null, bookingSlug: 'physio' };
  put.mockClear();
});
afterEach(cleanup);

describe('After a visit', () => {
  it('holds the clinical notes prompt and the feedback request as two switches', () => {
    render(<AfterVisitSection onDirtyChange={vi.fn()} />);
    expect(screen.getByRole('heading', { name: 'After a visit' })).toBeInTheDocument();
    expect(screen.getByRole('switch', { name: 'Ask for a clinical note after each visit' })).not.toBeChecked();
    expect(screen.getByRole('switch', { name: 'Ask patients for feedback' })).not.toBeChecked();
    expect(screen.queryByPlaceholderText('https://g.page/r/…/review')).toBeNull();
  });

  it('saves both switches and the Google review link, which shows only while feedback is on', async () => {
    render(<AfterVisitSection onDirtyChange={vi.fn()} />);
    fireEvent.click(screen.getByRole('switch', { name: 'Ask for a clinical note after each visit' }));
    fireEvent.click(screen.getByRole('switch', { name: 'Ask patients for feedback' }));
    fireEvent.change(screen.getByPlaceholderText('https://g.page/r/…/review'), { target: { value: 'https://g.page/r/abc/review' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(put).toHaveBeenCalledTimes(1));
    expect(put.mock.calls[0][0]).toMatchObject({
      clinicalDocsEnabled: true,
      enablePatientComms: true,
      googleReviewUrl: 'https://g.page/r/abc/review',
    });
  });

  it('keeps a saved review link when feedback is switched off, and shows it again when switched back on', () => {
    clinicRef.current = { ...clinicRef.current, enablePatientComms: true, googleReviewUrl: 'https://g.page/r/abc/review' };
    render(<AfterVisitSection onDirtyChange={vi.fn()} />);
    fireEvent.click(screen.getByRole('switch', { name: 'Ask patients for feedback' }));
    expect(screen.queryByPlaceholderText('https://g.page/r/…/review')).toBeNull();
    fireEvent.click(screen.getByRole('switch', { name: 'Ask patients for feedback' }));
    expect(screen.getByPlaceholderText('https://g.page/r/…/review')).toHaveValue('https://g.page/r/abc/review');
  });
});

describe('Online booking page', () => {
  it('is only about the booking link: no feedback switch and no review link', () => {
    render(<PatientCommsSection onDirtyChange={vi.fn()} />);
    expect(screen.getByRole('heading', { name: 'Online booking page' })).toBeInTheDocument();
    expect(screen.getByPlaceholderText('my-clinic-name')).toHaveValue('physio');
    expect(screen.queryByText('Feedback')).toBeNull();
    expect(screen.queryByText('Google review link')).toBeNull();
  });

});

describe('Booking link', () => {
  const linkInput = () => screen.getByPlaceholderText('my-clinic-name');

  it('changing a link that already exists asks first; Cancel saves nothing', async () => {
    render(<PatientCommsSection onDirtyChange={vi.fn()} />);
    fireEvent.change(linkInput(), { target: { value: 'physio-care' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(screen.getByRole('dialog')).toHaveTextContent('Anyone using the old link will no longer reach your booking page.');
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Cancel' }));
    expect(put).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    fireEvent.click(screen.getByRole('button', { name: 'Change link' }));
    await waitFor(() => expect(put).toHaveBeenCalledTimes(1));
    expect(put.mock.calls[0][0]).toMatchObject({ bookingSlug: 'physio-care' });
  });

  it('clearing an existing link asks too', () => {
    render(<PatientCommsSection onDirtyChange={vi.fn()} />);
    fireEvent.change(linkInput(), { target: { value: '' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(screen.getByRole('dialog')).toHaveTextContent('Turn off the booking link?');
  });

  it('setting a link for the first time saves without asking', async () => {
    clinicRef.current = { ...clinicRef.current, bookingSlug: null };
    render(<PatientCommsSection onDirtyChange={vi.fn()} />);
    fireEvent.change(linkInput(), { target: { value: 'physio' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(put).toHaveBeenCalledTimes(1));
    expect(screen.queryByRole('dialog')).toBeNull();
  });
});

