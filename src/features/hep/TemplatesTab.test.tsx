// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import { ClinicContext } from '@/app/clinicContext';
import type { Clinic } from '@/domain/types';
import type { Exercise, ExerciseTemplate, ExerciseTemplateItem } from '@/domain/hep';
import { exerciseToItem } from './hepItems';
import type { HepItemInput } from '@/services/hepService';
import { TemplatesTab } from './TemplatesTab';

const listTemplates = vi.fn();
const saveTemplate = vi.fn();
const duplicateTemplate = vi.fn();
vi.mock('@/services/hepService', async (orig) => ({
  ...(await orig<typeof import('@/services/hepService')>()),
  hepService: { listTemplates: (...a: unknown[]) => listTemplates(...a), saveTemplate: (...a: unknown[]) => saveTemplate(...a), duplicateTemplate: (...a: unknown[]) => duplicateTemplate(...a) },
}));
let pickList: Exercise[] = [];
let pickDisabled: ReadonlySet<string> | undefined;
vi.mock('./ExercisePicker', () => ({
  ExercisePicker: ({ open, onAdd, onClose, disabledIds }: { open: boolean; onAdd: (e: HepItemInput[]) => void; onClose: () => void; disabledIds?: ReadonlySet<string> }) => {
    pickDisabled = disabledIds;
    return open ? <button type="button" onClick={() => { onAdd(pickList.map(exerciseToItem)); onClose(); }}>pick from library</button> : null;
  },
}));

const clinic = { id: 'c1', name: 'Sunrise', timezone: 'Asia/Kolkata' } as unknown as Clinic;
const ex = (id: string, title: string, over: Partial<Exercise> = {}): Exercise => ({
  id, clinicId: 'c1', title, positions: [], otherNames: [], bodyRegion: 'Knee', alsoRegions: [], equipment: [], phase: 'strengthening', instructions: '', mediaType: 'none', mediaKeys: [], mediaCaptions: [],
  thumbKey: null, defaultSets: 3, doseType: 'reps', defaultReps: 10, defaultHoldSeconds: null, defaultDurationSeconds: null, defaultRestSeconds: 30, defaultSessionsPerDay: 1, side: 'none', stopIf: '',
  isFavorite: false, active: true, deleted: false, version: 1, createdAt: '', updatedAt: '', ...over,
});
const tItem = (e: Exercise, i: number): ExerciseTemplateItem => ({ ...exerciseToItem(e), sortOrder: i, id: `i${i}` }) as unknown as ExerciseTemplateItem;
const template = (over: Partial<ExerciseTemplate & { usedCount: number }> = {}): ExerciseTemplate & { usedCount: number } => ({
  id: 't1', clinicId: 'c1', title: 'Knee week 1', note: 'After surgery', deleted: false, createdAt: '', updatedAt: '', usedCount: 3,
  items: [tItem(ex('a', 'Squat', { equipment: ['Chair'] }), 0), tItem(ex('b', 'Marching', { phase: 'warm_up' }), 1), tItem(ex('c', 'Lunge', { equipment: ['Chair', 'Towel'] }), 2), tItem(ex('d', 'Calf stretch', { phase: 'cool_down' }), 3)], ...over,
});
const renderTab = (props: React.ComponentProps<typeof TemplatesTab> = {}) =>
  render(<ClinicContext.Provider value={clinic}><TemplatesTab {...props} /></ClinicContext.Provider>);

beforeEach(() => {
  listTemplates.mockReset().mockResolvedValue([template()]);
  saveTemplate.mockReset().mockResolvedValue('t1');
  duplicateTemplate.mockReset().mockResolvedValue('t2');
  pickList = []; pickDisabled = undefined;
  Object.defineProperty(navigator, 'onLine', { value: true, configurable: true });
});
afterEach(cleanup);

describe('TemplatesTab', () => {
  it('cards show section counts, Needs, about N min and used N times', async () => {
    renderTab();
    expect(await screen.findByText('Knee week 1')).toBeInTheDocument();
    expect(screen.getByText('After surgery')).toBeInTheDocument();
    expect(screen.getByText(/^4 exercises · about \d+ min$/)).toBeInTheDocument();
    expect(screen.getByText('Warm-up 1 · Strengthening 2 · Cool-down 1')).toBeInTheDocument();
    expect(screen.getByText('Needs: Chair, Towel · used 3 times')).toBeInTheDocument();
    expect(listTemplates).toHaveBeenCalledWith('c1');
  });

  it('"Use for a patient" appears only when the program sheet is wired, and hands the template over', async () => {
    const user = userEvent.setup();
    const { unmount } = renderTab();
    await screen.findByText('Knee week 1');
    expect(screen.queryByRole('button', { name: 'Use for a patient' })).toBeNull();
    unmount();
    const onUse = vi.fn();
    renderTab({ onUse });
    await user.click(await screen.findByRole('button', { name: 'Use for a patient' }));
    expect(onUse).toHaveBeenCalledWith(expect.objectContaining({ id: 't1' }));
  });

  it('offline, with nothing loaded, says templates need a connection', () => {
    Object.defineProperty(navigator, 'onLine', { value: false, configurable: true });
    renderTab();
    expect(screen.getByText(/Templates need a connection/)).toBeInTheDocument();
    expect(listTemplates).not.toHaveBeenCalled();
  });

  it('searches by name, note or an exercise inside', async () => {
    const user = userEvent.setup();
    listTemplates.mockResolvedValue([template(), template({ id: 't9', title: 'Shoulder', note: null, usedCount: 0, items: [tItem(ex('z', 'Pendulum'), 0)] })]);
    renderTab();
    await screen.findByText('Knee week 1');
    await user.type(screen.getByRole('searchbox', { name: 'Search templates' }), 'pendulum');
    expect(screen.queryByText('Knee week 1')).toBeNull();
    expect(screen.getByText('Shoulder')).toBeInTheDocument();
    await user.clear(screen.getByRole('searchbox'));
    await user.type(screen.getByRole('searchbox'), 'nothing like this');
    expect(screen.getByText(/No templates match/)).toBeInTheDocument();
  });

  it('shows what a template is when there are none', async () => {
    listTemplates.mockResolvedValue([]);
    renderTab();
    expect(await screen.findByText('No templates yet')).toBeInTheDocument();
  });

  it('Duplicate copies it and reloads the list', async () => {
    const user = userEvent.setup();
    renderTab();
    await screen.findByText('Knee week 1');
    await user.click(screen.getByRole('button', { name: 'Actions for Knee week 1' }));
    await user.click(screen.getByRole('button', { name: 'Duplicate' }));
    await waitFor(() => expect(duplicateTemplate).toHaveBeenCalledWith('t1'));
    await waitFor(() => expect(listTemplates).toHaveBeenCalledTimes(2));
  });

  it('Delete asks first, and says programs already made are not changed', async () => {
    const user = userEvent.setup();
    renderTab();
    await screen.findByText('Knee week 1');
    await user.click(screen.getByRole('button', { name: 'Actions for Knee week 1' }));
    await user.click(screen.getByRole('button', { name: 'Delete' }));
    expect(screen.getByText(/Programs already made from it are not changed/)).toBeInTheDocument();
    expect(saveTemplate).not.toHaveBeenCalled();
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Delete' }));
    await waitFor(() => expect(saveTemplate).toHaveBeenCalledWith(expect.objectContaining({ templateId: 't1', deleted: true })));
  });

  it('shows the message when the list cannot be loaded', async () => {
    listTemplates.mockRejectedValue(new Error('Network down'));
    renderTab();
    expect(await screen.findByRole('alert')).toHaveTextContent('Network down');
  });
});

describe('TemplateEditor (through the tab)', () => {
  async function openEditor(user: ReturnType<typeof userEvent.setup>) {
    renderTab();
    await screen.findByText('Knee week 1');
    await user.click(screen.getByRole('button', { name: 'Edit' }));
    return screen.getByRole('dialog');
  }

  it('groups rows in collapsible sections in session order with Collapse all / Expand all and the estimate', async () => {
    const user = userEvent.setup();
    const dlg = await openEditor(user);
    expect(within(dlg).getAllByRole('heading', { level: 3 }).map((h) => h.textContent?.replace(/\s+/g, ' ').trim())).toEqual(['▾ Warm-up (1)', '▾ Strengthening (2)', '▾ Cool-down (1)']);
    expect(within(dlg).getByText(/^4 exercises · about \d+ min$/)).toBeInTheDocument();
    await user.click(within(dlg).getByRole('button', { name: 'Collapse all' }));
    expect(within(dlg).queryByText('Squat')).toBeNull();
    await user.click(within(dlg).getByRole('button', { name: 'Expand all' }));
    expect(within(dlg).getByText('Squat')).toBeInTheDocument();
  });

  it('changing a dose and saving sends the items section by section to the same template', async () => {
    const user = userEvent.setup();
    const dlg = await openEditor(user);
    await user.click(within(dlg).getByRole('button', { name: /^Squat/ }));
    await user.click(within(within(dlg).getByRole('group', { name: 'Sets' })).getByRole('button', { name: '2' }));
    await user.click(within(dlg).getByRole('button', { name: 'Save template' }));
    await waitFor(() => expect(saveTemplate).toHaveBeenCalled());
    const call = saveTemplate.mock.calls[0][0];
    expect(call).toMatchObject({ clinicId: 'c1', templateId: 't1', title: 'Knee week 1', note: 'After surgery' });
    expect(call.items.map((i: { title: string }) => i.title)).toEqual(['Marching', 'Squat', 'Lunge', 'Calf stretch']);
    expect(call.items[1]).toMatchObject({ title: 'Squat', sets: 2 });
  });

  it('moves and removes rows inside a section', async () => {
    const user = userEvent.setup();
    const dlg = await openEditor(user);
    await user.click(within(dlg).getByRole('button', { name: 'Move Squat down' }));
    await user.click(within(dlg).getByRole('button', { name: 'Remove Calf stretch' }));
    await user.click(within(dlg).getByRole('button', { name: 'Save template' }));
    await waitFor(() => expect(saveTemplate).toHaveBeenCalled());
    expect(saveTemplate.mock.calls[0][0].items.map((i: { title: string }) => i.title)).toEqual(['Marching', 'Lunge', 'Squat']);
  });

  it('a new template needs a name and at least one exercise; the picker adds copies and greys out what is already there', async () => {
    const user = userEvent.setup();
    listTemplates.mockResolvedValue([]);
    pickList = [ex('n1', 'Bird dog', { phase: 'activation' })];
    renderTab();
    await screen.findByText('No templates yet');
    await user.click(screen.getByRole('button', { name: '+ New template' }));
    const dlg = screen.getByRole('dialog');
    const save = within(dlg).getByRole('button', { name: 'Save template' });
    expect(save).toBeDisabled();
    await user.type(within(dlg).getByLabelText(/^Template name/), 'Core basics');
    expect(save).toBeDisabled();
    await user.click(within(dlg).getByRole('button', { name: '+ Add exercises' }));
    await user.click(screen.getByRole('button', { name: 'pick from library' }));
    expect(within(dlg).getByText('Bird dog')).toBeInTheDocument();
    expect(pickDisabled).toEqual(new Set(['n1']));
    expect(save).toBeEnabled();
    await user.click(save);
    await waitFor(() => expect(saveTemplate).toHaveBeenCalledWith(expect.objectContaining({ templateId: undefined, title: 'Core basics', items: [expect.objectContaining({ title: 'Bird dog', sourceExerciseId: 'n1' })] })));
  });

  it('shows the database\'s message when saving fails and stays open', async () => {
    const user = userEvent.setup();
    saveTemplate.mockRejectedValue(new Error('Picture does not belong to this clinic.'));
    const dlg = await openEditor(user);
    await user.click(within(dlg).getByRole('button', { name: 'Save template' }));
    expect(await within(dlg).findByRole('alert')).toHaveTextContent('Picture does not belong to this clinic.');
  });
});
