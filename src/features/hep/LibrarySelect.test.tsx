// @vitest-environment jsdom
import 'fake-indexeddb/auto';
import '@testing-library/jest-dom/vitest';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import { ClinicContext } from '@/app/clinicContext';
import type { Clinic } from '@/domain/types';
import type { Exercise } from '@/domain/hep';
import { db } from '@/lib/db';
import { LibraryTab } from './LibraryTab';
import { ExercisePicker } from './ExercisePicker';

const saveExercise = vi.fn();
const exerciseUsage = vi.fn();
vi.mock('@/services/hepService', async (orig) => ({
  ...(await orig<typeof import('@/services/hepService')>()),
  hepService: { toggleExerciseFavorite: vi.fn(), recentlyUsedExerciseIds: async () => [], exerciseUsage: (...a: unknown[]) => exerciseUsage(...a), saveExercise: (...a: unknown[]) => saveExercise(...a) },
}));
const publishMany = vi.fn();
vi.mock('@/services/starterLibraryService', async (orig) => ({
  ...(await orig<typeof import('@/services/starterLibraryService')>()),
  starterLibraryService: { publishMany: (...a: unknown[]) => publishMany(...a) },
}));
vi.mock('@/services/hepMediaService', () => ({ hepMediaService: { mintViewUrls: async () => ({}) } }));
vi.mock('@/app/useEntitlements', () => ({ useEntitlements: () => ({ tier: 'lite', enforcementEnabled: false }) }));

const clinic = { id: 'c1', name: 'Sunrise', timezone: 'Asia/Kolkata' } as unknown as Clinic;
const ex = (id: string, title: string, over: Partial<Exercise> = {}): Exercise => ({
  id, clinicId: 'c1', title, positions: [], otherNames: [], bodyRegion: 'Knee', alsoRegions: [], equipment: [], phase: 'strengthening', instructions: '', mediaType: 'none', mediaKeys: [], mediaCaptions: [],
  thumbKey: null, defaultSets: 3, doseType: 'reps', defaultReps: 10, defaultHoldSeconds: null, defaultDurationSeconds: null, defaultRestSeconds: 30, defaultSessionsPerDay: 1, side: 'none', stopIf: '',
  isFavorite: false, active: true, deleted: false, version: 1, createdAt: '', updatedAt: '', ...over,
});
const renderTab = () => render(<ClinicContext.Provider value={clinic}><LibraryTab /></ClinicContext.Provider>);

beforeEach(async () => {
  await db.exercises.clear();
  await db.exercises.bulkPut([ex('a', 'Alpha'), ex('b', 'Bravo'), ex('c', 'Charlie')]);
  saveExercise.mockReset().mockResolvedValue('x');
  publishMany.mockReset().mockResolvedValue({ published: 2, skipped: [] });
  exerciseUsage.mockReset().mockImplementation(async (id: string) => (id === 'b' ? { programs: 2, templates: 0 } : { programs: 0, templates: 0 }));
  localStorage.clear();
  Object.defineProperty(navigator, 'onLine', { value: true, configurable: true });
});
afterEach(cleanup);

async function enterSelect(user: ReturnType<typeof userEvent.setup>) {
  await screen.findByText('Alpha');
  await user.click(screen.getByRole('button', { name: 'Delete / archive' }));
}

describe('Library select mode', () => {
  it('toggles select mode, selects by card, and leaving clears the selection', async () => {
    const user = userEvent.setup();
    renderTab();
    await enterSelect(user);
    const bar = screen.getByRole('region', { name: 'Bulk actions' });
    expect(within(bar).getByText('0 selected')).toBeInTheDocument();
    await user.click(screen.getByText('Alpha'));
    expect(screen.getByRole('checkbox', { name: 'Select Alpha' })).toBeChecked();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument(); // did not open the editor
    expect(within(bar).getByText('1 selected')).toBeInTheDocument();
    await user.click(within(bar).getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByRole('region', { name: 'Bulk actions' })).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Delete / archive' }));
    expect(screen.getByText('0 selected')).toBeInTheDocument();
  });

  it('Escape leaves select mode', async () => {
    const user = userEvent.setup();
    renderTab();
    await enterSelect(user);
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('region', { name: 'Bulk actions' })).not.toBeInTheDocument();
  });

  it('selects by table row and selects all shown', async () => {
    const user = userEvent.setup();
    renderTab();
    await screen.findByText('Alpha');
    await user.click(screen.getByRole('button', { name: 'Table' }));
    await user.click(screen.getByRole('button', { name: 'Delete / archive' }));
    await user.click(screen.getByRole('checkbox', { name: 'Select Bravo' }));
    expect(screen.getByText('1 selected')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Select all 3 shown' }));
    expect(screen.getByText('3 selected')).toBeInTheDocument();
  });

  it('confirms the delete / archive split, then saves one after another with the right flags', async () => {
    const user = userEvent.setup();
    renderTab();
    await enterSelect(user);
    await user.click(screen.getByRole('button', { name: 'Select all 3 shown' }));
    await user.click(screen.getByRole('button', { name: 'Delete' }));
    expect(await screen.findByText('Delete 2 and archive 1?', {}, { timeout: 5000 })).toBeInTheDocument();
    expect(screen.getByText('Exercises used in programs or templates are archived, not deleted.')).toBeInTheDocument();
    let running = 0; let overlap = false;
    saveExercise.mockImplementation(async () => { running += 1; if (running > 1) overlap = true; await new Promise((r) => setTimeout(r, 5)); running -= 1; });
    await user.click(screen.getByRole('button', { name: 'Delete 2 · archive 1' }));
    await waitFor(() => expect(saveExercise).toHaveBeenCalledTimes(3));
    expect(overlap).toBe(false);
    const sent = saveExercise.mock.calls.map((c) => c[0] as { id: string; deleted?: boolean; active: boolean });
    expect(sent.filter((s) => s.deleted).map((s) => s.id).sort()).toEqual(['a', 'c']);
    expect(sent.find((s) => s.id === 'b')).toMatchObject({ active: false });
    expect(sent.find((s) => s.id === 'b')?.deleted).toBeUndefined();
    expect(await screen.findByText('Deleted 2, archived 1', {}, { timeout: 5000 })).toBeInTheDocument();
    expect(screen.queryByRole('region', { name: 'Bulk actions' })).not.toBeInTheDocument();
  });

  it('Archive archives the selection after its own confirmation, skipping archived ones', async () => {
    await db.exercises.put(ex('d', 'Delta', { active: false }));
    const user = userEvent.setup();
    renderTab();
    await screen.findByText('Alpha');
    await user.click(screen.getByRole('checkbox', { name: /Show archived/ }));
    await user.click(screen.getByRole('button', { name: 'Delete / archive' }));
    await user.click(screen.getByRole('button', { name: 'Select all 4 shown' }));
    await user.click(screen.getByRole('button', { name: 'Archive' }));
    expect(await screen.findByText('Archive 3 exercises?', {}, { timeout: 5000 })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Archive 3' }));
    await waitFor(() => expect(saveExercise).toHaveBeenCalledTimes(3));
    expect(saveExercise.mock.calls.every((c) => (c[0] as { active: boolean }).active === false)).toBe(true);
    expect(exerciseUsage).not.toHaveBeenCalled();
  });

  it('a partial failure keeps the failed exercise selected and says so', async () => {
    saveExercise.mockImplementation(async (i: { id: string }) => { if (i.id === 'c') throw new Error('nope'); });
    const user = userEvent.setup();
    renderTab();
    await enterSelect(user);
    await user.click(screen.getByRole('button', { name: 'Select all 3 shown' }));
    await user.click(screen.getByRole('button', { name: 'Delete' }));
    await user.click(await screen.findByRole('button', { name: 'Delete 2 · archive 1' }, { timeout: 5000 }));
    expect(await screen.findByText(/1 could not be changed and is still selected/, {}, { timeout: 5000 })).toBeInTheDocument();
    expect(screen.getByText('1 selected')).toBeInTheDocument();
    expect(screen.getByRole('checkbox', { name: 'Select Charlie' })).toBeChecked();
  });

  it('offers "Add to TheraNet Library" only to curator clinics, and publishes the picked exercises', async () => {
    const user = userEvent.setup();
    const curator = { ...clinic, starterCurator: true } as unknown as Clinic;
    render(<ClinicContext.Provider value={curator}><LibraryTab /></ClinicContext.Provider>);
    await enterSelect(user);
    await user.click(screen.getByRole('button', { name: 'Select all 3 shown' }));
    await user.click(screen.getByRole('button', { name: 'Add to TheraNet Library' }));
    const dlg = screen.getByRole('dialog', { name: 'Add to TheraNet Library?' });
    await user.click(within(dlg).getByRole('button', { name: 'Add to library' })); // no pictures: nothing to declare
    await waitFor(() => expect(publishMany).toHaveBeenCalledTimes(1));
    const [clinicId, picked, provenance] = publishMany.mock.calls[0] as [string, Exercise[], unknown];
    expect(clinicId).toBe('c1');
    expect(picked.map((e) => e.id).sort()).toEqual(['a', 'b', 'c']);
    expect(provenance).toEqual({ imageSource: null, imageNote: null });
    expect(await screen.findByText('Added 2 to the TheraNet Library.', {}, { timeout: 5000 })).toBeInTheDocument();
  });

  it('keeps skipped exercises selected and names them', async () => {
    publishMany.mockResolvedValue({ published: 1, skipped: [{ id: 'c', title: 'Charlie', reason: 'its pictures are hidden in lists' }] });
    const user = userEvent.setup();
    const curator = { ...clinic, starterCurator: true } as unknown as Clinic;
    render(<ClinicContext.Provider value={curator}><LibraryTab /></ClinicContext.Provider>);
    await enterSelect(user);
    await user.click(screen.getByRole('button', { name: 'Select all 3 shown' }));
    await user.click(screen.getByRole('button', { name: 'Add to TheraNet Library' }));
    await user.click(within(screen.getByRole('dialog', { name: 'Add to TheraNet Library?' })).getByRole('button', { name: 'Add to library' }));
    expect(await screen.findByText(/Not added: Charlie \(its pictures are hidden in lists\)/, {}, { timeout: 5000 })).toBeInTheDocument();
    expect(screen.getByText('1 selected')).toBeInTheDocument();
  });

  it('does not offer "Add to TheraNet Library" to other clinics', async () => {
    const user = userEvent.setup();
    renderTab();
    await enterSelect(user);
    expect(screen.queryByRole('button', { name: 'Add to TheraNet Library' })).toBeNull();
  });

  it('disables Archive and Delete offline', async () => {
    Object.defineProperty(navigator, 'onLine', { value: false, configurable: true });
    const user = userEvent.setup();
    renderTab();
    await enterSelect(user);
    await user.click(screen.getByText('Alpha'));
    expect(screen.getByRole('button', { name: 'Delete' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Delete' })).toHaveAttribute('title', 'Needs a connection');
    expect(screen.getByRole('button', { name: 'Archive' })).toBeDisabled();
  });

  it('the picker has no Select button', async () => {
    render(
      <ClinicContext.Provider value={clinic}>
        <ExercisePicker open onAdd={() => {}} onClose={() => {}} />
      </ClinicContext.Provider>,
    );
    await screen.findByText('Alpha');
    expect(screen.queryByRole('button', { name: 'Delete / archive' })).not.toBeInTheDocument();
  });
});
