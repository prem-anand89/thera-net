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
import { ExercisePicker } from './ExercisePicker';

const saveExercise = vi.fn();
const listTemplates = vi.fn();
const listPatientPrograms = vi.fn();
const tItem = (id: string, title: string, sourceExerciseId: string | null) => ({ id, templateId: 't1', sourceExerciseId, title, bodyRegion: 'Knee', phase: 'strengthening', instructions: '', mediaType: 'none', mediaKeys: [], mediaCaptions: [], equipment: [], doseType: 'reps', sets: 3, reps: 10, holdSeconds: null, durationSeconds: null, restSeconds: 30, sessionsPerDay: 1, side: 'none', optional: false, stopIf: '', sortOrder: 0 });
vi.mock('@/services/hepService', async (orig) => ({
  ...(await orig<typeof import('@/services/hepService')>()),
  hepService: {
    saveExercise: (...a: unknown[]) => saveExercise(...a), recentlyUsedExerciseIds: async () => [], exerciseUsage: async () => ({ programs: 0, templates: 0 }),
    exerciseUseCounts: async () => ({}),
    listTemplates: (...a: unknown[]) => listTemplates(...a),
    listPatientPrograms: (...a: unknown[]) => listPatientPrograms(...a),
  },
}));
vi.mock('./StarterSetSheet', () => ({ StarterSetSheet: ({ open }: { open: boolean }) => (open ? <div>starter sheet</div> : null) }));
vi.mock('@/services/hepMediaService', () => ({
  hepMediaService: {
    mintViewUrls: async (_c: string, keys: string[]) => Object.fromEntries(keys.map((k) => [k, `https://img.test/${k}`])),
    mintUploadUrls: vi.fn(),
    putBlob: vi.fn(),
  },
}));

const clinic = { id: 'c1', name: 'Sunrise', timezone: 'Asia/Kolkata' } as unknown as Clinic;
const ex = (id: string, title: string, over: Partial<Exercise> = {}): Exercise => ({
  id, clinicId: 'c1', title, positions: [], otherNames: [], bodyRegion: 'Knee', alsoRegions: [], equipment: [], phase: 'strengthening', instructions: '', mediaType: 'none', mediaKeys: [], mediaCaptions: [],
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
  listTemplates.mockReset().mockResolvedValue([{ id: 't1', title: 'Knee week 1', note: null, bodyRegion: 'Knee', usedCount: 2, items: [tItem('i1', 'Quad Sets', '1'), tItem('i2', 'Wall Slides', '2')] }]);
  listPatientPrograms.mockReset().mockResolvedValue([
    { program: { id: 'p1', title: 'Earlier knee', startDate: '2026-10-01', items: [{ ...tItem('pi1', 'Sit to Stand', '3'), removedOn: null, specialInstructions: '' }] } },
    { program: { id: 'p-now', title: 'Being edited', startDate: '2026-11-01', items: [{ ...tItem('pi2', 'Bridge', null), removedOn: null, specialInstructions: '' }] } },
  ]);
  Object.defineProperty(navigator, 'onLine', { value: true, configurable: true });
});
afterEach(cleanup);

describe('ExercisePicker', () => {
  it('selecting two cards enables "Add 2 exercises", which hands them back in the order ticked', async () => {
    const user = userEvent.setup();
    const { onAdd, onClose } = renderPicker();
    const add = await screen.findByRole('button', { name: 'Add' }, { timeout: 5000 });
    expect(add).toBeDisabled();
    await user.click(await screen.findByRole('button', { name: /^Wall Slides/ }, { timeout: 5000 }));
    await user.click(screen.getByRole('button', { name: /^Quad Sets/ }));
    expect(screen.getByRole('button', { name: 'Add 2' })).toBeEnabled();
    await user.click(screen.getByRole('button', { name: 'Add 2' }));
    expect(onAdd.mock.calls[0][0].map((e: { title: string }) => e.title)).toEqual(['Wall Slides', 'Quad Sets']);
    expect(onClose).toHaveBeenCalled();
  });

  it('ticking again unticks, and the basket lists what is chosen', async () => {
    const user = userEvent.setup();
    renderPicker();
    const row = await screen.findByRole('button', { name: /^Quad Sets/ });
    await user.click(row);
    expect(screen.getByRole('complementary', { name: 'Chosen exercises' })).toHaveTextContent('Adding · 1');
    await user.click(row);
    expect(screen.getByRole('complementary', { name: 'Chosen exercises' })).toHaveTextContent('Nothing chosen yet');
  });

  it('exercises already in the program are shown but cannot be ticked', async () => {
    renderPicker({ disabledIds: new Set(['1']) });
    expect(await screen.findByRole('button', { name: /^Quad Sets/ })).toBeDisabled();
    expect(screen.getByText('In program')).toBeInTheDocument();
  });

  it('Templates tab "Add all" skips exercises already in the program and passes the template id and title', async () => {
    const user = userEvent.setup();
    const { onAdd } = renderPicker({ disabledIds: new Set(['1']) });
    await user.click(await screen.findByRole('tab', { name: 'Templates' }));
    expect(await screen.findByText('Knee week 1')).toBeInTheDocument();
    expect(screen.getByText(/used 2×/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Add all 1' }));
    expect(onAdd).toHaveBeenCalledTimes(1);
    expect(onAdd.mock.calls[0][0].map((i: { title: string }) => i.title)).toEqual(['Wall Slides']);
    expect(onAdd.mock.calls[0][1]).toEqual({ templateId: 't1', suggestedTitle: 'Knee week 1' });
  });

  it('an earlier-programs tab appears only with a patient, and "Add all" passes the program title', async () => {
    const user = userEvent.setup();
    const { onAdd } = renderPicker({ patientId: 'pt1', patientName: 'Asha Rao', excludeProgramId: 'p-now' });
    await user.click(await screen.findByRole('tab', { name: 'Asha’s earlier programs' }));
    await user.click(await screen.findByRole('button', { name: 'Add all 1' }));
    expect(onAdd.mock.calls[0][0].map((i: { title: string }) => i.title)).toEqual(['Sit to Stand']);
    expect(onAdd.mock.calls[0][1]).toEqual({ suggestedTitle: 'Earlier knee' });
  });

  it('has no earlier-programs tab without a patient', async () => {
    renderPicker();
    await screen.findByRole('tab', { name: 'Exercises' });
    expect(screen.queryByRole('tab', { name: /earlier programs/ })).toBeNull();
  });

  it('adding into the warm-up makes every item a warm-up', async () => {
    const user = userEvent.setup();
    const { onAdd } = renderPicker({ target: 'warm_up' });
    expect(screen.getByText('Add to the warm-up')).toBeInTheDocument();
    await user.click(await screen.findByRole('button', { name: /^Quad Sets/ }));
    await user.click(screen.getByRole('button', { name: 'Add 1' }));
    expect(onAdd.mock.calls[0][0].map((i: { phase: string }) => i.phase)).toEqual(['warm_up']);
  });

  it('an empty Library offers the starter library', async () => {
    await db.exercises.clear();
    const user = userEvent.setup();
    renderPicker();
    await user.click(await screen.findByRole('button', { name: 'Add the starter library' }));
    expect(screen.getByText('starter sheet')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Or create your own exercise' })).toBeInTheDocument();
  });

  it('typing an unknown name offers "+ New exercise", and Save and add saves it then adds it with the ticked ones', async () => {
    const user = userEvent.setup();
    const { onAdd } = renderPicker();
    await user.click(await screen.findByRole('button', { name: /^Sit to Stand/ }));
    await user.type(screen.getByRole('searchbox', { name: 'Search exercises' }), 'Bird dog');
    await user.click(screen.getByRole('button', { name: '+ New exercise “Bird dog”' }));
    expect(screen.getByLabelText('Exercise name')).toHaveValue('Bird dog');
    await user.click(within(screen.getByRole('group', { name: 'Body region' })).getByRole('button', { name: 'Core' }));
    await user.click(screen.getByRole('button', { name: 'Save and add' }));
    await waitFor(() => expect(onAdd).toHaveBeenCalled());
    expect(saveExercise).toHaveBeenCalledWith(expect.objectContaining({ title: 'Bird dog', bodyRegion: 'Core' }));
    expect(onAdd.mock.calls[0][0].map((e: { title: string }) => e.title)).toEqual(['Sit to Stand', 'Bird dog']);
  });

  it('says so when the Library is empty', async () => {
    await db.exercises.clear();
    renderPicker();
    expect(await screen.findByText('Your Library is empty')).toBeInTheDocument();
  });

  it('earlier programs load from the clinic\'s today (not every log ever) and leave out the program being edited', async () => {
    const user = userEvent.setup();
    renderPicker({ patientId: 'pt1', patientName: 'Asha Rao', excludeProgramId: 'p-now' });
    await user.click(await screen.findByRole('tab', { name: 'Asha’s earlier programs' }));
    expect(await screen.findByText('Earlier knee')).toBeInTheDocument();
    expect(screen.queryByText('Being edited')).toBeNull();
    const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
    expect(listPatientPrograms).toHaveBeenCalledWith('pt1', today);
  });

  it('never shows or adds the previous patient\'s earlier programs while the next patient\'s load', async () => {
    const user = userEvent.setup();
    let release: (v: unknown) => void = () => {};
    const onAdd = vi.fn();
    const ui = (patientId: string, patientName: string) => <ClinicContext.Provider value={clinic}><ExercisePicker open onClose={vi.fn()} onAdd={onAdd} patientId={patientId} patientName={patientName} initialTab="earlier" /></ClinicContext.Provider>;
    const { rerender } = render(ui('pt1', 'Asha Rao'));
    expect(await screen.findByText('Earlier knee')).toBeInTheDocument();
    listPatientPrograms.mockReturnValueOnce(new Promise((r) => { release = r; }));
    rerender(ui('pt2', 'Ben Roy'));
    await user.click(await screen.findByRole('tab', { name: 'Ben’s earlier programs' }));
    expect(screen.queryByText('Earlier knee')).toBeNull();
    expect(screen.queryByRole('button', { name: /Add all/ })).toBeNull();
    release([{ program: { id: 'p9', title: 'Ben shoulder', startDate: '2026-10-05', items: [{ ...tItem('x', 'Wall Slides', '2'), removedOn: null, specialInstructions: '' }] } }]);
    expect(await screen.findByText('Ben shoulder')).toBeInTheDocument();
    expect(screen.getByText(/from 05\/10/)).toBeInTheDocument();
  });

  it('a templates load error clears once a later load works', async () => {
    listTemplates.mockRejectedValueOnce(new Error('Network down'));
    const onAdd = vi.fn();
    const onClose = vi.fn();
    const ui = (open: boolean) => <ClinicContext.Provider value={clinic}><ExercisePicker open={open} onClose={onClose} onAdd={onAdd} initialTab="templates" /></ClinicContext.Provider>;
    const { rerender } = render(ui(true));
    expect(await screen.findByText('Network down')).toBeInTheDocument();
    rerender(ui(false));
    rerender(ui(true));
    expect(await screen.findByText('Knee week 1')).toBeInTheDocument();
    expect(screen.queryByText('Network down')).toBeNull();
  });

  it('opening on the earlier-programs tab without a patient falls back to Exercises', async () => {
    renderPicker({ initialTab: 'earlier' });
    expect(await screen.findByRole('tab', { name: 'Exercises' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.queryByLabelText('Loading earlier programs')).toBeNull();
  });

  it('"Add all" on a template also adds the exercises ticked on the Exercises tab, without doubles', async () => {
    const user = userEvent.setup();
    const { onAdd } = renderPicker();
    await user.click(await screen.findByRole('button', { name: /^Sit to Stand/ }));
    await user.click(screen.getByRole('button', { name: /^Quad Sets/ }));
    await user.click(screen.getByRole('tab', { name: 'Templates' }));
    await user.click(await screen.findByRole('button', { name: 'Add all 2' }));
    expect(onAdd.mock.calls[0][0].map((i: { title: string }) => i.title)).toEqual(['Quad Sets', 'Wall Slides', 'Sit to Stand']);
    expect(onAdd.mock.calls[0][1]).toEqual({ templateId: 't1', suggestedTitle: 'Knee week 1' });
  });

  it('Details button opens steps, default dose and equipment without toggling the card, and Add/Remove inside toggles it', async () => {
    await db.exercises.put(ex('1', 'Quad Sets', {
      instructions: 'Sit tall\nTighten your thigh',
      equipment: ['Towel'],
      doseType: 'hold',
      defaultSets: 3,
      defaultReps: 12,
      defaultHoldSeconds: 5,
      defaultRestSeconds: 30,
    }));
    const user = userEvent.setup();
    renderPicker();
    await user.click(await screen.findByRole('button', { name: 'Details for Quad Sets' }));
    expect(screen.getByRole('complementary', { name: 'Chosen exercises' })).toHaveTextContent('Nothing chosen yet');

    const dlg = screen.getByRole('dialog', { name: 'Quad Sets' });
    expect(within(dlg).getByText('Sit tall')).toBeInTheDocument();
    expect(within(dlg).getByText('Tighten your thigh')).toBeInTheDocument();
    expect(within(dlg).getByText(/3 sets × 12 reps · hold each for 5 s.*rest 30 s/)).toBeInTheDocument();
    expect(within(dlg).getByText('Towel')).toBeInTheDocument();

    await user.click(within(dlg).getByRole('button', { name: 'Add' }));
    expect(screen.queryByRole('dialog', { name: 'Quad Sets' })).toBeNull();
    expect(screen.getByRole('complementary', { name: 'Chosen exercises' })).toHaveTextContent('Adding · 1');

    await user.click(screen.getByRole('button', { name: 'Details for Quad Sets' }));
    const reopened = screen.getByRole('dialog', { name: 'Quad Sets' });
    await user.click(within(reopened).getByRole('button', { name: 'Remove' }));
    expect(screen.getByRole('complementary', { name: 'Chosen exercises' })).toHaveTextContent('Nothing chosen yet');
  });

  it('Details dialog shows the exercise first photo even when hidePicturesInLists is on, and shows none when it has no photo', async () => {
    await db.exercises.bulkPut([
      ex('4', 'Pelvic Tilt', {
        thumbKey: 'clinics/c1/ex/4/thumb.jpg',
        mediaType: 'stills',
        mediaKeys: ['clinics/c1/ex/4/0.jpg'],
        mediaCaptions: ['Start position'],
        hidePicturesInLists: true,
      }),
      ex('5', 'No Photo Stretch'),
    ]);
    const user = userEvent.setup();
    renderPicker();
    await user.click(await screen.findByRole('button', { name: 'Details for Pelvic Tilt' }));
    const dlg = screen.getByRole('dialog', { name: 'Pelvic Tilt' });
    const img = await within(dlg).findByRole('img');
    expect(img).toHaveAttribute('src', 'https://img.test/clinics/c1/ex/4/thumb.jpg');
    await user.click(within(dlg).getByRole('button', { name: 'Close' }));

    await user.click(screen.getByRole('button', { name: 'Details for No Photo Stretch' }));
    const noPhotoDlg = screen.getByRole('dialog', { name: 'No Photo Stretch' });
    expect(within(noPhotoDlg).queryByRole('img')).toBeNull();
  });
});
