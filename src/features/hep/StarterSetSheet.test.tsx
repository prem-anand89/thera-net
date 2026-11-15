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
import { starterToSaveInput } from './starterSet';

const saveExercise = vi.fn();
vi.mock('@/services/hepService', async (orig) => ({ ...(await orig<typeof import('@/services/hepService')>()), hepService: { saveExercise: (...a: unknown[]) => saveExercise(...a) } }));
const clinic = { id: 'c1', name: 'Sunrise', timezone: 'UTC' } as unknown as Clinic;
const ex = (id: string, title: string): Exercise => ({
  id, clinicId: 'c1', title, positions: [], otherNames: [], bodyRegion: 'Knee', alsoRegions: [], equipment: [], phase: 'strengthening', instructions: '', mediaType: 'none', mediaKeys: [], mediaCaptions: [], thumbKey: null,
  defaultSets: 3, doseType: 'reps', defaultReps: 10, defaultHoldSeconds: null, defaultDurationSeconds: null, defaultRestSeconds: 30, defaultSessionsPerDay: 1, side: 'none', stopIf: '', isFavorite: false, active: true, deleted: false, version: 1, createdAt: '', updatedAt: '',
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
});
