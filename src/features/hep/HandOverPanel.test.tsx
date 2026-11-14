// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render, screen, waitFor, within } from '@testing-library/react';
import { ClinicContext } from '@/app/clinicContext';
import type { Clinic } from '@/domain/types';
import { HandOverPanel, POLL_EVERY_MS, POLL_FOR_MS, type HandOverPanelProps } from './HandOverPanel';

const linkStatus = vi.fn();
const resetPin = vi.fn();
const saveProgramAsTemplate = vi.fn();
vi.mock('@/services/hepService', async (orig) => ({
  ...(await orig<typeof import('@/services/hepService')>()),
  hepService: { linkStatus: (...a: unknown[]) => linkStatus(...a), resetPin: (...a: unknown[]) => resetPin(...a), saveProgramAsTemplate: (...a: unknown[]) => saveProgramAsTemplate(...a) },
}));
vi.mock('./PrintSheet', () => ({ PrintSheet: ({ open, pin }: { open: boolean; pin: string | null }) => (open ? <div>printing with pin {pin ?? 'none'}</div> : null) }));

const clinic = { id: 'c1', name: 'Sunrise Physio', timezone: 'Asia/Kolkata' } as unknown as Clinic;
const base: HandOverPanelProps = {
  open: true, onClose: vi.fn(), patientId: 'pt1', patientName: 'Ravi Kumar', patientPhone: '+91 98765 43210', programId: 'p1', programTitle: 'Knee, week 1', token: 'tok123', pin: '4821', items: [], fromTemplate: false,
};
const renderPanel = (over: Partial<HandOverPanelProps> = {}) => render(<ClinicContext.Provider value={clinic}><HandOverPanel {...base} {...over} /></ClinicContext.Provider>);

beforeEach(() => {
  linkStatus.mockReset().mockResolvedValue({ firstOpenedAt: null, lastOpenedAt: null, openCount: 0, linkRevoked: false });
  resetPin.mockReset().mockResolvedValue('7777');
  saveProgramAsTemplate.mockReset().mockResolvedValue('t9');
  base.onClose = vi.fn();
  Object.defineProperty(navigator, 'onLine', { value: true, configurable: true });
  Object.defineProperty(navigator, 'clipboard', { value: { writeText: vi.fn().mockResolvedValue(undefined) }, configurable: true });
});
afterEach(() => { cleanup(); vi.useRealTimers(); });

describe('HandOverPanel', () => {
  it('shows the PIN once with Copy, and the WhatsApp message and link never contain it', async () => {
    const user = userEvent.setup();
    const write = vi.spyOn(navigator.clipboard, 'writeText'); // after setup(): the test tool installs its own clipboard
    renderPanel();
    expect(screen.getByLabelText('PIN')).toHaveTextContent('4821');
    await user.click(screen.getByRole('button', { name: 'Copy PIN' }));
    expect(write).toHaveBeenCalledWith('4821');
    const href = screen.getByRole('link', { name: 'Send on WhatsApp' }).getAttribute('href') ?? '';
    expect(href).toContain('wa.me/919876543210');
    expect(decodeURIComponent(href)).toContain('Sunrise Physio: here is your home exercise program.');
    expect(decodeURIComponent(href)).toContain('/p/tok123');
    expect(decodeURIComponent(href)).not.toContain('4821');
    expect(screen.getByText('The WhatsApp message never contains the PIN.')).toBeInTheDocument();
  });

  it('Show PIN on screen opens a full-screen overlay with the clinic name and a very large PIN, and Done closes it', async () => {
    const user = userEvent.setup();
    renderPanel();
    await user.click(screen.getByRole('button', { name: 'Show PIN on screen' }));
    const overlay = screen.getByRole('dialog', { name: 'Your PIN' });
    expect(within(overlay).getByText('Sunrise Physio')).toBeInTheDocument();
    expect(within(overlay).getByText('4821')).toHaveStyle({ fontSize: '96px' });
    await user.click(within(overlay).getByRole('button', { name: 'Done' }));
    expect(screen.queryByRole('dialog', { name: 'Your PIN' })).toBeNull();
  });

  it('Print sheet with PIN is offered where the PIN is known and passes it on', async () => {
    const user = userEvent.setup();
    renderPanel();
    await user.click(screen.getByRole('button', { name: /Print sheet with PIN/ }));
    expect(screen.getByText('printing with pin 4821')).toBeInTheDocument();
  });

  it('checks whether the page was opened now and every 5 seconds, then shows "Opened ✓" with the time in the clinic\'s zone', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    renderPanel();
    await waitFor(() => expect(linkStatus).toHaveBeenCalledTimes(1));
    expect(screen.getByText('Waiting for the patient to open it…')).toBeInTheDocument();
    await act(async () => { await vi.advanceTimersByTimeAsync(POLL_EVERY_MS); });
    expect(linkStatus).toHaveBeenCalledTimes(2);
    linkStatus.mockResolvedValue({ firstOpenedAt: '2026-11-14T05:12:00Z', lastOpenedAt: null, openCount: 1, linkRevoked: false });
    await act(async () => { await vi.advanceTimersByTimeAsync(POLL_EVERY_MS); });
    expect(await screen.findByText('Opened ✓ 10:42')).toBeInTheDocument(); // 05:12 UTC is 10:42 in India
    const calls = linkStatus.mock.calls.length;
    await act(async () => { await vi.advanceTimersByTimeAsync(POLL_EVERY_MS * 3); });
    expect(linkStatus).toHaveBeenCalledTimes(calls); // stops once opened
    expect(screen.getByRole('button', { name: 'Done' })).toBeInTheDocument();
  });

  it('stops checking after 10 minutes', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    renderPanel();
    await act(async () => { await vi.advanceTimersByTimeAsync(POLL_FOR_MS + POLL_EVERY_MS); });
    const calls = linkStatus.mock.calls.length;
    expect(calls).toBeLessThanOrEqual(POLL_FOR_MS / POLL_EVERY_MS + 1);
    await act(async () => { await vi.advanceTimersByTimeAsync(POLL_EVERY_MS * 5); });
    expect(linkStatus).toHaveBeenCalledTimes(calls);
  });

  it('a patient who already has a PIN gets no PIN here; Reset PIN… (after asking) shows the new one', async () => {
    const user = userEvent.setup();
    renderPanel({ pin: null });
    expect(screen.getByText(/already has a PIN/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Show PIN on screen' })).toBeDisabled();
    await user.click(screen.getByRole('button', { name: 'Reset PIN…' }));
    expect(resetPin).not.toHaveBeenCalled();
    await user.click(within(screen.getByRole('dialog', { name: 'Reset the PIN?' })).getByRole('button', { name: 'Reset PIN' }));
    await waitFor(() => expect(resetPin).toHaveBeenCalledWith('pt1'));
    expect(await screen.findByLabelText('PIN')).toHaveTextContent('7777');
    expect(screen.getByRole('button', { name: 'Show PIN on screen' })).toBeEnabled();
  });

  it('offers Save as template once for a program that did not come from a template, with its name to edit', async () => {
    const user = userEvent.setup();
    renderPanel();
    await user.click(screen.getByRole('button', { name: 'Save as template' }));
    const name = screen.getByLabelText('Template name');
    expect(name).toHaveValue('Knee, week 1');
    await user.clear(name);
    await user.type(name, 'Knee replacement wk1');
    await user.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(saveProgramAsTemplate).toHaveBeenCalledWith('p1', 'Knee replacement wk1'));
    expect(await screen.findByText('Saved as a template ✓')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Save as template' })).toBeNull();
  });

  it('does not offer it for a program that came from a template', () => {
    renderPanel({ fromTemplate: true });
    expect(screen.queryByRole('button', { name: 'Save as template' })).toBeNull();
  });

  it('Skip for now closes the panel without anything having been done', async () => {
    const user = userEvent.setup();
    renderPanel();
    await user.click(screen.getByRole('button', { name: 'Skip for now' }));
    expect(base.onClose).toHaveBeenCalled();
  });

  it('the PIN is never written to storage', () => {
    const setItem = vi.spyOn(Storage.prototype, 'setItem');
    renderPanel();
    expect(setItem.mock.calls.flat().join(' ')).not.toContain('4821');
    setItem.mockRestore();
  });
});
