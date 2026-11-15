// @vitest-environment jsdom
import 'fake-indexeddb/auto';
import '@testing-library/jest-dom/vitest';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import type { UserEvent } from '@testing-library/user-event';
import { EXERCISE_TYPE_DEFINITIONS, type Exercise } from '@/domain/hep';
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
vi.mock('@/app/clinicContext', () => ({ useClinic: () => ({ id: 'c1', timezone: 'Asia/Kolkata' }) }));
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
const SECTIONS = ['Exercise details', 'Media and instructions', 'Default dosage', 'Classification'];
/** The folding header of a section (the one button that carries aria-expanded for it). */
const sectionButton = (title: string) => {
  const b = screen.getAllByRole('button').find((el) => el.hasAttribute('aria-expanded') && el.textContent?.includes(title));
  if (!b) throw new Error(`No section header "${title}"`);
  return b;
};
const expanded = () => SECTIONS.filter((t) => sectionButton(t).getAttribute('aria-expanded') === 'true');
async function openSection(user: UserEvent, title: string) {
  if (sectionButton(title).getAttribute('aria-expanded') !== 'true') await user.click(sectionButton(title));
}
const pill = (group: string, name: string) => within(screen.getByRole('group', { name: group })).getByRole('button', { name });
async function nameAndRegion(user: UserEvent, name = 'Bird dog', region = 'Core') {
  await openSection(user, 'Exercise details');
  if (name) await user.type(screen.getByLabelText('Exercise name'), name);
  await user.click(pill('Body region', region));
}

describe('ExerciseForm: sections', () => {
  it('a new exercise opens on Exercise details only; the other three are folded', () => {
    renderForm();
    expect(screen.getByRole('heading', { name: 'New exercise' })).toBeInTheDocument();
    expect(expanded()).toEqual(['Exercise details']);
    expect(sectionButton('Classification')).toHaveTextContent('Not set');
  });

  it('"Next: Media and instructions ›" folds Exercise details into its summary and opens the next one', async () => {
    const user = userEvent.setup();
    renderForm();
    await nameAndRegion(user);
    await user.click(pill('Type', 'Strengthening'));
    expect(screen.getByText(EXERCISE_TYPE_DEFINITIONS.strengthening)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Next: Media and instructions ›' }));
    expect(expanded()).toEqual(['Media and instructions']);
    expect(sectionButton('Exercise details')).toHaveTextContent('Bird dog · Core · Strengthening');
    expect(sectionButton('Exercise details')).toHaveTextContent('✓');
  });

  it('opening one section folds the others; the last one ends with Done', async () => {
    const user = userEvent.setup();
    renderForm();
    await user.click(sectionButton('Classification'));
    expect(expanded()).toEqual(['Classification']);
    await user.click(screen.getByRole('button', { name: 'Done' }));
    expect(expanded()).toEqual([]);
  });

  it('summaries: photos, steps and precautions; dosage; classification', async () => {
    const user = userEvent.setup();
    renderForm({ exercise: saved({ positions: ['Supine', 'Sitting'], otherNames: ['SLR'], alsoRegions: ['Hip'], equipment: ['Towel'], instructions: 'Lie down\nLift\nLower' }) });
    expect(sectionButton('Media and instructions')).toHaveTextContent('No media · 3 steps · precautions set');
    expect(sectionButton('Default dosage')).toHaveTextContent('3 sets × 10 reps · twice a day · rest 30 s');
    expect(sectionButton('Classification')).toHaveTextContent('Supine · Sitting · Towel · + Hip · “SLR”');
    await openSection(user, 'Classification');
    expect(pill('Position', 'Supine')).toHaveAttribute('aria-pressed', 'true');
  });
});

describe('ExerciseForm: fields', () => {
  it('Save stays off until there is a name, a region and a valid dose', async () => {
    const user = userEvent.setup();
    renderForm();
    expect(saveButton()).toBeDisabled();
    await user.type(screen.getByLabelText('Exercise name'), 'Bird dog');
    expect(saveButton()).toBeDisabled();
    await user.click(pill('Body region', 'Core'));
    expect(saveButton()).toBeEnabled();
  });

  it('"Other region…" reveals the region name box', async () => {
    const user = userEvent.setup();
    renderForm();
    await user.type(screen.getByLabelText('Exercise name'), 'Jaw glide');
    await user.click(pill('Body region', 'Other region…'));
    await user.type(screen.getByLabelText('New region name'), 'TMJ');
    await user.click(saveButton());
    await waitFor(() => expect(saveExercise).toHaveBeenCalledWith(expect.objectContaining({ bodyRegion: 'TMJ' })));
  });

  it('Save sends the positions chosen under Classification', async () => {
    const user = userEvent.setup();
    renderForm();
    await nameAndRegion(user);
    await openSection(user, 'Classification');
    await user.click(pill('Position', 'Supine'));
    expect(sectionButton('Classification')).toHaveTextContent('✓');
    await user.click(saveButton());
    await waitFor(() => expect(saveExercise).toHaveBeenCalledWith(expect.objectContaining({ positions: ['Supine'] })));
  });

  it('choosing Type Stretching pre-selects Repetitions with hold; Timed shows Duration and hides Repetitions and Hold', async () => {
    const user = userEvent.setup();
    renderForm();
    await user.click(pill('Type', 'Stretching'));
    await openSection(user, 'Default dosage');
    expect(screen.getByRole('button', { name: 'Repetitions with hold' })).toHaveAttribute('aria-pressed', 'true');
    await user.click(screen.getByRole('button', { name: 'Timed' }));
    expect(screen.getByRole('group', { name: 'Duration' })).toBeInTheDocument();
    expect(screen.queryByRole('group', { name: 'Repetitions' })).toBeNull();
    expect(screen.queryByRole('group', { name: 'Hold' })).toBeNull();
    // Once the person has chosen a kind themselves, a later change of Type no longer overrides it.
    await openSection(user, 'Exercise details');
    await user.click(pill('Type', 'Strengthening'));
    await openSection(user, 'Default dosage');
    expect(screen.getByRole('button', { name: 'Timed' })).toHaveAttribute('aria-pressed', 'true');
  });

  it('"The patient reads" follows the dose', async () => {
    const user = userEvent.setup();
    renderForm({ exercise: saved({ doseType: 'hold', defaultReps: 12, defaultHoldSeconds: 10, side: 'both', defaultSessionsPerDay: 2 }) });
    await openSection(user, 'Default dosage');
    expect(screen.getAllByText('3 sets × 12 reps · hold each for 10 s · each side · twice a day · rest 30 s').length).toBeGreaterThan(0);
    await user.click(within(screen.getByRole('group', { name: 'Sets' })).getByRole('button', { name: '2' }));
    expect(screen.getAllByText(/^2 sets × 12 reps/).length).toBeGreaterThan(0);
  });

  it('one step per line becomes a numbered "Patient sees" list', async () => {
    const user = userEvent.setup();
    renderForm();
    await openSection(user, 'Media and instructions');
    await user.type(screen.getByLabelText(/^Instructions/), 'Stand tall{enter}Slide up{enter}{enter}Come down');
    const list = screen.getByText('Patient sees').parentElement!;
    expect(within(list).getAllByRole('listitem').map((li) => li.textContent)).toEqual(['Stand tall', 'Slide up', 'Come down']);
    expect(screen.getByText('Shown to the patient as “Stop if: …”.')).toBeInTheDocument();
  });

  it('warns "Similar: Clamshells (Hip)" without blocking the save', async () => {
    const user = userEvent.setup();
    renderForm({ allExercises: [saved({ id: 'x', title: 'Clamshells', bodyRegion: 'Hip' })] });
    await user.type(screen.getByLabelText('Exercise name'), 'Clamshell');
    expect(screen.getByText(/Similar: Clamshells \(Hip\)/)).toBeInTheDocument();
    await user.click(pill('Body region', 'Hip'));
    expect(saveButton()).toBeEnabled();
  });

  it('the preview phone shows what is typed', async () => {
    const user = userEvent.setup();
    renderForm();
    await user.type(screen.getByLabelText('Exercise name'), 'Bird dog');
    await user.click(screen.getByRole('button', { name: 'Preview' }));
    const phone = screen.getByLabelText('Patient preview');
    expect(within(phone).getByRole('heading', { name: 'Bird dog' })).toBeInTheDocument();
  });
});

describe('ExerciseForm: existing and legacy exercises', () => {
  it('opens with every section folded; a legacy Warm-up type is shown and kept when untouched', async () => {
    const user = userEvent.setup();
    renderForm({ exercise: saved({ phase: 'warm_up' }) });
    expect(screen.getByRole('heading', { name: 'Edit exercise' })).toBeInTheDocument();
    expect(expanded()).toEqual([]);
    expect(sectionButton('Exercise details')).toHaveTextContent('Wall Slides · Shoulder · Warm-up');
    await openSection(user, 'Exercise details');
    expect(pill('Type', 'Warm-up')).toHaveAttribute('aria-pressed', 'true');
    await user.click(saveButton());
    await waitFor(() => expect(saveExercise).toHaveBeenCalledWith(expect.objectContaining({ phase: 'warm_up', positions: [] })));
  });

  it('an old cached exercise without positions opens; Classification reads "Not set" and Save stays on', () => {
    const legacy = saved({ equipment: [], alsoRegions: [], otherNames: [] }) as Partial<Exercise>;
    delete legacy.positions;
    renderForm({ exercise: legacy as Exercise });
    expect(sectionButton('Classification')).toHaveTextContent('Not set');
    expect(sectionButton('Classification')).not.toHaveTextContent('✓');
    expect(saveButton()).toBeEnabled();
  });

  it('Archive and Delete stay in the form for an existing exercise, not in the footer', async () => {
    exerciseUsage.mockResolvedValue({ programs: 1, templates: 0 });
    const { unmount } = render(<ExerciseForm open clinicId="c1" allExercises={[]} onClose={vi.fn()} onSaved={vi.fn()} exercise={saved()} />);
    const footer = screen.getByRole('button', { name: 'Cancel' }).parentElement as HTMLElement;
    expect(within(footer).getByRole('button', { name: 'Create progression' })).toBeInTheDocument();
    const archive = await screen.findByRole('button', { name: 'Archive' });
    expect(footer).not.toContainElement(archive);
    expect(sectionButton('Classification').compareDocumentPosition(archive) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    unmount();
    exerciseUsage.mockResolvedValue({ programs: 0, templates: 0 });
    renderForm({ exercise: saved() });
    const del = await screen.findByRole('button', { name: 'Delete' });
    expect(screen.getByRole('button', { name: 'Cancel' }).parentElement).not.toContainElement(del);
    expect(sectionButton('Classification').compareDocumentPosition(del) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('new photos keep their previews when Media folds, and are let go only when the sheet closes', async () => {
    const user = userEvent.setup();
    let n = 0;
    URL.createObjectURL = vi.fn(() => `blob:photo-${++n}`);
    const props = { clinicId: 'c1', allExercises: [], onClose: vi.fn(), onSaved: vi.fn() };
    const { rerender } = render(<ExerciseForm open {...props} />);
    await openSection(user, 'Media and instructions');
    await user.upload(screen.getByLabelText('Choose photos or a GIF', { selector: 'input' }), [new File(['a'], 'start.jpg', { type: 'image/jpeg' }), new File(['b'], 'end.jpg', { type: 'image/jpeg' })]);
    await user.click(screen.getByRole('button', { name: 'Next: Classification ›' }));
    expect(expanded()).toEqual(['Classification']);
    expect(URL.revokeObjectURL).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: 'Preview' }));
    const srcs = within(screen.getByLabelText('Patient preview')).getAllByRole('img').map((i) => i.getAttribute('src'));
    expect(srcs.length).toBeGreaterThan(0);
    expect(srcs.every((src) => src?.startsWith('blob:photo-'))).toBe(true);
    await openSection(user, 'Media and instructions');
    expect(URL.revokeObjectURL).not.toHaveBeenCalled();
    rerender(<ExerciseForm open={false} {...props} />);
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:photo-1');
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:photo-2');
  });
});

describe('ExerciseForm: unsaved changes', () => {
  it('Cancel on an unchanged form just closes', async () => {
    const user = userEvent.setup();
    const { onClose } = renderForm({ exercise: saved() });
    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(onClose).toHaveBeenCalled();
  });

  it('Cancel after an edit asks "Discard unsaved changes?"; Keep editing stays, Discard closes', async () => {
    const user = userEvent.setup();
    const { onClose } = renderForm();
    await user.type(screen.getByLabelText('Exercise name'), 'Bird');
    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.getByRole('heading', { name: 'Discard unsaved changes?' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Keep editing' }));
    expect(screen.queryByRole('heading', { name: 'Discard unsaved changes?' })).toBeNull();
    expect(onClose).not.toHaveBeenCalled();
    await user.keyboard('{Escape}');
    await user.click(screen.getByRole('button', { name: 'Discard' }));
    expect(onClose).toHaveBeenCalled();
  });
});

describe('ExerciseForm: saving and managing', () => {
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
    await nameAndRegion(user);
    await openSection(user, 'Media and instructions');
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
    expect(screen.getByLabelText('Exercise name')).toHaveValue('Bird dog');
    await user.click(pill('Body region', 'Core'));
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
    await nameAndRegion(user);
    await openSection(user, 'Media and instructions');
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
    await nameAndRegion(user);
    await openSection(user, 'Media and instructions');
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
    await openSection(user, 'Media and instructions');
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
    await nameAndRegion(user, 'Eleventh', 'Knee');
    await user.click(saveButton());
    expect(await screen.findByRole('alert')).toHaveTextContent('free-plan limit of 10 exercises');
  });

  it('Create progression turns the form into a new exercise with a copy name, showing Exercise details and Default dosage', async () => {
    const user = userEvent.setup();
    renderForm({ exercise: saved() });
    await user.click(screen.getByRole('button', { name: 'Create progression' }));
    expect(screen.getByRole('heading', { name: 'New exercise' })).toBeInTheDocument();
    expect(expanded()).toEqual(['Exercise details', 'Default dosage']);
    expect(screen.getByLabelText('Exercise name')).toHaveValue('Wall Slides (progression)');
    expect(screen.queryByRole('button', { name: 'Create progression' })).toBeNull();
    await user.click(saveButton());
    expect(saveExercise).toHaveBeenCalledWith(expect.objectContaining({ title: 'Wall Slides (progression)', id: expect.not.stringMatching(/^e1$/) }));
  });
});
