// @vitest-environment jsdom
import 'fake-indexeddb/auto';
import '@testing-library/jest-dom/vitest';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import type { Exercise, StarterLibraryItem } from '@/domain/hep';
import { ExerciseForm } from './ExerciseForm';

let clinic = { id: 'c1', name: 'Beyond Mechanics', starterCurator: true, timezone: 'Asia/Kolkata' };
vi.mock('@/app/clinicContext', () => ({ useClinic: () => clinic }));
vi.mock('@/services/hepService', async (orig) => ({
  ...(await orig<typeof import('@/services/hepService')>()),
  hepService: { saveExercise: vi.fn(async () => 'e1'), exerciseUsage: vi.fn(async () => ({ programs: 0, templates: 0 })) },
}));
vi.mock('@/services/hepMediaService', () => ({
  hepMediaService: { mintUploadUrls: vi.fn(), putBlob: vi.fn(), mintViewUrls: async () => ({}) },
}));

const findPublishedForExercise = vi.fn();
const publishExercise = vi.fn();
const unpublishExercise = vi.fn();
vi.mock('@/services/starterLibraryService', () => ({
  starterLibraryService: {
    findPublishedForExercise: (...a: unknown[]) => findPublishedForExercise(...a),
    publishExercise: (...a: unknown[]) => publishExercise(...a),
    unpublishExercise: (...a: unknown[]) => unpublishExercise(...a),
  },
}));

const saved = (over: Partial<Exercise> = {}): Exercise => ({
  id: 'e1', clinicId: 'c1', title: 'Hip Flexor Stretch', positions: ['Kneeling'], otherNames: [],
  bodyRegion: 'Hip', alsoRegions: [], equipment: ['Mat'], phase: 'stretching', alsoPhases: [],
  instructions: 'Kneel\nLean', mediaType: 'stills',
  mediaKeys: ['clinics/c1/exercises/e1/0-aaaaaaaa'], mediaCaptions: ['Start'], thumbKey: 'clinics/c1/exercises/e1/thumb-bbbbbbbb',
  defaultSets: 1, doseType: 'hold', defaultReps: 3, defaultHoldSeconds: 30, defaultDurationSeconds: null,
  defaultRestSeconds: 30, defaultSessionsPerDay: 1, side: 'both', stopIf: 'Sharp pain',
  isFavorite: false, active: true, deleted: false, version: 1, createdAt: '', updatedAt: '', ...over,
});

beforeEach(() => {
  clinic = { id: 'c1', name: 'Beyond Mechanics', starterCurator: true, timezone: 'Asia/Kolkata' };
  findPublishedForExercise.mockReset().mockResolvedValue(null);
  publishExercise.mockReset().mockResolvedValue('st-1');
  unpublishExercise.mockReset().mockResolvedValue(undefined);
  Object.defineProperty(navigator, 'onLine', { value: true, configurable: true });
});
afterEach(cleanup);

describe('ExerciseForm: Starter library curator controls', () => {
  it('lets Beyond Mechanics & Physio Clinic publish, update and remove an exercise from Starter library', async () => {
    const user = userEvent.setup();
    const ex = saved();
    render(<ExerciseForm open clinicId="c1" exercise={ex} allExercises={[ex]} onClose={vi.fn()} onSaved={vi.fn()} />);

    const shareBtn = await screen.findByRole('button', { name: 'Share to Starter library' });
    await user.click(shareBtn);

    const dlg = screen.getByRole('dialog', { name: 'Share to Starter library?' });
    await user.click(within(dlg).getByRole('button', { name: 'Share to Starter' }));
    await waitFor(() => expect(publishExercise).toHaveBeenCalledWith('c1', ex, undefined));

    expect(await screen.findByRole('status')).toHaveTextContent('Shared to Starter library.');
    expect(screen.getByRole('button', { name: 'Update in Starter library' })).toBeInTheDocument();

    const rmBtn = screen.getByRole('button', { name: 'Remove from Starter' });
    await user.click(rmBtn);
    await waitFor(() => expect(unpublishExercise).toHaveBeenCalledWith('c1', 'st-1'));
    expect(await screen.findByRole('status')).toHaveTextContent('Removed from Starter library.');
  });

  it('hides Starter library curator controls for non-curator clinics (even if named Physio Clinic)', () => {
    clinic = { id: 'c1', name: 'Physio Clinic', starterCurator: false, timezone: 'Asia/Kolkata' };
    const ex = saved();
    render(<ExerciseForm open clinicId="c1" exercise={ex} allExercises={[ex]} onClose={vi.fn()} onSaved={vi.fn()} />);
    expect(screen.queryByRole('button', { name: /Starter library/i })).toBeNull();
  });

  it('shows Update and published date when already shared in Starter library', async () => {
    findPublishedForExercise.mockResolvedValue({ id: 'st-7', publishedAt: '2026-11-18T00:00:00Z' } as StarterLibraryItem);
    const ex = saved();
    render(<ExerciseForm open clinicId="c1" exercise={ex} allExercises={[ex]} onClose={vi.fn()} onSaved={vi.fn()} />);
    expect(await screen.findByRole('button', { name: 'Update in Starter library' })).toBeInTheDocument();
  });
});
