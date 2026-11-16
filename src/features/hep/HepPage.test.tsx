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
import { validateHepSearch } from './hepSearch';

const navigate = vi.fn();
let search: Record<string, unknown> = {};
let perms = { canUseExercises: true, role: 'therapist' };
const listClinicPrograms = vi.fn();

vi.mock('@tanstack/react-router', () => ({
  useSearch: () => search,
  useNavigate: () => navigate,
  Navigate: ({ to }: { to: string }) => <div>redirected to {to}</div>,
}));
vi.mock('@/app/usePermissions', () => ({ usePermissions: () => perms }));
vi.mock('@/services/hepService', async (orig) => ({
  ...(await orig<typeof import('@/services/hepService')>()),
  hepService: {
    listClinicPrograms: (...a: unknown[]) => listClinicPrograms(...a),
  },
}));
vi.mock('./LibraryTab', () => ({ LibraryTab: () => <div>library tab</div> }));
vi.mock('./TemplatesTab', () => ({ TemplatesTab: () => <div>templates tab</div> }));
vi.mock('./ProgramsTab', () => ({
  ProgramsTab: ({ onNewProgram }: { onNewProgram?: () => void }) => (
    <div>
      <span>programs tab</span>
      {onNewProgram && <button type="button" onClick={onNewProgram}>+ New program</button>}
    </div>
  ),
}));
vi.mock('./StarterSetSheet', () => ({ StarterSetSheet: () => null }));
vi.mock('./ProgramSheet', () => ({
  ProgramSheet: ({ open, mode }: { open: boolean; mode: string }) =>
    open ? <div role="dialog">program sheet ({mode})</div> : null,
}));
vi.mock('./MessagePatientSheet', () => ({ MessagePatientSheet: () => null }));

const clinic = { id: 'c1', name: 'Sunrise', timezone: 'UTC' } as unknown as Clinic;
const TODAY = new Intl.DateTimeFormat('en-CA', { timeZone: 'UTC', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
const day = (offset: number) => new Date(Date.parse(`${TODAY}T00:00:00Z`) + offset * 86_400_000).toISOString().slice(0, 10);

const ex = (id: string): Exercise => ({
  id, clinicId: 'c1', title: 'Quad Sets', positions: [], otherNames: [], bodyRegion: 'Knee', alsoRegions: [], equipment: [],
  phase: 'activation', instructions: '', mediaType: 'none', mediaKeys: [], mediaCaptions: [], thumbKey: null,
  defaultSets: 3, doseType: 'reps', defaultReps: 10, defaultHoldSeconds: null, defaultDurationSeconds: null, defaultRestSeconds: 30,
  defaultSessionsPerDay: 1, side: 'none', stopIf: '', isFavorite: false, active: true, deleted: false, version: 1, createdAt: '', updatedAt: '',
});
const item = (id: string): ProgramItem => ({
  id, programId: 'p1', title: 'Quad Sets', bodyRegion: 'Knee', phase: 'activation', equipment: [], instructions: '',
  mediaType: 'none', mediaKeys: [], mediaCaptions: [], doseType: 'reps', sets: 3, reps: 10, holdSeconds: null,
  durationSeconds: null, restSeconds: 30, side: 'none', sessionsPerDay: 1, optional: false, sessionsSchedule: [],
  stopIf: '', specialInstructions: '', sortOrder: 0, addedOn: day(-8), removedOn: null,
});
const makeBundle = (id: string, over: Partial<ProgramBundle> = {}, progOver: Partial<Program> = {}): ProgramBundle => ({
  program: {
    id, clinicId: 'c1', patientId: `pt-${id}`, therapistId: 't1', title: `Program ${id}`, status: 'active',
    startDate: day(-3), durationDays: 14, targetPct: 70, checkinOn: null, feedbackDefault: 'pain', sessionsPerDay: 1,
    firstOpenedAt: null, painReviewedThrough: null, items: [item(`${id}a`)], createdAt: '', updatedAt: '', ...progOver,
  },
  patientName: 'Asha', patientPhone: null, therapistName: 'Meera',
  logs: [{ id: 'l1', programItemId: `${id}a`, logDate: TODAY, sessionIndex: 1 as SessionsPerDay, skipped: false, completedAt: `${TODAY}T08:00:00Z` } as ProgramLog],
  sessionFeedback: [],
  access: { token: 't', linkRevoked: false, openCount: 2, lastOpenedAt: null },
  ...over,
});

function renderPage() {
  return render(<ClinicContext.Provider value={clinic}><HepPage /></ClinicContext.Provider>);
}

beforeEach(async () => {
  await db.exercises.clear();
  listClinicPrograms.mockReset().mockResolvedValue([]);
  Object.defineProperty(navigator, 'onLine', { value: true, configurable: true });
});

afterEach(() => {
  cleanup();
  navigate.mockReset();
  search = {};
  perms = { canUseExercises: true, role: 'therapist' };
});

describe('HepPage', () => {
  it('front desk never reaches HEP: they are sent back to Workspace', () => {
    perms = { canUseExercises: false, role: 'front_desk' };
    renderPage();
    expect(screen.getByText('redirected to /workspace')).toBeInTheDocument();
    expect(screen.queryByText('library tab')).toBeNull();
  });

  it('waits while the role is still unknown instead of sending anyone away', () => {
    perms = { canUseExercises: false, role: 'unknown' };
    renderPage();
    expect(screen.queryByText(/redirected/)).toBeNull();
    expect(screen.getByRole('status')).toBeInTheDocument();
  });

  it('opens on Library when the library is empty and moves between tabs through the URL', async () => {
    const user = userEvent.setup();
    renderPage();
    expect(screen.getByRole('tab', { name: 'Library' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByText('library tab')).toBeInTheDocument();
    await user.click(screen.getByRole('tab', { name: 'Programs' }));
    expect(navigate).toHaveBeenCalledWith({ to: '/hep', search: { tab: 'programs' } });
  });

  it('defaults to Programs once the library has at least one exercise, while still honouring an explicit ?tab=', async () => {
    await db.exercises.put(ex('e1'));
    renderPage();
    await waitFor(() => expect(screen.getByRole('tab', { name: /^Programs/ })).toHaveAttribute('aria-selected', 'true'));
    expect(screen.getByText('programs tab')).toBeInTheDocument();

    cleanup();
    search = { tab: 'library' };
    renderPage();
    expect(screen.getByRole('tab', { name: 'Library' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByText('library tab')).toBeInTheDocument();
  });

  it('clicking "+ New program" inside Programs opens ProgramSheet in new mode', async () => {
    await db.exercises.put(ex('e1'));
    const user = userEvent.setup();
    renderPage();
    await waitFor(() => expect(screen.getByRole('button', { name: '+ New program' })).toBeInTheDocument());
    await user.click(screen.getByRole('button', { name: '+ New program' }));
    expect(screen.getByRole('dialog')).toHaveTextContent('program sheet (new)');
  });

  it('shows the attention count on the Programs tab pill, and hides it when zero or offline', async () => {
    listClinicPrograms.mockResolvedValue([
      makeBundle('p1', { logs: [{ id: 'old', programItemId: 'p1a', logDate: day(-3), sessionIndex: 1 as SessionsPerDay, skipped: false, completedAt: `${day(-3)}T08:00:00Z` }] }),
      makeBundle('p2'),
    ]);
    renderPage();
    await waitFor(() => expect(screen.getByRole('tab', { name: 'Programs 1' })).toBeInTheDocument());

    cleanup();
    listClinicPrograms.mockResolvedValue([makeBundle('p2')]);
    renderPage();
    await waitFor(() => expect(listClinicPrograms).toHaveBeenCalledTimes(2));
    expect(screen.getByRole('tab', { name: 'Programs' })).not.toHaveTextContent(/\d/);

    cleanup();
    Object.defineProperty(navigator, 'onLine', { value: false, configurable: true });
    listClinicPrograms.mockReset();
    renderPage();
    expect(screen.getByRole('tab', { name: 'Programs' })).toBeInTheDocument();
    expect(listClinicPrograms).not.toHaveBeenCalled();
  });

  it('keeps only a known tab in the search', () => {
    expect(validateHepSearch({ tab: 'templates' })).toEqual({ tab: 'templates' });
    expect(validateHepSearch({ tab: 'nonsense' })).toEqual({});
    expect(validateHepSearch({ tab: 3 })).toEqual({});
  });
});
