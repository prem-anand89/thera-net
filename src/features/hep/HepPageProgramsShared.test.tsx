// @vitest-environment jsdom
import 'fake-indexeddb/auto';
import '@testing-library/jest-dom/vitest';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { ClinicContext } from '@/app/clinicContext';
import type { Clinic } from '@/domain/types';
import type { Exercise, Program, ProgramItem, ProgramLog, SessionsPerDay } from '@/domain/hep';
import { db } from '@/lib/db';
import type { ProgramBundle } from '@/services/hepService';
import { HepPage } from './HepPage';

let search: Record<string, unknown> = { tab: 'programs' };
const listClinicPrograms = vi.fn();

vi.mock('@tanstack/react-router', () => ({
  useSearch: () => search,
  useNavigate: () => vi.fn(),
  Navigate: ({ to }: { to: string }) => <div>redirected to {to}</div>,
  Link: ({ children, to }: { children: React.ReactNode; to: string }) => <a href={to}>{children}</a>,
}));
vi.mock('@/app/usePermissions', () => ({
  usePermissions: () => ({ canUseExercises: true, role: 'admin' }),
}));
vi.mock('@/app/useWorkspaceScope', () => ({
  useWorkspaceScope: () => ({ isAdmin: true, myTherapistId: 't1' }),
}));
vi.mock('@/components/useMediaQuery', () => ({ useMediaQuery: () => true }));
vi.mock('@/services/hepService', async (orig) => ({
  ...(await orig<typeof import('@/services/hepService')>()),
  hepService: {
    listClinicPrograms: (...a: unknown[]) => listClinicPrograms(...a),
  },
}));
vi.mock('./LibraryTab', () => ({ LibraryTab: () => <div>library tab</div> }));
vi.mock('./TemplatesTab', () => ({ TemplatesTab: () => <div>templates tab</div> }));
vi.mock('./StarterSetSheet', () => ({ StarterSetSheet: () => null }));
vi.mock('./MessagePatientSheet', () => ({ MessagePatientSheet: () => null }));
vi.mock('./ProgramSheet', () => ({
  ProgramSheet: ({ open, onSaved }: { open: boolean; onSaved: () => void }) =>
    open ? <button type="button" onClick={onSaved}>save program mock</button> : null,
}));

const clinic = { id: 'c1', name: 'Sunrise', timezone: 'UTC' } as unknown as Clinic;
const TODAY = new Intl.DateTimeFormat('en-CA', { timeZone: 'UTC', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
const day = (offset: number) => new Date(Date.parse(`${TODAY}T00:00:00Z`) + offset * 86_400_000).toISOString().slice(0, 10);

const item: ProgramItem = {
  id: 'i1', programId: 'p1', title: 'Quad Sets', bodyRegion: 'Knee', phase: 'activation', equipment: [], instructions: '',
  mediaType: 'none', mediaKeys: [], mediaCaptions: [], doseType: 'reps', sets: 3, reps: 10, holdSeconds: null,
  durationSeconds: null, restSeconds: 30, side: 'none', sessionsPerDay: 1, optional: false, sessionsSchedule: [],
  stopIf: '', specialInstructions: '', sortOrder: 0, addedOn: day(-8), removedOn: null,
};
const ex: Exercise = {
  id: 'e1', clinicId: 'c1', title: 'Quad Sets', positions: [], otherNames: [], bodyRegion: 'Knee', alsoRegions: [], equipment: [],
  phase: 'activation', instructions: '', mediaType: 'none', mediaKeys: [], mediaCaptions: [], thumbKey: null,
  defaultSets: 3, doseType: 'reps', defaultReps: 10, defaultHoldSeconds: null, defaultDurationSeconds: null, defaultRestSeconds: 30,
  defaultSessionsPerDay: 1, side: 'none', stopIf: '', isFavorite: false, active: true, deleted: false, version: 1, createdAt: '', updatedAt: '',
};
const bundle: ProgramBundle = {
  program: {
    id: 'p1', clinicId: 'c1', patientId: 'pt1', therapistId: 't1', title: 'Knee Rehab', status: 'active',
    startDate: day(-5), durationDays: 14, targetPct: 70, checkinOn: null, feedbackDefault: 'pain', sessionsPerDay: 1,
    firstOpenedAt: null, painReviewedThrough: null, items: [item], createdAt: '', updatedAt: '',
  } as Program,
  patientName: 'Asha Pillai', patientPhone: null, therapistName: 'Meera',
  logs: [{ id: 'old', programItemId: 'i1', logDate: day(-3), sessionIndex: 1 as SessionsPerDay, skipped: false, completedAt: `${day(-3)}T08:00:00Z` } as ProgramLog],
  sessionFeedback: [],
  access: { token: 't', linkRevoked: false, openCount: 2, lastOpenedAt: null },
};

describe('HepPage + ProgramsTab shared programs load', () => {
  beforeEach(async () => {
    await db.exercises.clear();
    await db.exercises.put(ex);
    search = { tab: 'programs' };
    listClinicPrograms.mockReset().mockResolvedValue([bundle]);
    Object.defineProperty(navigator, 'onLine', { value: true, configurable: true });
  });
  afterEach(cleanup);

  it('calls listClinicPrograms once when the Programs tab opens and reuses the result for pill + list', async () => {
    render(<ClinicContext.Provider value={clinic}><HepPage /></ClinicContext.Provider>);
    expect(await screen.findByText('Asha Pillai')).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Programs 1' })).toBeInTheDocument();
    expect(listClinicPrograms).toHaveBeenCalledTimes(1);
  });

  it('does not call listClinicPrograms when offline', () => {
    Object.defineProperty(navigator, 'onLine', { value: false, configurable: true });
    render(<ClinicContext.Provider value={clinic}><HepPage /></ClinicContext.Provider>);
    expect(screen.getByText(/Programs need a connection/)).toBeInTheDocument();
    expect(listClinicPrograms).not.toHaveBeenCalled();
  });

  it('refreshes once when reloadKey bumps (saving a new program) or pain-reviewed fires', async () => {
    const user = userEvent.setup();
    render(<ClinicContext.Provider value={clinic}><HepPage /></ClinicContext.Provider>);
    await screen.findByText('Asha Pillai');
    expect(listClinicPrograms).toHaveBeenCalledTimes(1);

    await user.click(screen.getByRole('button', { name: '+ New program' }));
    await user.click(screen.getByRole('button', { name: 'save program mock' }));
    await waitFor(() => expect(listClinicPrograms).toHaveBeenCalledTimes(2));

    window.dispatchEvent(new Event('hep:pain-reviewed'));
    await waitFor(() => expect(listClinicPrograms).toHaveBeenCalledTimes(3));
  });
});
