// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { ClinicContext } from '@/app/clinicContext';
import type { Clinic } from '@/domain/types';
import type { ProgramBundle } from '@/services/hepService';
import { HomeProgramNoteLine } from './HomeProgramNoteLine';

const listPatientPrograms = vi.fn();
vi.mock('@/services/hepService', async (orig) => ({ ...(await orig<typeof import('@/services/hepService')>()), hepService: { listPatientPrograms: (...a: unknown[]) => listPatientPrograms(...a) } }));
let canUseExercises = true;
vi.mock('@/app/usePermissions', () => ({ usePermissions: () => ({ canUseExercises }) }));
vi.mock('@tanstack/react-router', () => ({ Link: ({ children, to, params, search, ...rest }: { children: React.ReactNode; to: string; params?: Record<string, string>; search?: Record<string, string> } & Record<string, unknown>) => <a href={`${to.replace('$patientId', params?.patientId ?? '')}?view=${search?.view ?? ''}`} {...rest}>{children}</a> }));
vi.mock('./ProgramSheet', () => ({ ProgramSheet: ({ open, mode, patientId, startDate, onClose }: { open: boolean; mode: string; patientId?: string; startDate?: string; onClose: () => void }) => (open ? <div role="dialog" aria-label="program sheet">{mode} {patientId} starts {startDate ?? 'today'}<button type="button" onClick={onClose}>close sheet</button></div> : null) }));

const clinic = { id: 'c1', name: 'Sunrise', timezone: 'UTC' } as unknown as Clinic;
const TODAY = new Intl.DateTimeFormat('en-CA', { timeZone: 'UTC', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
const day = (o: number) => new Date(Date.parse(`${TODAY}T00:00:00Z`) + o * 86_400_000).toISOString().slice(0, 10);
const bundle = (): ProgramBundle => ({
  program: { id: 'p1', clinicId: 'c1', patientId: 'pt1', therapistId: null, title: 'Right knee', status: 'active', startDate: day(-3), durationDays: 14, targetPct: 70, checkinOn: null, feedbackDefault: 'pain', sessionsPerDay: 1, firstOpenedAt: null, painReviewedThrough: null, createdAt: '', updatedAt: '',
    items: [{ id: 'a', programId: 'p1', title: 'Squat', bodyRegion: 'Knee', phase: 'strengthening', equipment: [], instructions: '', mediaType: 'none', mediaKeys: [], mediaCaptions: [], doseType: 'reps', sets: 3, reps: 10, holdSeconds: null, durationSeconds: null, restSeconds: 30, side: 'none', sessionsPerDay: 1, optional: false, sessionsSchedule: [], stopIf: '', specialInstructions: '', sortOrder: 0, addedOn: day(-3), removedOn: null }] },
  patientName: 'Ravi', patientPhone: null, therapistName: null, logs: [-3, -2, -1].map((o) => ({ id: `l${o}`, programItemId: 'a', logDate: day(o), sessionIndex: 1 as const, skipped: false, completedAt: '' })), sessionFeedback: [], access: null,
});
const renderLine = (startDate: string | null = '2026-11-10') => render(<ClinicContext.Provider value={clinic}><HomeProgramNoteLine patientId="pt1" startDate={startDate} /></ClinicContext.Provider>);

beforeEach(() => { canUseExercises = true; listPatientPrograms.mockReset().mockResolvedValue([bundle()]); Object.defineProperty(navigator, 'onLine', { value: true, configurable: true }); });
afterEach(cleanup);

describe('HomeProgramNoteLine', () => {
  it('shows the digital program as one read-only line with its day and habit, and a link to the chart tab', async () => {
    renderLine();
    expect(await screen.findByText('Digital program: Right knee, day 4 of 14, 100%')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Open Home program' })).toHaveAttribute('href', '/patients/pt1?view=home-program');
  });

  it('says so when there is no program yet', async () => {
    listPatientPrograms.mockResolvedValue([]);
    renderLine();
    expect(await screen.findByText('No digital program yet.')).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Open Home program' })).toBeNull();
  });

  it('with no current program, Home program opens a new program for this patient starting on the visit date, and closing it changes nothing', async () => {
    listPatientPrograms.mockResolvedValue([]);
    const user = userEvent.setup();
    renderLine('2026-11-10');
    await screen.findByText('No digital program yet.');
    await user.click(screen.getByRole('button', { name: 'Home program' }));
    expect(screen.getByRole('dialog', { name: 'program sheet' })).toHaveTextContent('new pt1 starts 2026-11-10');
    await user.click(screen.getByRole('button', { name: 'close sheet' }));
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('with a current program, the button edits it (where the progress chips are)', async () => {
    const user = userEvent.setup();
    renderLine('2026-11-10');
    await screen.findByText(/Digital program: Right knee/);
    await user.click(screen.getByRole('button', { name: 'Edit home program' }));
    expect(screen.getByRole('dialog', { name: 'program sheet' })).toHaveTextContent(/^edit/);
  });

  it('is not there at all for front desk', () => {
    canUseExercises = false;
    const { container } = renderLine();
    expect(container).toBeEmptyDOMElement();
    expect(listPatientPrograms).not.toHaveBeenCalled();
  });

  it('offline, the button waits for a connection', () => {
    Object.defineProperty(navigator, 'onLine', { value: false, configurable: true });
    renderLine();
    expect(screen.getByRole('button', { name: 'Home program' })).toBeDisabled();
  });
});
