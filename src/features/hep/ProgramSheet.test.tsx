// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { useEffect, useState } from 'react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import { ClinicContext } from '@/app/clinicContext';
import type { Clinic } from '@/domain/types';
import type { Exercise, ExerciseTemplate, ExerciseTemplateItem, Program, ProgramItem, ProgramLog, SessionsPerDay } from '@/domain/hep';
import type { HepItemInput, ProgramBundle } from '@/services/hepService';
import { ProgramSheet, type ProgramSheetProps } from './ProgramSheet';
import { exerciseToItem } from './hepItems';

const createProgram = vi.fn();
const updateProgram = vi.fn();
const listPatientPrograms = vi.fn();
const listTemplates = vi.fn();
vi.mock('@/services/hepService', async (orig) => ({
  ...(await orig<typeof import('@/services/hepService')>()),
  hepService: { createProgram: (...a: unknown[]) => createProgram(...a), updateProgram: (...a: unknown[]) => updateProgram(...a), listPatientPrograms: (...a: unknown[]) => listPatientPrograms(...a), listTemplates: (...a: unknown[]) => listTemplates(...a) },
}));
const patients = [{ id: 'pt1', name: 'Ravi Kumar', mrno: 'M-001', phone: '+91 98765 43210', deletedAt: null }, { id: 'pt2', name: 'Asha Pillai', mrno: 'M-002', phone: null, deletedAt: null }];
vi.mock('@/services', () => ({
  repos: {
    patients: { list: async () => patients, get: async (id: string) => patients.find((p) => p.id === id), search: async (_c: string, q: string) => patients.filter((p) => p.name.toLowerCase().includes(q.toLowerCase())) },
    therapists: { list: async () => [{ id: 't1', name: 'Meera Rao', active: true }, { id: 't2', name: 'Kiran Das', active: true }] },
  },
}));
vi.mock('dexie-react-hooks', () => ({ useLiveQuery: (fn: () => Promise<unknown>) => { const [v, setV] = useState<unknown>(); // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { void Promise.resolve(fn()).then(setV); }, []); return v; } }));
vi.mock('@/app/useWorkspaceScope', () => ({ useWorkspaceScope: () => ({ myTherapistId: 't1' }) }));
let pickList: Exercise[] = [];
vi.mock('./ExercisePicker', () => ({ ExercisePicker: ({ open, onAdd, onClose }: { open: boolean; onAdd: (e: Exercise[]) => void; onClose: () => void }) => (open ? <button type="button" onClick={() => { onAdd(pickList); onClose(); }}>pick from library</button> : null) }));
vi.mock('./HandOverPanel', () => ({ HandOverPanel: (p: { open: boolean; pin: string | null; token: string; patientName: string; fromTemplate: boolean; onClose: () => void }) => (p.open ? <div role="dialog" aria-label="hand over"><span>pin {p.pin ?? 'none'}</span><span>token {p.token}</span><span>for {p.patientName}</span><span>{p.fromTemplate ? 'from template' : 'not from template'}</span><button type="button" onClick={p.onClose}>close hand over</button></div> : null) }));

const clinic = { id: 'c1', name: 'Sunrise', timezone: 'UTC' } as unknown as Clinic;
const TODAY = new Intl.DateTimeFormat('en-CA', { timeZone: 'UTC', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
const day = (o: number) => new Date(Date.parse(`${TODAY}T00:00:00Z`) + o * 86_400_000).toISOString().slice(0, 10);
const ex = (id: string, title: string, over: Partial<Exercise> = {}): Exercise => ({
  id, clinicId: 'c1', title, positions: [], otherNames: [], bodyRegion: 'Knee', alsoRegions: [], equipment: [], phase: 'strengthening', instructions: '', mediaType: 'none', mediaKeys: [], mediaCaptions: [], thumbKey: null,
  defaultSets: 3, doseType: 'reps', defaultReps: 10, defaultHoldSeconds: null, defaultDurationSeconds: null, defaultRestSeconds: 30, defaultSessionsPerDay: 1, side: 'none', stopIf: '', isFavorite: false, active: true, deleted: false, version: 1, createdAt: '', updatedAt: '', ...over,
});
const tItem = (e: Exercise, i: number, spd: SessionsPerDay = 1): ExerciseTemplateItem => ({ ...exerciseToItem(e), sessionsPerDay: spd, sortOrder: i, id: `i${i}` }) as unknown as ExerciseTemplateItem;
const template: ExerciseTemplate = { id: 't9', clinicId: 'c1', title: 'Knee week 1', note: null, deleted: false, createdAt: '', updatedAt: '', items: [tItem(ex('a', 'Squat'), 0, 2), tItem(ex('b', 'Marching', { phase: 'warm_up' }), 1, 2), tItem(ex('c', 'Calf stretch', { phase: 'cool_down' }), 2, 2)] };
const pItem = (id: string, title: string, phase: Exercise['phase'] = 'strengthening'): ProgramItem => ({ ...exerciseToItem(ex(id, title, { phase })), id, programId: 'p1', sessionsSchedule: [], specialInstructions: '', sortOrder: 0, addedOn: day(-5), removedOn: null, sessionsPerDay: 2 }) as unknown as ProgramItem;
const program = (over: Partial<Program> = {}): Program => ({ id: 'p1', clinicId: 'c1', patientId: 'pt1', therapistId: 't2', title: 'Right knee', status: 'active', startDate: day(-5), durationDays: 14, targetPct: 90, checkinOn: day(2), feedbackDefault: 'pain', sessionsPerDay: 2, firstOpenedAt: null, items: [pItem('x1', 'Quad Sets', 'activation'), pItem('x2', 'Squat')], createdAt: '', updatedAt: '', ...over });
const log = (itemId: string, d: string, s = 1, skipped = false): ProgramLog => ({ id: itemId + d + s, programItemId: itemId, logDate: d, sessionIndex: s as SessionsPerDay, skipped, completedAt: '' });
const bundle = (over: Partial<Program> = {}, extra: Partial<ProgramBundle> = {}): ProgramBundle => ({ program: program(over), patientName: 'Ravi Kumar', therapistName: 'Kiran Das', logs: [log('x2', day(-4), 1), log('x2', day(-4), 2), log('x2', day(-3), 1)], sessionFeedback: [{ id: 'f', programId: 'p1', logDate: day(-4), sessionIndex: 1, painScore: 8, effortScore: null, painItemIds: ['x2'], hardItemIds: ['x2'], createdAt: '' }], access: null, ...extra });

function renderSheet(props: Partial<ProgramSheetProps> = {}) {
  const onClose = vi.fn();
  const onSaved = vi.fn();
  const { unmount } = render(<ClinicContext.Provider value={clinic}><ProgramSheet open mode="new" onClose={onClose} onSaved={onSaved} {...props} /></ClinicContext.Provider>);
  return { onClose, onSaved, unmount };
}
const saveButton = () => screen.getByRole('button', { name: /Save program|Needs a connection|Saving/ });
const created = { programId: 'np1', patientId: 'pt1', token: 'tok9', pin: '4821' };

beforeEach(() => {
  createProgram.mockReset().mockResolvedValue(created);
  updateProgram.mockReset().mockResolvedValue(undefined);
  listPatientPrograms.mockReset().mockResolvedValue([]);
  listTemplates.mockReset().mockResolvedValue([{ ...template, usedCount: 3 }, { ...template, id: 't8', title: 'Shoulder', items: [], usedCount: 0 }]);
  pickList = [];
  Object.defineProperty(navigator, 'onLine', { value: true, configurable: true });
});
afterEach(cleanup);

describe('ProgramSheet: opening and cancelling', () => {
  it('opening and cancelling changes nothing: nothing is saved and onSaved is not called', async () => {
    const user = userEvent.setup();
    const { onClose, onSaved } = renderSheet({ patientId: 'pt1' });
    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(onClose).toHaveBeenCalled();
    expect(onSaved).not.toHaveBeenCalled();
    expect(createProgram).not.toHaveBeenCalled();
    expect(updateProgram).not.toHaveBeenCalled();
  });

  it('asks "Discard changes?" only when something was edited', async () => {
    const user = userEvent.setup();
    const { onClose } = renderSheet({ patientId: 'pt1' });
    await user.type(screen.getByLabelText(/^Program name/), 'Hip');
    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(onClose).not.toHaveBeenCalled();
    const ask = screen.getByRole('dialog', { name: 'Discard changes?' });
    await user.click(within(ask).getByRole('button', { name: 'Cancel' }));
    expect(onClose).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    await user.click(within(screen.getByRole('dialog', { name: 'Discard changes?' })).getByRole('button', { name: 'Discard' }));
    expect(onClose).toHaveBeenCalled();
    expect(createProgram).not.toHaveBeenCalled();
  });
});

describe('ProgramSheet: a new program from a template', () => {
  it('lists recent patients before anything is typed, and offers a new patient', async () => {
    renderSheet({ startFrom: { template } });
    expect(await screen.findByRole('button', { name: /Asha Pillai/ })).toBeInTheDocument();
    expect(screen.getByRole('list', { name: 'Recent patients' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '+ New patient' })).toBeInTheDocument();
  });

  it('asks who it is for, then saves a copy of the template rows section by section and shows the hand-over with the PIN', async () => {
    const user = userEvent.setup();
    const { onSaved } = renderSheet({ startFrom: { template } });
    expect(screen.getByLabelText(/^Program name/)).toHaveValue('Knee week 1');
    expect(saveButton()).toBeDisabled();
    await user.type(screen.getByPlaceholderText('Search by name or number'), 'rav');
    await user.click(await screen.findByRole('button', { name: /Ravi Kumar/ }));
    expect(saveButton()).toBeEnabled();
    await user.click(saveButton());
    await waitFor(() => expect(createProgram).toHaveBeenCalled());
    const input = createProgram.mock.calls[0][0];
    expect(input).toMatchObject({ clinicId: 'c1', patientId: 'pt1', therapistId: 't1', title: 'Knee week 1', sourceTemplateId: 't9', customPin: null, today: TODAY });
    expect(input.items.map((i: HepItemInput) => i.title)).toEqual(['Marching', 'Squat', 'Calf stretch']);
    expect(input.settings).toEqual({ durationDays: 7, targetPct: 70, checkinDays: 7, feedbackDefault: 'pain', sessionsPerDay: 2 });
    expect(onSaved).toHaveBeenCalledWith({ mode: 'new', programId: 'np1', patientId: 'pt1', title: 'Knee week 1' });
    const hand = await screen.findByRole('dialog', { name: 'hand over' });
    expect(within(hand).getByText('pin 4821')).toBeInTheDocument();
    expect(within(hand).getByText('token tok9')).toBeInTheDocument();
    expect(within(hand).getByText('for Ravi Kumar')).toBeInTheDocument();
    expect(within(hand).getByText('from template')).toBeInTheDocument();
  });

  it('the program name starts as the template name and can be changed', async () => {
    const user = userEvent.setup();
    renderSheet({ patientId: 'pt1', startFrom: { template } });
    const name = screen.getByLabelText(/^Program name/);
    await user.clear(name);
    await user.type(name, 'Right knee, week 1');
    await user.click(saveButton());
    await waitFor(() => expect(createProgram).toHaveBeenCalledWith(expect.objectContaining({ title: 'Right knee, week 1', sourceTemplateId: 't9' })));
  });

  it('says the patient sees the program name', () => {
    renderSheet({ patientId: 'pt1' });
    expect(screen.getByText(/The patient sees this name/)).toBeInTheDocument();
  });
});

describe('ProgramSheet: times a day', () => {
  it('applies to every row; a row that differs reads "Only this one: once a day"', async () => {
    const user = userEvent.setup();
    renderSheet({ patientId: 'pt1', startFrom: { template } });
    expect(screen.getAllByText(/twice a day/)).toHaveLength(3);
    await user.click(within(screen.getByRole('group', { name: 'Times a day' })).getByRole('button', { name: '3 times' }));
    expect(screen.getAllByText(/3 times a day/)).toHaveLength(3);
    await user.click(screen.getByRole('button', { name: /^Squat/ }));
    const row = screen.getByRole('button', { name: /^Squat/ }).closest('li') as HTMLElement;
    await user.click(within(within(row).getByRole('group', { name: 'Times a day' })).getByRole('button', { name: '1' }));
    expect(within(row).getByText(/Only this one: once a day/)).toBeInTheDocument();
    await user.click(within(row).getByRole('button', { name: 'Same as the program (3)' }));
    expect(within(row).queryByText(/Only this one/)).toBeNull();
  });

  it('shows no warning and a time estimate at any length', async () => {
    const user = userEvent.setup();
    pickList = [ex('z', 'Long one', { defaultSets: 20, defaultReps: 600 })];
    renderSheet({ patientId: 'pt1', startFrom: { template } });
    expect(screen.getByText(/About \d+ min a session/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: '+ Add exercises' }));
    await user.click(screen.getByRole('button', { name: 'pick from library' }));
    expect(screen.getByText(/4 exercises/)).toBeInTheDocument();
    expect(screen.queryByText(/too long|warning/i)).toBeNull();
  });
});

describe('ProgramSheet: optional', () => {
  it('Optional on a row and "Make the whole section optional" are sent as optional: true for those items only', async () => {
    const user = userEvent.setup();
    renderSheet({ patientId: 'pt1', startFrom: { template } });
    const warm = screen.getByRole('region', { name: 'Warm-up' });
    await user.click(within(warm).getByLabelText('Make the whole section optional'));
    await user.click(screen.getByRole('button', { name: /^Squat/ }));
    const row = screen.getByRole('button', { name: /^Squat/ }).closest('li') as HTMLElement;
    await user.click(within(row).getByLabelText(/^Optional/));
    await user.click(saveButton());
    await waitFor(() => expect(createProgram).toHaveBeenCalled());
    const items = createProgram.mock.calls[0][0].items as HepItemInput[];
    expect(Object.fromEntries(items.map((i) => [i.title, i.optional]))).toEqual({ Marching: true, Squat: true, 'Calf stretch': false });
  });
});

describe('ProgramSheet: settings', () => {
  it('Advanced: Effort first, completed at 90% and the clinician\'s own PIN go with the program', async () => {
    const user = userEvent.setup();
    renderSheet({ patientId: 'pt1', startFrom: { template } });
    await user.click(screen.getByText('Advanced'));
    await user.click(screen.getByRole('button', { name: 'Effort first' }));
    await user.click(screen.getByRole('button', { name: '90%' }));
    await user.type(screen.getByLabelText(/Set my own 4-digit PIN/), '12ab3456');
    expect(screen.getByLabelText(/Set my own 4-digit PIN/)).toHaveValue('1234');
    await user.click(within(screen.getByRole('group', { name: 'Length' })).getByRole('button', { name: 'Ongoing' }));
    await user.click(within(screen.getByRole('group', { name: 'Check in' })).getByRole('button', { name: 'None' }));
    await user.click(within(screen.getByRole('group', { name: 'Start' })).getByRole('button', { name: 'Tomorrow' }));
    await user.click(saveButton());
    await waitFor(() => expect(createProgram).toHaveBeenCalled());
    const input = createProgram.mock.calls[0][0];
    expect(input.customPin).toBe('1234');
    expect(input.settings).toMatchObject({ feedbackDefault: 'effort', targetPct: 90, durationDays: null, checkinDays: null });
    expect(input.today).toBe(day(1));
  });

  it('from a visit note the program starts on the visit date', async () => {
    const user = userEvent.setup();
    renderSheet({ patientId: 'pt1', startFrom: { template }, startDate: '2026-11-10' });
    expect(screen.getByText('On the visit date (2026-11-10)')).toBeInTheDocument();
    await user.click(saveButton());
    await waitFor(() => expect(createProgram).toHaveBeenCalledWith(expect.objectContaining({ today: '2026-11-10' })));
  });

  it('Prescribed by starts as the signed-in therapist and can be changed', async () => {
    const user = userEvent.setup();
    renderSheet({ patientId: 'pt1', startFrom: { template } });
    const select = await screen.findByLabelText('Prescribed by');
    await waitFor(() => expect(select).toHaveValue('t1'));
    await user.selectOptions(select, 't2');
    await user.click(saveButton());
    await waitFor(() => expect(createProgram).toHaveBeenCalledWith(expect.objectContaining({ therapistId: 't2' })));
  });
});

describe('ProgramSheet: start from', () => {
  const finished = (): ProgramBundle => bundle({ id: 'old', status: 'completed', startDate: day(-30), title: 'Right knee, week 2', sessionsPerDay: 1, targetPct: 50, items: [pItem('o1', 'Bridge'), pItem('o2', 'Wall slides', 'mobility')] });
  it('"Same as last time" starts from the latest completed program: its rows and settings, as a new program', async () => {
    const user = userEvent.setup();
    listPatientPrograms.mockResolvedValue([finished()]);
    renderSheet({ patientId: 'pt1' });
    await user.click(await screen.findByRole('button', { name: 'Same as last time' }));
    expect(screen.getByLabelText(/^Program name/)).toHaveValue('Right knee, week 2');
    expect(screen.getByText('Bridge')).toBeInTheDocument();
    await user.click(saveButton());
    await waitFor(() => expect(createProgram).toHaveBeenCalled());
    const input = createProgram.mock.calls[0][0];
    expect(input.items.every((i: HepItemInput) => i.id === undefined)).toBe(true);
    expect(input.settings).toMatchObject({ targetPct: 50, checkinDays: 7 });
    expect(input.sourceTemplateId).toBeNull();
  });

  it('is not offered when the patient has no earlier program; a template can be chosen from the list, used ones first', async () => {
    const user = userEvent.setup();
    renderSheet({ patientId: 'pt1' });
    expect(screen.queryByRole('button', { name: 'Same as last time' })).toBeNull();
    await user.click(screen.getByRole('button', { name: 'A template' }));
    const select = await screen.findByLabelText('Template');
    await waitFor(() => expect(within(select).getAllByRole('option').map((o) => o.textContent)).toEqual(['Choose a template', 'Knee week 1 · used 3×', 'Shoulder']));
    await user.selectOptions(select, 't9');
    expect(screen.getByText('Marching')).toBeInTheDocument();
  });
});

describe('ProgramSheet: editing a live program', () => {
  it('shows "So far" numbers on an open row and Progress chips, and the change summary lists only what changed', async () => {
    const user = userEvent.setup();
    renderSheet({ mode: 'edit', bundle: bundle() });
    expect(screen.getByRole('heading', { name: 'Edit home program · Ravi Kumar' })).toBeInTheDocument();
    expect(screen.queryByText('What changes with this save')).toBeNull();
    await user.click(screen.getByRole('button', { name: /^Squat/ }));
    const row = screen.getByRole('button', { name: /^Squat/ }).closest('li') as HTMLElement;
    expect(within(row).getByText(/So far: done 3 of 10 · hurt 1× · hardest 1×/)).toBeInTheDocument();
    await user.click(within(row).getByRole('button', { name: '+1 set' }));
    await user.click(within(row).getByRole('button', { name: '+2 reps' }));
    const box = screen.getByRole('region', { name: 'What changes' });
    expect(within(box).getAllByRole('listitem')).toHaveLength(1);
    expect(within(box).getByText('Changed: Squat (sets 3 to 4; reps 10 to 12)')).toBeInTheDocument();
  });

  it('saving updates the same program with its row ids, keeps its status and sends the check-in date', async () => {
    const user = userEvent.setup();
    const { onSaved, onClose } = renderSheet({ mode: 'edit', bundle: bundle() });
    await user.click(screen.getByRole('button', { name: 'Remove Quad Sets' }));
    await user.click(saveButton());
    await waitFor(() => expect(updateProgram).toHaveBeenCalled());
    const input = updateProgram.mock.calls[0][0];
    expect(input).toMatchObject({ programId: 'p1', title: 'Right knee', status: 'active', today: TODAY });
    expect(input.items).toHaveLength(1);
    expect(input.items[0]).toMatchObject({ id: 'x2', title: 'Squat' });
    expect(input.settings).toEqual({ durationDays: 14, targetPct: 90, checkinOn: day(2), feedbackDefault: 'pain', sessionsPerDay: 2 });
    expect(onSaved).toHaveBeenCalledWith({ mode: 'edit', programId: 'p1', patientId: 'pt1', title: 'Right knee' });
    expect(onClose).toHaveBeenCalled();
    expect(createProgram).not.toHaveBeenCalled();
  });

  it('changing times a day says today stays and the new number starts tomorrow', async () => {
    const user = userEvent.setup();
    renderSheet({ mode: 'edit', bundle: bundle() });
    await user.click(within(screen.getByRole('group', { name: 'Times a day' })).getByRole('button', { name: 'Once' }));
    expect(screen.getByText('Today stays twice a day; the new number starts tomorrow.')).toBeInTheDocument();
  });

  it('"Start a separate program" turns the edit into a new program with the same rows', async () => {
    const user = userEvent.setup();
    renderSheet({ mode: 'edit', bundle: bundle() });
    await user.click(screen.getByRole('button', { name: 'Start a separate program' }));
    expect(screen.getByLabelText(/^Program name/)).toHaveValue('Right knee (new)');
    await user.click(saveButton());
    await waitFor(() => expect(createProgram).toHaveBeenCalledWith(expect.objectContaining({ patientId: 'pt1', title: 'Right knee (new)' })));
    expect(updateProgram).not.toHaveBeenCalled();
    expect(createProgram.mock.calls[0][0].items.every((i: HepItemInput) => i.id === undefined)).toBe(true);
  });
});

describe('ProgramSheet: saving', () => {
  it('says what is missing and needs a connection', async () => {
    const user = userEvent.setup();
    const { unmount } = renderSheet({ patientId: 'pt1' });
    expect(saveButton()).toBeDisabled();
    await user.type(screen.getByLabelText(/^Program name/), 'Hip');
    expect(saveButton()).toBeDisabled(); // still no exercise
    unmount();
    Object.defineProperty(navigator, 'onLine', { value: false, configurable: true });
    renderSheet({ patientId: 'pt1', startFrom: { template } });
    expect(saveButton()).toHaveTextContent('Needs a connection');
    expect(saveButton()).toBeDisabled();
  });

  it('shows the database\'s own message, for example the free-plan limit, and stays open', async () => {
    const user = userEvent.setup();
    createProgram.mockRejectedValue(new Error('You have reached the free-plan limit of 5 active programs. Visit theranet.in to upgrade.'));
    renderSheet({ patientId: 'pt1', startFrom: { template } });
    await user.click(saveButton());
    expect(await screen.findByRole('alert')).toHaveTextContent('free-plan limit of 5 active programs');
    expect(screen.queryByRole('dialog', { name: 'hand over' })).toBeNull();
  });

  it('closing the hand-over closes the whole sheet', async () => {
    const user = userEvent.setup();
    const { onClose } = renderSheet({ patientId: 'pt1', startFrom: { template } });
    await user.click(saveButton());
    await user.click(await screen.findByRole('button', { name: 'close hand over' }));
    expect(onClose).toHaveBeenCalled();
  });
});
