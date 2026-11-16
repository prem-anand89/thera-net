// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, waitFor } from '@testing-library/react';
import { ClinicContext } from '@/app/clinicContext';
import type { Clinic } from '@/domain/types';
import type { HepItemInput } from '@/services/hepService';
import { PrintSheet } from './PrintSheet';

vi.mock('@/services/hepMediaService', () => ({ hepMediaService: { mintViewUrls: async (_c: string, keys: string[]) => Object.fromEntries(keys.map((k) => [k, `https://img.test/${k}`])) } }));
const clinic = { id: 'c1', name: 'Sunrise Physio' } as unknown as Clinic;
const item = (title: string, over: Partial<HepItemInput> = {}): HepItemInput => ({
  title, bodyRegion: 'Knee', phase: 'strengthening', instructions: 'Sit tall\nTighten', mediaType: 'stills', mediaKeys: ['clinics/c1/exercises/e/0-aaaaaaaa'], mediaCaptions: [], equipment: [], doseType: 'reps', sets: 3, reps: 10,
  holdSeconds: null, durationSeconds: null, restSeconds: 30, sessionsPerDay: 1, side: 'none', optional: false, stopIf: 'Sharp pain', ...over,
});
const renderSheet = (pin: string | null, items = [item('Squat'), item('Marching', { phase: 'warm_up', mediaKeys: [] })]) =>
  render(<ClinicContext.Provider value={clinic}><PrintSheet open onClose={vi.fn()} clinicName="Sunrise Physio" patientName="Ravi Kumar" programTitle="Knee, week 1" link="https://app.test/p/tok123" pin={pin} items={items} /></ClinicContext.Provider>);

beforeEach(() => { window.print = vi.fn(); });
afterEach(cleanup);

describe('PrintSheet', () => {
  it('prints the clinic, patient, link, the PIN, and the exercises section by section with steps, dose and stop-if', async () => {
    renderSheet('4821');
    await waitFor(() => expect(window.print).toHaveBeenCalled());
    const text = document.querySelector('.hep-print')?.textContent ?? '';
    expect(text).toContain('Sunrise Physio');
    expect(text).toContain('Home exercise program for Ravi Kumar');
    expect(text).toContain('https://app.test/p/tok123');
    expect(text).toContain('4821');
    expect(text.indexOf('Warm-up')).toBeLessThan(text.indexOf('Strengthening'));
    expect(text).toContain('Stop if: Sharp pain');
    expect(text).toContain('3 sets × 10 reps');
    expect(document.querySelector('.hep-print img')?.getAttribute('src')).toBe('https://img.test/clinics/c1/exercises/e/0-aaaaaaaa');
    const qr = document.querySelector('.hep-print svg[role="img"]');
    expect(qr).not.toBeNull();
    expect(qr?.querySelector('path')?.getAttribute('d')).toBeTruthy();
  });

  it('encodes only the link (never the PIN) into the QR code', async () => {
    const qrcode = await import('qrcode');
    const spy = vi.spyOn(qrcode.default, 'create');
    renderSheet('4821');
    await waitFor(() => expect(window.print).toHaveBeenCalled());
    expect(spy).toHaveBeenCalledWith('https://app.test/p/tok123', expect.any(Object));
    expect(JSON.stringify(spy.mock.calls)).not.toContain('4821');
    spy.mockRestore();
  });

  it('leaves the PIN off the paper when it was not just created or reset', async () => {
    renderSheet(null);
    await waitFor(() => expect(window.print).toHaveBeenCalled());
    const text = document.querySelector('.hep-print')?.textContent ?? '';
    expect(text).not.toContain('Enter your PIN');
    expect(text).toContain('Remember this phone');
  });

  it('is hidden on screen and shows only itself when printing', async () => {
    renderSheet('4821');
    await waitFor(() => expect(window.print).toHaveBeenCalled());
    expect(document.querySelector('.hep-print style')?.textContent).toMatch(/\.hep-print\{display:none\}.*@media print.*body>\*:not\(\.hep-print\)\{display:none!important\}/);
  });
});
