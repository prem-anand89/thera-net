// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { ClinicContext } from '@/app/clinicContext';
import type { Clinic } from '@/domain/types';
import { MessagePatientSheet } from './MessagePatientSheet';

let phone: string | null = '+91 98765 43210';
vi.mock('@/services', () => ({ repos: { patients: { get: async () => ({ id: 'pt1', phone }) } } }));
const clinic = { id: 'c1', name: 'Sunrise Physio' } as unknown as Clinic;
const renderSheet = () => render(<ClinicContext.Provider value={clinic}><MessagePatientSheet open patientId="pt1" token="tok123" onClose={vi.fn()} /></ClinicContext.Provider>);
afterEach(() => { cleanup(); phone = '+91 98765 43210'; });

describe('MessagePatientSheet', () => {
  it('starts with the reminder: clinic name and the page link, no PIN, no patient name', () => {
    renderSheet();
    const text = (screen.getByLabelText('Message text') as HTMLTextAreaElement).value;
    expect(text).toContain('Sunrise Physio');
    expect(text).toContain('/p/tok123');
    expect(text).not.toMatch(/PIN\D{0,4}\d{4}/); // the message may say "use your PIN", never a number after it
  });

  it('offers the five messages; picking one replaces the text; it can be edited and goes to the patient\'s WhatsApp', async () => {
    const user = userEvent.setup();
    renderSheet();
    expect(screen.getAllByRole('button', { pressed: undefined }).filter((b) => b.hasAttribute('aria-pressed'))).toHaveLength(5);
    await user.click(screen.getByRole('button', { name: 'Time for a check-in with us' }));
    const box = screen.getByLabelText('Message text') as HTMLTextAreaElement;
    expect(box.value).toMatch(/check-in/i);
    await user.type(box, ' See you Friday.');
    await waitFor(() => expect(screen.getByRole('link', { name: 'Open WhatsApp' }).getAttribute('href')).toContain('wa.me/919876543210'));
    expect(decodeURIComponent(screen.getByRole('link', { name: 'Open WhatsApp' }).getAttribute('href') ?? '')).toContain('See you Friday.');
  });

  it('with no phone number on file WhatsApp is asked to choose who to send it to', async () => {
    phone = null;
    renderSheet();
    expect(await screen.findByText(/No phone number on file/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Open WhatsApp' }).getAttribute('href')).toMatch(/^https:\/\/wa\.me\/\?text=/);
  });
});
