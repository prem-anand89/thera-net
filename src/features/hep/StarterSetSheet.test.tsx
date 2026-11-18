// @vitest-environment jsdom
import 'fake-indexeddb/auto';
import '@testing-library/jest-dom/vitest';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import { ClinicContext } from '@/app/clinicContext';
import type { Clinic } from '@/domain/types';
import type { Exercise } from '@/domain/hep';
import { STARTER_EXERCISES } from '@/domain/hepStarterSet';
import { db } from '@/lib/db';
import { StarterSetSheet } from './StarterSetSheet';
import { exerciseFromSaveInput, starterToSaveInput } from './starterSet';
import { exerciseToSaveInput } from './exerciseSaveInput';

const saveExercise = vi.fn();
const recordExerciseOrigin = vi.fn();
vi.mock('@/services/hepService', async (orig) => ({
  ...(await orig<typeof import('@/services/hepService')>()),
  hepService: { saveExercise: (...a: unknown[]) => saveExercise(...a), recordExerciseOrigin: (...a: unknown[]) => recordExerciseOrigin(...a) },
}));
const plan = vi.hoisted(() => ({ value: { tier: 'lite', enforcementEnabled: false } }));
vi.mock('@/app/useEntitlements', () => ({ useEntitlements: () => plan.value }));
const cloneFromStarter = vi.fn();
const mintStarterViewUrls = vi.fn();
vi.mock('@/services/hepMediaService', () => ({
  hepMediaService: {
    cloneFromStarter: (...a: unknown[]) => cloneFromStarter(...a),
    mintStarterViewUrls: (...a: unknown[]) => mintStarterViewUrls(...a),
  },
}));
const listStarterItems = vi.fn();
vi.mock('@/services/starterLibraryService', async (orig) => {
  const actual = await orig<typeof import('@/services/starterLibraryService')>();
  return {
    ...actual,
    starterLibraryService: { ...actual.starterLibraryService, listStarterItems: (...a: unknown[]) => listStarterItems(...a) },
  };
});
const clinic = { id: 'c1', name: 'Sunrise', timezone: 'UTC' } as unknown as Clinic;
const ex = (id: string, title: string): Exercise => ({
  id, clinicId: 'c1', title, positions: [], otherNames: [], bodyRegion: 'Knee', alsoRegions: [], equipment: [], phase: 'strengthening', instructions: '', mediaType: 'none', mediaKeys: [], mediaCaptions: [], thumbKey: null,
  defaultSets: 3, doseType: 'reps', defaultReps: 10, defaultHoldSeconds: null, defaultDurationSeconds: null, defaultRestSeconds: 30, defaultSessionsPerDay: 1, side: 'none', stopIf: '', isFavorite: false, active: true, deleted: false, version: 1, createdAt: '', updatedAt: '',
});
const dbItem = (id: string, title: string) => ({
  id, sourceClinicId: 'c-bm', sourceExerciseId: `src-${id}`, title, otherNames: [], bodyRegion: 'Hip', alsoRegions: [],
  phase: 'stretching', alsoPhases: [], positions: [], equipment: [], instructions: 'Kneel\nLean', stopIf: '',
  mediaType: 'none', mediaKeys: [], mediaCaptions: [], thumbKey: null, doseType: 'hold', defaultSets: 1, defaultReps: 3,
  defaultHoldSeconds: 30, defaultDurationSeconds: null, defaultRestSeconds: 30, defaultSessionsPerDay: 1, side: 'both',
  publishedAt: '2026-11-18T00:00:00Z',
});

function renderSheet() {
  const onClose = vi.fn();
  render(<ClinicContext.Provider value={clinic}><StarterSetSheet open onClose={onClose} /></ClinicContext.Provider>);
  return { onClose };
}
beforeEach(async () => {
  await db.exercises.clear();
  let n = 0;
  saveExercise.mockReset().mockImplementation(async () => `id-${++n}`);
  recordExerciseOrigin.mockReset().mockResolvedValue(undefined);
  plan.value = { tier: 'lite', enforcementEnabled: false };
  cloneFromStarter.mockReset().mockResolvedValue({ mediaKeys: [], thumbKey: null });
  mintStarterViewUrls.mockReset().mockResolvedValue({});
  const { staticStarterItems } = await import('@/services/starterLibraryService');
  listStarterItems.mockReset().mockResolvedValue(staticStarterItems());
  Object.defineProperty(navigator, 'onLine', { value: true, configurable: true });
});
afterEach(cleanup);

describe('StarterSetSheet', () => {
  it('copies only the ticked exercises into the clinic, text only, with their steps and dose', async () => {
    const user = userEvent.setup();
    const { onClose } = renderSheet();
    await user.click(await screen.findByLabelText(/^Quad Sets/));
    await user.click(screen.getByLabelText(/^Chin Tucks/));
    await user.click(screen.getByRole('button', { name: 'Add 2 exercises' }));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(saveExercise).toHaveBeenCalledTimes(2);
    const quad = saveExercise.mock.calls.map((c) => c[0]).find((i) => i.title === 'Quad Sets');
    expect(quad).toMatchObject({ clinicId: 'c1', bodyRegion: 'Knee', phase: 'activation', mediaType: 'none', mediaKeys: [], doseType: 'hold', defaultSets: 3, defaultReps: 12, defaultHoldSeconds: 10, defaultSessionsPerDay: 3, equipment: ['Towel'] });
    expect(quad.instructions.split('\n').length).toBeGreaterThanOrEqual(2);
    expect(await db.exercises.count()).toBe(2); // shown in the local list at once
  });

  it('exercises the clinic already has (same name) are shown but not offered again', async () => {
    await db.exercises.put(ex('e1', 'Quad Sets'));
    renderSheet();
    const box = await screen.findByLabelText(/^Quad Sets/);
    await waitFor(() => expect(box).toBeDisabled()); // once the local list has loaded
    expect(box).toBeChecked();
    expect(screen.getByText('Already in your Library')).toBeInTheDocument();
  });

  it('Select all picks a whole region (and Clear undoes it)', async () => {
    const user = userEvent.setup();
    renderSheet();
    const knee = await screen.findByRole('region', { name: 'Knee' });
    const kneeCount = STARTER_EXERCISES.filter((s) => s.region === 'Knee').length;
    await user.click(within(knee).getByRole('button', { name: `Select all (${kneeCount})` }));
    expect(screen.getByRole('button', { name: `Add ${kneeCount} exercises` })).toBeEnabled();
    await user.click(within(knee).getByRole('button', { name: 'Clear' }));
    expect(screen.getByRole('button', { name: 'Add exercises' })).toBeDisabled();
  });

  it('if the free-plan cap stops it part-way, what was added stays and the message says how many', async () => {
    const user = userEvent.setup();
    let n = 0;
    saveExercise.mockImplementation(async () => { if (++n > 1) throw new Error('You have reached the free-plan limit of 10 exercises. Visit theranet.in to upgrade.'); return 'id-1'; });
    const { onClose } = renderSheet();
    await user.click(await screen.findByLabelText(/^Quad Sets/));
    await user.click(screen.getByLabelText(/^Chin Tucks/));
    await user.click(screen.getByRole('button', { name: 'Add 2 exercises' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Added 1 of 2. You have reached the free-plan limit of 10 exercises.');
    expect(onClose).not.toHaveBeenCalled();
    expect(await db.exercises.count()).toBe(1);
    expect(screen.getByRole('button', { name: 'Add 1 exercise' })).toBeEnabled(); // the one left can be tried again
  });

  it('needs a connection', async () => {
    Object.defineProperty(navigator, 'onLine', { value: false, configurable: true });
    renderSheet();
    await screen.findByLabelText(/^Quad Sets/);
    expect(screen.getByRole('button', { name: 'Needs a connection' })).toBeDisabled();
  });

  it('shows pictured Starter items with signed thumbnails and clones Starter images into the clinic on add', async () => {
    const user = userEvent.setup();
    listStarterItems.mockResolvedValue([
      {
        id: 'st-pic-1', sourceClinicId: 'c-bm', sourceExerciseId: 'ex-src',
        title: 'Hip Flexor Stretch', otherNames: [], bodyRegion: 'Hip', alsoRegions: [],
        phase: 'stretching', alsoPhases: ['mobility'], positions: ['Kneeling'], equipment: ['Mat'],
        instructions: 'Kneel\nLean', stopIf: 'Sharp pain',
        mediaType: 'stills', mediaKeys: ['starter/exercises/st-pic-1/0-aaaa', 'starter/exercises/st-pic-1/1-bbbb'],
        mediaCaptions: ['Start', 'End'], thumbKey: 'starter/exercises/st-pic-1/thumb-cccc',
        doseType: 'hold', defaultSets: 1, defaultReps: 3, defaultHoldSeconds: 30, defaultDurationSeconds: null,
        defaultRestSeconds: 30, defaultSessionsPerDay: 1, side: 'both', publishedAt: '2026-11-18T00:00:00Z',
      },
    ]);
    mintStarterViewUrls.mockResolvedValue({ 'starter/exercises/st-pic-1/1-bbbb': 'https://img.test/end.webp' });
    cloneFromStarter.mockResolvedValue({
      mediaKeys: ['clinics/c1/exercises/new-id/0-1111', 'clinics/c1/exercises/new-id/1-2222'],
      thumbKey: 'clinics/c1/exercises/new-id/thumb-3333',
    });

    const { onClose } = renderSheet();
    await waitFor(() => expect(mintStarterViewUrls).toHaveBeenCalledWith('c1', ['starter/exercises/st-pic-1/1-bbbb']));
    await user.click(await screen.findByLabelText(/^Hip Flexor Stretch/));
    await user.click(screen.getByRole('button', { name: 'Add 1 exercise' }));

    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(cloneFromStarter).toHaveBeenCalledWith(
      'c1',
      expect.any(String),
      ['starter/exercises/st-pic-1/0-aaaa', 'starter/exercises/st-pic-1/1-bbbb'],
      'starter/exercises/st-pic-1/thumb-cccc',
    );
    expect(saveExercise).toHaveBeenCalledWith(expect.objectContaining({
      title: 'Hip Flexor Stretch',
      mediaType: 'stills',
      mediaKeys: ['clinics/c1/exercises/new-id/0-1111', 'clinics/c1/exercises/new-id/1-2222'],
      thumbKey: 'clinics/c1/exercises/new-id/thumb-3333',
      alsoPhases: ['mobility'],
      pictureConsent: true,
    }));
  });
});

describe('starterToSaveInput', () => {
  it('turns every starter exercise into a request the database accepts (kind and numbers agree)', () => {
    for (const s of STARTER_EXERCISES) {
      const i = starterToSaveInput('c1', s);
      if (i.doseType === 'timed') expect([i.defaultReps, i.defaultHoldSeconds]).toEqual([null, null]);
      if (i.doseType === 'reps') expect([i.defaultHoldSeconds, i.defaultDurationSeconds]).toEqual([null, null]);
      if (i.doseType === 'hold') expect(i.defaultHoldSeconds).not.toBeNull();
      expect(i.mediaKeys).toEqual([]);
    }
  });
  it("carries each starter's positions into the save request and into the local row", () => {
    for (const s of STARTER_EXERCISES) {
      const i = starterToSaveInput('c1', s);
      expect(i.positions).toEqual(s.positions);
      expect(exerciseFromSaveInput(i, 'x').positions).toEqual(s.positions);
    }
  });

  it("keeps an exercise's positions when it is sent back (archive, restore, delete)", () => {
    expect(exerciseToSaveInput({ ...ex('e1', 'Bridge'), positions: ['Supine'] }).positions).toEqual(['Supine']);
    expect(exerciseToSaveInput({ ...ex('e1', 'Bridge'), positions: undefined as unknown as string[] }).positions).toEqual([]);
  });

  it('records which library item a copy came from, but not for built-in items', async () => {
    const user = userEvent.setup();
    listStarterItems.mockResolvedValue([dbItem('11111111-1111-4111-8111-111111111111', 'Library Test Exercise')]);
    const { onClose } = renderSheet();
    await user.click(await screen.findByLabelText(/^Library Test Exercise/));
    await user.click(screen.getByRole('button', { name: 'Add 1 exercise' }));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(recordExerciseOrigin).toHaveBeenCalledWith('c1', 'id-1', '11111111-1111-4111-8111-111111111111', '2026-11-18T00:00:00Z');
  });

  it('a built-in item has nothing to link to, so no origin is recorded', async () => {
    const user = userEvent.setup();
    const { onClose } = renderSheet();
    await user.click(await screen.findByLabelText(/^Quad Sets/));
    await user.click(screen.getByRole('button', { name: 'Add 1 exercise' }));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(recordExerciseOrigin).not.toHaveBeenCalled();
  });

  it('the add still succeeds when recording the origin fails (it tries twice)', async () => {
    const user = userEvent.setup();
    recordExerciseOrigin.mockRejectedValue(new Error('offline'));
    listStarterItems.mockResolvedValue([dbItem('22222222-2222-4222-8222-222222222222', 'Library Test Exercise')]);
    const { onClose } = renderSheet();
    await user.click(await screen.findByLabelText(/^Library Test Exercise/));
    await user.click(screen.getByRole('button', { name: 'Add 1 exercise' }));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(recordExerciseOrigin).toHaveBeenCalledTimes(2);
    expect(await db.exercises.count()).toBe(1);
  });

  it('on a free plan it shows the room left and stops ticking beyond it', async () => {
    const user = userEvent.setup();
    plan.value = { tier: 'lite', enforcementEnabled: true };
    await db.exercises.bulkPut(Array.from({ length: 8 }, (_, i) => ex(`seed${i}`, `Seed exercise ${i}`)));
    renderSheet();
    expect(await screen.findByText('Free plan: room for 2 more exercises.', {}, { timeout: 5000 })).toBeInTheDocument();
    await user.click(await screen.findByLabelText(/^Quad Sets/));
    await user.click(screen.getByLabelText(/^Chin Tucks/));
    expect(screen.getByLabelText(/^Pendulum Swings/)).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Add 2 exercises' })).toBeEnabled();
  });

  it('on a free plan at its limit it says so and offers nothing to tick', async () => {
    plan.value = { tier: 'lite', enforcementEnabled: true };
    await db.exercises.bulkPut(Array.from({ length: 10 }, (_, i) => ex(`seed${i}`, `Seed exercise ${i}`)));
    renderSheet();
    expect(await screen.findByText('You have reached the free-plan limit of 10 exercises. Visit theranet.in to upgrade.', {}, { timeout: 5000 })).toBeInTheDocument();
    await waitFor(() => expect(screen.getByLabelText(/^Quad Sets/)).toBeDisabled());
  });
});
