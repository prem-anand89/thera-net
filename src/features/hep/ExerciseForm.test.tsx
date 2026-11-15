// @vitest-environment jsdom
import 'fake-indexeddb/auto';
import '@testing-library/jest-dom/vitest';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import type { Exercise } from '@/domain/hep';
import { db } from '@/lib/db';
import { ExerciseForm } from './ExerciseForm';

const saveExercise = vi.fn();
const exerciseUsage = vi.fn();
const mintUploadUrls = vi.fn();
const putBlob = vi.fn();
vi.mock('@/services/hepService', async (orig) => ({
  ...(await orig<typeof import('@/services/hepService')>()),
  hepService: { saveExercise: (...a: unknown[]) => saveExercise(...a), exerciseUsage: (...a: unknown[]) => exerciseUsage(...a) },
}));
vi.mock('@/services/hepMediaService', () => ({
  hepMediaService: { mintUploadUrls: (...a: unknown[]) => mintUploadUrls(...a), putBlob: (...a: unknown[]) => putBlob(...a), mintViewUrls: async () => ({}) },
}));
const compress = vi.fn(async (f: File) => new Blob([f.name], { type: f.type }));
vi.mock('@/lib/imageCompression', () => ({
  compressImageForUpload: (f: File) => compress(f),
  createThumbnailBlob: async () => new Blob(['thumb'], { type: 'image/webp' }),
}));
vi.mock('./PhotoEditor', () => ({
  PhotoEditor: ({ open, onDone }: { open: boolean; onDone: (b: Blob, changed: boolean) => void }) =>
    open ? <button type="button" onClick={() => onDone(new Blob(['adjusted'], { type: 'image/webp' }), true)}>finish adjusting</button> : null,
}));

beforeEach(() => {
  saveExercise.mockReset().mockResolvedValue('ex-new');
  exerciseUsage.mockReset().mockResolvedValue({ programs: 0, templates: 0 });
  mintUploadUrls.mockReset();
  compress.mockClear();
  putBlob.mockReset().mockResolvedValue(undefined);
  Object.defineProperty(navigator, 'onLine', { value: true, configurable: true });
  URL.createObjectURL = vi.fn(() => 'blob:preview');
  URL.revokeObjectURL = vi.fn();
});
afterEach(cleanup);

const saved = (over: Partial<Exercise> = {}): Exercise => ({
  id: 'e1', clinicId: 'c1', title: 'Wall Slides', positions: [], otherNames: ['wall slide'], bodyRegion: 'Shoulder', alsoRegions: ['Spine / Back'], equipment: ['Wall'], phase: 'mobility',
  instructions: 'Stand\nSlide', mediaType: 'none', mediaKeys: [], mediaCaptions: [], thumbKey: null, defaultSets: 3, doseType: 'reps', defaultReps: 10, defaultHoldSeconds: null,
  defaultDurationSeconds: null, defaultRestSeconds: 30, defaultSessionsPerDay: 2, side: 'none', stopIf: 'Sharp pain', isFavorite: false, active: true, deleted: false, version: 1, createdAt: '', updatedAt: '', ...over,
});

function renderForm(props: Partial<React.ComponentProps<typeof ExerciseForm>> = {}) {
  const onClose = vi.fn();
  const onSaved = vi.fn();
  render(<ExerciseForm open clinicId="c1" allExercises={[]} onClose={onClose} onSaved={onSaved} {...props} />);
  return { onClose, onSaved };
}
const saveButton = () => screen.getByRole('button', { name: /Save exercise|Needs a connection|Saving/ });

describe('ExerciseForm', () => {
  it('Save stays off until there is a name, a region and a valid dose', async () => {
    const user = userEvent.setup();
    renderForm();
    expect(saveButton()).toBeDisabled();
    await user.type(screen.getByLabelText('Name'), 'Bird dog');
    expect(saveButton()).toBeDisabled();
    await user.selectOptions(screen.getByLabelText('Body region'), 'Core');
    expect(saveButton()).toBeEnabled();
  });

  it('choosing Type Stretching pre-selects Reps with a hold; Timed shows Time and hides Reps and Hold', async () => {
    const user = userEvent.setup();
    renderForm();
    await user.selectOptions(screen.getByLabelText('Type'), 'stretching');
    expect(screen.getByRole('button', { name: 'Reps with a hold' })).toHaveAttribute('aria-pressed', 'true');
    await user.click(screen.getByRole('button', { name: 'Timed' }));
    expect(screen.getByRole('group', { name: 'Time' })).toBeInTheDocument();
    expect(screen.queryByRole('group', { name: 'Reps' })).toBeNull();
    expect(screen.queryByRole('group', { name: 'Hold each rep' })).toBeNull();
    // Once the person has chosen a kind themselves, a later change of Type no longer overrides it.
    await user.selectOptions(screen.getByLabelText('Type'), 'strengthening');
    expect(screen.getByRole('button', { name: 'Timed' })).toHaveAttribute('aria-pressed', 'true');
  });

  it('"The patient reads" follows the dose', async () => {
    const user = userEvent.setup();
    renderForm({ exercise: saved({ doseType: 'hold', defaultReps: 12, defaultHoldSeconds: 10, side: 'both', defaultSessionsPerDay: 2 }) });
    expect(screen.getByText('3 sets × 12 reps · hold each for 10 s · each side · twice a day · rest 30 s')).toBeInTheDocument();
    await user.click(within(screen.getByRole('group', { name: 'Sets' })).getByRole('button', { name: '2' }));
    expect(screen.getByText(/^2 sets × 12 reps/)).toBeInTheDocument();
  });

  it('one step per line becomes a numbered "Patient sees" list', async () => {
    const user = userEvent.setup();
    renderForm();
    await user.type(screen.getByLabelText(/^Steps/), 'Stand tall{enter}Slide up{enter}{enter}Come down');
    const list = screen.getByText('Patient sees').parentElement!;
    expect(within(list).getAllByRole('listitem').map((li) => li.textContent)).toEqual(['Stand tall', 'Slide up', 'Come down']);
  });

  it('warns "Similar: Clamshells (Hip)" without blocking the save', async () => {
    const user = userEvent.setup();
    renderForm({ allExercises: [saved({ id: 'x', title: 'Clamshells', bodyRegion: 'Hip' })] });
    await user.type(screen.getByLabelText('Name'), 'Clamshell');
    expect(screen.getByText(/Similar: Clamshells \(Hip\)/)).toBeInTheDocument();
    await user.selectOptions(screen.getByLabelText('Body region'), 'Hip');
    expect(saveButton()).toBeEnabled();
  });

  it('Save is disabled offline and says "Needs a connection"', () => {
    Object.defineProperty(navigator, 'onLine', { value: false, configurable: true });
    renderForm({ exercise: saved() });
    expect(saveButton()).toBeDisabled();
    expect(saveButton()).toHaveTextContent('Needs a connection');
  });

  it('Delete becomes Archive when the exercise is used, with the explanation', async () => {
    const user = userEvent.setup();
    exerciseUsage.mockResolvedValue({ programs: 2, templates: 1 });
    renderForm({ exercise: saved() });
    expect(await screen.findByText(/Used in 2 program items and 1 template item/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Delete' })).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Archive' }));
    expect(saveExercise).toHaveBeenCalledWith(expect.objectContaining({ id: 'e1', active: false, title: 'Wall Slides', stopIf: 'Sharp pain' }));
  });

  it('an unused exercise can be deleted', async () => {
    const user = userEvent.setup();
    renderForm({ exercise: saved() });
    await user.click(await screen.findByRole('button', { name: 'Delete' }));
    expect(saveExercise).toHaveBeenCalledWith(expect.objectContaining({ id: 'e1', deleted: true }));
  });

  it('an archived exercise offers Restore', async () => {
    const user = userEvent.setup();
    renderForm({ exercise: saved({ active: false }) });
    await user.click(screen.getByRole('button', { name: 'Restore' }));
    expect(saveExercise).toHaveBeenCalledWith(expect.objectContaining({ id: 'e1', active: true }));
  });

  it('one photo is not enough; two photos upload through signed links and the keys and thumbnail are saved', async () => {
    const user = userEvent.setup();
    mintUploadUrls.mockImplementation(async (_c: string, id: string, slots: Array<number | 'thumb'>) =>
      slots.map((s) => ({ slot: s, key: `clinics/c1/exercises/${id}/${s}-abcdefgh`, url: `https://r2.test/${s}`, headers: { 'Cache-Control': 'private, max-age=604800' } })));
    renderForm();
    await user.type(screen.getByLabelText('Name'), 'Bird dog');
    await user.selectOptions(screen.getByLabelText('Body region'), 'Core');
    const input = screen.getByLabelText('Choose photos or a GIF', { selector: 'input' });
    await user.upload(input, new File(['a'], 'start.jpg', { type: 'image/jpeg' }));
    expect(screen.getByText(/Add at least 2 photos/)).toBeInTheDocument();
    expect(saveButton()).toBeDisabled();
    await user.upload(input, new File(['b'], 'end.jpg', { type: 'image/jpeg' }));
    await user.type(screen.getByLabelText('Caption for picture 1'), 'Start');
    expect(saveButton()).toBeEnabled();
    await user.click(saveButton());
    await waitFor(() => expect(saveExercise).toHaveBeenCalled());
    const id = mintUploadUrls.mock.calls[0][1] as string;
    expect(mintUploadUrls).toHaveBeenCalledWith('c1', id, [0, 1, 'thumb']);
    expect(putBlob).toHaveBeenCalledTimes(3);
    expect(putBlob.mock.calls[0][0]).toMatchObject({ headers: { 'Cache-Control': 'private, max-age=604800' } });
    expect(saveExercise).toHaveBeenCalledWith(expect.objectContaining({
      id, clinicId: 'c1', title: 'Bird dog', bodyRegion: 'Core', mediaType: 'stills', mediaCaptions: ['Start', ''],
      mediaKeys: [`clinics/c1/exercises/${id}/0-abcdefgh`, `clinics/c1/exercises/${id}/1-abcdefgh`], thumbKey: `clinics/c1/exercises/${id}/thumb-abcdefgh`,
    }));
  });

  it('hands the saved exercise back (with its new id) and shows it in the local list at once', async () => {
    const user = userEvent.setup();
    await db.exercises.clear();
    saveExercise.mockResolvedValue('server-id');
    const { onSaved, onClose } = renderForm({ initialTitle: 'Bird dog' });
    expect(screen.getByLabelText('Name')).toHaveValue('Bird dog');
    await user.selectOptions(screen.getByLabelText('Body region'), 'Core');
    await user.click(saveButton());
    await waitFor(() => expect(onSaved).toHaveBeenCalled());
    expect(onSaved).toHaveBeenCalledWith('server-id', expect.objectContaining({ id: 'server-id', clinicId: 'c1', title: 'Bird dog', bodyRegion: 'Core', active: true, isFavorite: false }));
    expect((await db.exercises.get('server-id'))?.title).toBe('Bird dog');
    expect(onClose).toHaveBeenCalled();
  });

  it('an adjusted photo is uploaded as it is (not shrunk a second time) and a new key is used', async () => {
    const user = userEvent.setup();
    mintUploadUrls.mockImplementation(async (_c: string, id: string, slots: Array<number | 'thumb'>) =>
      slots.map((s) => ({ slot: s, key: `clinics/c1/exercises/${id}/${s}-abcdefgh`, url: `https://r2.test/${s}`, headers: {} })));
    renderForm();
    await user.type(screen.getByLabelText('Name'), 'Bird dog');
    await user.selectOptions(screen.getByLabelText('Body region'), 'Core');
    const input = screen.getByLabelText('Choose photos or a GIF', { selector: 'input' });
    await user.upload(input, [new File(['a'], 'start.jpg', { type: 'image/jpeg' }), new File(['b'], 'end.jpg', { type: 'image/jpeg' })]);
    await user.click(screen.getAllByRole('button', { name: 'Adjust or blur' })[0]);
    await user.click(await screen.findByRole('button', { name: 'finish adjusting' }));
    await user.click(saveButton());
    await waitFor(() => expect(saveExercise).toHaveBeenCalled());
    expect(compress.mock.calls.map((c) => c[0].name)).toEqual(['end.jpg']); // only the one that was not adjusted
    expect(putBlob).toHaveBeenCalledTimes(3);
  });

  it('shows the upload progress on the Save button while pictures go up', async () => {
    const user = userEvent.setup();
    mintUploadUrls.mockImplementation(async (_c: string, id: string, slots: Array<number | 'thumb'>) =>
      slots.map((s) => ({ slot: s, key: `clinics/c1/exercises/${id}/${s}-abcdefgh`, url: `https://r2.test/${s}`, headers: {} })));
    const release: Array<() => void> = [];
    putBlob.mockImplementation(() => new Promise<void>((resolve) => { release.push(resolve); }));
    renderForm();
    await user.type(screen.getByLabelText('Name'), 'Bird dog');
    await user.selectOptions(screen.getByLabelText('Body region'), 'Core');
    await user.upload(screen.getByLabelText('Choose photos or a GIF', { selector: 'input' }), [new File(['a'], 'start.jpg', { type: 'image/jpeg' }), new File(['b'], 'end.jpg', { type: 'image/jpeg' })]);
    await user.click(saveButton());
    expect(await screen.findByRole('button', { name: 'Uploading 1 of 3…' })).toBeDisabled();
    release[0]();
    expect(await screen.findByRole('button', { name: 'Uploading 2 of 3…' })).toBeInTheDocument();
    release[1](); release[2]();
    await waitFor(() => expect(saveExercise).toHaveBeenCalled());
  });

  it('a GIF is one picture and cannot be mixed with photos', async () => {
    const user = userEvent.setup();
    renderForm();
    const input = screen.getByLabelText('Choose photos or a GIF', { selector: 'input' });
    await user.upload(input, new File(['g'], 'move.gif', { type: 'image/gif' }));
    await user.upload(input, new File(['p'], 'still.jpg', { type: 'image/jpeg' }));
    expect(screen.getByText(/already has a GIF/)).toBeInTheDocument();
    expect(screen.getAllByLabelText(/Caption for picture/)).toHaveLength(1);
  });

  it('shows the database\'s own message when saving fails (for example the free-plan limit)', async () => {
    const user = userEvent.setup();
    saveExercise.mockRejectedValue(new Error('You have reached the free-plan limit of 10 exercises. Visit theranet.in to upgrade.'));
    renderForm();
    await user.type(screen.getByLabelText('Name'), 'Eleventh');
    await user.selectOptions(screen.getByLabelText('Body region'), 'Knee');
    await user.click(saveButton());
    expect(await screen.findByRole('alert')).toHaveTextContent('free-plan limit of 10 exercises');
  });

  it('Duplicate… turns the form into a new exercise with a copy name', async () => {
    const user = userEvent.setup();
    renderForm({ exercise: saved() });
    await user.click(screen.getByRole('button', { name: 'Duplicate…' }));
    expect(screen.getByRole('heading', { name: 'New exercise' })).toBeInTheDocument();
    expect(screen.getByLabelText('Name')).toHaveValue('Wall Slides (progression)');
    await user.click(saveButton());
    expect(saveExercise).toHaveBeenCalledWith(expect.objectContaining({ title: 'Wall Slides (progression)', id: expect.not.stringMatching(/^e1$/) }));
  });
});
