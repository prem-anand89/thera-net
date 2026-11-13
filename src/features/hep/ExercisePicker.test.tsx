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
import { ExercisePicker } from './ExercisePicker';

const saveExercise = vi.fn();
vi.mock('@/services/hepService', async (orig) => ({
  ...(await orig<typeof import('@/services/hepService')>()),
  hepService: { saveExercise: (...a: unknown[]) => saveExercise(...a), recentlyUsedExerciseIds: async () => [], exerciseUsage: async () => ({ programs: 0, templates: 0 }) },
}));
vi.mock('@/services/hepMediaService', () => ({ hepMediaService: { mintViewUrls: async () => ({}), mintUploadUrls: vi.fn(), putBlob: vi.fn() } }));

const clinic = { id: 'c1', name: 'Sunrise', timezone: 'Asia/Kolkata' } as unknown as Clinic;
const ex = (id: string, title: string, over: Partial<Exercise> = {}): Exercise => ({
  id, clinicId: 'c1', title, otherNames: [], bodyRegion: 'Knee', alsoRegions: [], equipment: [], phase: 'strengthening', instructions: '', mediaType: 'none', mediaKeys: [], mediaCaptions: [],
  thumbKey: null, defaultSets: 3, doseType: 'reps', defaultReps: 10, defaultHoldSeconds: null, defaultDurationSeconds: null, defaultRestSeconds: 30, defaultSessionsPerDay: 1, side: 'none', stopIf: '',
  isFavorite: false, active: true, deleted: false, version: 1, createdAt: '', updatedAt: '', ...over,
});
function renderPicker(props: Partial<React.ComponentProps<typeof ExercisePicker>> = {}) {
  const onAdd = vi.fn();
  const onClose = vi.fn();
  render(<ClinicContext.Provider value={clinic}><ExercisePicker open onClose={onClose} onAdd={onAdd} {...props} /></ClinicContext.Provider>);
  return { onAdd, onClose };
}

beforeEach(async () => {
  await db.exercises.clear();
  await db.exercises.bulkPut([ex('1', 'Quad Sets'), ex('2', 'Wall Slides', { bodyRegion: 'Shoulder' }), ex('3', 'Sit to Stand')]);
  saveExercise.mockReset().mockResolvedValue('new-id');
  Object.defineProperty(navigator, 'onLine', { value: true, configurable: true });
});
afterEach(cleanup);

describe('ExercisePicker', () => {
  it('selecting two cards enables "Add 2 exercises", which hands them back in the order ticked', async () => {
    const user = userEvent.setup();
    const { onAdd, onClose } = renderPicker();
    const add = await screen.findByRole('button', { name: 'Add exercises' });
    expect(add).toBeDisabled();
    await user.click(await screen.findByRole('button', { name: /^Wall Slides/ }));
    await user.click(screen.getByRole('button', { name: /^Quad Sets/ }));
    expect(screen.getByRole('button', { name: 'Add 2 exercises' })).toBeEnabled();
    await user.click(screen.getByRole('button', { name: 'Add 2 exercises' }));
    expect(onAdd.mock.calls[0][0].map((e: Exercise) => e.title)).toEqual(['Wall Slides', 'Quad Sets']);
    expect(onClose).toHaveBeenCalled();
  });

  it('ticking again unticks, and the basket lists what is chosen', async () => {
    const user = userEvent.setup();
    renderPicker();
    const row = await screen.findByRole('button', { name: /^Quad Sets/ });
    await user.click(row);
    expect(screen.getByRole('complementary', { name: 'Chosen exercises' })).toHaveTextContent('1 chosen');
    await user.click(row);
    expect(screen.getByRole('complementary', { name: 'Chosen exercises' })).toHaveTextContent('Nothing chosen yet');
  });

  it('exercises already in the program are shown but cannot be ticked', async () => {
    renderPicker({ disabledIds: new Set(['1']) });
    expect(await screen.findByRole('button', { name: /^Quad Sets/ })).toBeDisabled();
    expect(screen.getByText('Already in the program')).toBeInTheDocument();
  });

  it('typing an unknown name offers "+ New exercise", and Save and add saves it then adds it with the ticked ones', async () => {
    const user = userEvent.setup();
    const { onAdd } = renderPicker();
    await user.click(await screen.findByRole('button', { name: /^Sit to Stand/ }));
    await user.type(screen.getByRole('searchbox', { name: 'Search exercises' }), 'Bird dog');
    await user.click(screen.getByRole('button', { name: '+ New exercise “Bird dog”' }));
    expect(screen.getByLabelText('Name')).toHaveValue('Bird dog');
    await user.selectOptions(screen.getByLabelText('Body region'), 'Core');
    await user.click(screen.getByRole('button', { name: 'Save and add' }));
    await waitFor(() => expect(onAdd).toHaveBeenCalled());
    expect(saveExercise).toHaveBeenCalledWith(expect.objectContaining({ title: 'Bird dog', bodyRegion: 'Core' }));
    expect(onAdd.mock.calls[0][0].map((e: Exercise) => e.title)).toEqual(['Sit to Stand', 'Bird dog']);
  });

  it('says so when the Library is empty', async () => {
    await db.exercises.clear();
    renderPicker();
    expect(await screen.findByText(/Your Library is empty/)).toBeInTheDocument();
  });
});
