// @vitest-environment jsdom
import 'fake-indexeddb/auto';
import '@testing-library/jest-dom/vitest';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { ClinicContext } from '@/app/clinicContext';
import type { Clinic } from '@/domain/types';
import type { Exercise } from '@/domain/hep';
import { db } from '@/lib/db';
import { LibraryTab } from './LibraryTab';

const toggleExerciseFavorite = vi.fn();
vi.mock('@/services/hepService', async (orig) => ({
  ...(await orig<typeof import('@/services/hepService')>()),
  hepService: { toggleExerciseFavorite: (...a: unknown[]) => toggleExerciseFavorite(...a), recentlyUsedExerciseIds: async () => ['e2'], exerciseUsage: async () => ({ programs: 0, templates: 0 }), saveExercise: vi.fn() },
}));
vi.mock('@/services/hepMediaService', () => ({ hepMediaService: { mintViewUrls: async () => ({}) } }));
let ent = { tier: 'lite', enforcementEnabled: true };
vi.mock('@/app/useEntitlements', () => ({ useEntitlements: () => ent }));

const clinic = { id: 'c1', name: 'Sunrise', timezone: 'Asia/Kolkata' } as unknown as Clinic;
const ex = (id: string, title: string, over: Partial<Exercise> = {}): Exercise => ({
  id, clinicId: 'c1', title, positions: [], otherNames: [], bodyRegion: 'Knee', alsoRegions: [], equipment: [], phase: 'strengthening', instructions: '', mediaType: 'none', mediaKeys: [], mediaCaptions: [],
  thumbKey: null, defaultSets: 3, doseType: 'reps', defaultReps: 10, defaultHoldSeconds: null, defaultDurationSeconds: null, defaultRestSeconds: 30, defaultSessionsPerDay: 1, side: 'none', stopIf: '',
  isFavorite: false, active: true, deleted: false, version: 1, createdAt: '', updatedAt: '', ...over,
});
const renderTab = (props: React.ComponentProps<typeof LibraryTab> = {}) =>
  render(<ClinicContext.Provider value={clinic}><LibraryTab {...props} /></ClinicContext.Provider>);

beforeEach(async () => {
  await db.exercises.clear();
  ent = { tier: 'lite', enforcementEnabled: true };
  toggleExerciseFavorite.mockReset();
  Object.defineProperty(navigator, 'onLine', { value: true, configurable: true });
});
afterEach(cleanup);

describe('LibraryTab', () => {
  it('starts empty with no built-in list, offering a first exercise and the optional TheraNet Library', async () => {
    const onStarter = vi.fn();
    renderTab({ onStarter });
    expect(await screen.findByText('Your Library is empty')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Add your first exercise' })).toBeInTheDocument();
    await userEvent.setup().click(screen.getByRole('button', { name: 'Open the TheraNet Library' }));
    expect(onStarter).toHaveBeenCalled();
  });

  it('reads the clinic\'s own exercises from the local cache (works offline), counts them and shows the free-plan allowance', async () => {
    Object.defineProperty(navigator, 'onLine', { value: false, configurable: true });
    await db.exercises.bulkPut([ex('e1', 'Quad Sets'), ex('e2', 'Wall Slides', { bodyRegion: 'Shoulder' }), ex('e3', 'Other clinic', { clinicId: 'c2' }), ex('e4', 'Gone', { deleted: true })]);
    renderTab();
    expect(await screen.findByText('Quad Sets')).toBeInTheDocument();
    expect(screen.getByText('Wall Slides')).toBeInTheDocument();
    expect(screen.queryByText('Other clinic')).toBeNull();
    expect(screen.queryByText('Gone')).toBeNull();
    expect(screen.getByText(/2 exercises/)).toHaveTextContent('free plan allows 10');
    expect(screen.getByRole('button', { name: 'Needs a connection' })).toBeDisabled();
  });

  it('shows no allowance on a plan without a cap', async () => {
    ent = { tier: 'solo', enforcementEnabled: true };
    await db.exercises.put(ex('e1', 'Quad Sets'));
    renderTab();
    expect(await screen.findByText(/1 exercise/)).not.toHaveTextContent('free plan');
  });

  it('Show archived reveals archived exercises', async () => {
    const user = userEvent.setup();
    await db.exercises.bulkPut([ex('e1', 'Quad Sets'), ex('e2', 'Old one', { active: false })]);
    renderTab();
    await screen.findByText('Quad Sets');
    expect(screen.queryByText('Old one')).toBeNull();
    await user.click(screen.getByLabelText(/Show archived \(1\)/));
    expect(await screen.findByText('Old one')).toBeInTheDocument();
  });

  it('a favourite is changed on the server and shown at once', async () => {
    const user = userEvent.setup();
    toggleExerciseFavorite.mockResolvedValue(true);
    await db.exercises.put(ex('e1', 'Quad Sets'));
    renderTab();
    await user.click(await screen.findByRole('button', { name: 'Add Quad Sets to favourites' }));
    await waitFor(async () => expect((await db.exercises.get('e1'))?.isFavorite).toBe(true));
    expect(toggleExerciseFavorite).toHaveBeenCalledWith('e1');
  });

  it('a failed favourite shows the message', async () => {
    const user = userEvent.setup();
    toggleExerciseFavorite.mockRejectedValue(new Error('HEP changes need a connection. Reconnect and try again.'));
    await db.exercises.put(ex('e1', 'Quad Sets'));
    renderTab();
    await user.click(await screen.findByRole('button', { name: 'Add Quad Sets to favourites' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('need a connection');
  });

  it('opens the form for a new exercise and for an existing one', async () => {
    const user = userEvent.setup();
    await db.exercises.put(ex('e1', 'Quad Sets'));
    renderTab();
    await user.click(await screen.findByRole('button', { name: '+ Add exercise' }));
    expect(screen.getByRole('heading', { name: 'New exercise' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    await user.click(screen.getByRole('button', { name: /^Quad Sets/ }));
    expect(screen.getByRole('heading', { name: 'Edit exercise' })).toBeInTheDocument();
  });
});
