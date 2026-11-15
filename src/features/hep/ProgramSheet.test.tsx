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
import { exerciseToItem, intoBlock } from './hepItems';

const createProgram = vi.fn();
const updateProgram = vi.fn();
const listPatientPrograms = vi.fn();
const listTemplates = vi.fn();
const countActivePrograms = vi.fn();
vi.mock('@/services/hepService', async (orig) => ({
  ...(await orig<typeof import('@/services/hepService')>()),
  hepService: {
    createProgram: (...a: unknown[]) => createProgram(...a), updateProgram: (...a: unknown[]) => updateProgram(...a), listPatientPrograms: (...a: unknown[]) => listPatientPrograms(...a),
    listTemplates: (...a: unknown[]) => listTemplates(...a), countActivePrograms: (...a: unknown[]) => countActivePrograms(...a),
  },
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
let desktop = true;
vi.mock('@/components/useMediaQuery', () => ({ useIsDesktop: () => desktop, useMediaQuery: () => desktop }));
let ent: { tier: string; enforcementEnabled: boolean } = { tier: 'lite', enforcementEnabled: true };
vi.mock('@/app/useEntitlements', () => ({ useEntitlements: () => ent }));
let libraryList: Exercise[] = [];
vi.mock('./useHepData', async (orig) => ({ ...(await orig<typeof import('./useHepData')>()), useExercises: () => libraryList, useThumbUrls: () => ({}) }));
let pickList: Exercise[] = [];
let pickMeta: { templateId?: string; suggestedTitle?: string } | undefined;
let pickerProps: { target?: string; initialTab?: string; patientId?: string; patientName?: string; excludeProgramId?: string } = {};
vi.mock('./ExercisePicker', () => ({
  ExercisePicker: (p: { open: boolean; onAdd: (e: HepItemInput[], meta?: unknown) => void; onClose: () => void; target?: 'warm_up' | 'main' | 'cool_down'; initialTab?: string; patientId?: string; patientName?: string; excludeProgramId?: string }) => {
    if (!p.open) return null;
    pickerProps = { target: p.target, initialTab: p.initialTab, patientId: p.patientId, patientName: p.patientName, excludeProgramId: p.excludeProgramId };
    return <button type="button" onClick={() => { p.onAdd(intoBlock(pickList.map(exerciseToItem), p.target ?? 'main'), pickMeta); p.onClose(); }}>pick from library</button>;
  },
}));
vi.mock('./PatientPreview', () => ({ ProgramPreviewDialog: (p: { open: boolean; title: string; items: unknown[]; onClose: () => void }) => (p.open ? <div role="dialog" aria-label="patient preview">{p.title} · {p.items.length} items<button type="button" onClick={p.onClose}>close preview</button></div> : null) }));
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
const saveButton = () => screen.getByRole('button', { name: /Save and share|Save changes|Needs a connection|Saving/ });
const settings = () => screen.getByRole('region', { name: 'Program settings' });
const menu = async (user: ReturnType<typeof userEvent.setup>, title: string, choice: string) => {
  await user.click(screen.getByRole('button', { name: `More for ${title}` }));
  await user.click(screen.getByRole('button', { name: choice }));
};
const created = { programId: 'np1', patientId: 'pt1', token: 'tok9', pin: '4821' };

beforeEach(() => {
  createProgram.mockReset().mockResolvedValue(created);
  updateProgram.mockReset().mockResolvedValue(undefined);
  listPatientPrograms.mockReset().mockResolvedValue([]);
  listTemplates.mockReset().mockResolvedValue([{ ...template, usedCount: 3 }, { ...template, id: 't8', title: 'Shoulder', items: [], usedCount: 0 }]);
  countActivePrograms.mockReset().mockResolvedValue(3);
  pickList = []; pickMeta = undefined; pickerProps = {}; libraryList = []; desktop = true;
  ent = { tier: 'lite', enforcementEnabled: true };
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

  it('asks "Discard unsaved changes?" only when something was edited', async () => {
    const user = userEvent.setup();
    const { onClose } = renderSheet({ patientId: 'pt1' });
    await user.type(screen.getByLabelText(/^Program name/), 'Hip');
    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(onClose).not.toHaveBeenCalled();
    const ask = screen.getByRole('dialog', { name: 'Discard unsaved changes?' });
    await user.click(within(ask).getByRole('button', { name: 'Cancel' }));
    expect(onClose).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    await user.click(within(screen.getByRole('dialog', { name: 'Discard unsaved changes?' })).getByRole('button', { name: 'Discard' }));
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

describe('ProgramSheet: frequency', () => {
  it('applies to every row; a row that differs reads "Only this one: once a day"', async () => {
    const user = userEvent.setup();
    renderSheet({ patientId: 'pt1', startFrom: { template } });
    expect(screen.getAllByText(/twice a day/)).toHaveLength(3);
    await user.click(within(within(settings()).getByRole('group', { name: 'Frequency' })).getByRole('button', { name: '3× daily' }));
    expect(screen.getAllByText(/3 times a day/)).toHaveLength(3);
    await user.click(screen.getByRole('button', { name: /^Squat/ }));
    const row = screen.getByRole('button', { name: /^Squat/ }).closest('li') as HTMLElement;
    await user.click(within(within(row).getByRole('group', { name: 'Frequency' })).getByRole('button', { name: '1× daily' }));
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
  it('Optional on a row and "Optional" on a block are sent as optional: true for those items only', async () => {
    const user = userEvent.setup();
    renderSheet({ patientId: 'pt1', startFrom: { template } });
    const warm = screen.getByRole('region', { name: 'Warm-up' });
    await user.click(within(warm).getByRole('checkbox', { name: /Optional/ }));
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
  it('More settings: Effort first, completed at 90% and the clinician\'s own PIN go with the program', async () => {
    const user = userEvent.setup();
    renderSheet({ patientId: 'pt1', startFrom: { template } });
    await user.click(screen.getByText('More settings'));
    await user.click(screen.getByRole('button', { name: 'Effort first' }));
    await user.click(screen.getByRole('button', { name: '90%' }));
    await user.type(screen.getByLabelText(/^Custom PIN \(optional\)/), '12ab3456');
    expect(screen.getByLabelText(/^Custom PIN \(optional\)/)).toHaveValue('1234');
    await user.click(within(screen.getByRole('group', { name: 'Duration' })).getByRole('button', { name: 'Ongoing' }));
    await user.click(within(screen.getByRole('group', { name: 'Review in' })).getByRole('button', { name: 'No review' }));
    await user.click(within(screen.getByRole('group', { name: 'Start date' })).getByRole('button', { name: 'Tomorrow' }));
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

describe('ProgramSheet: starting a new program', () => {
  const finished = (): ProgramBundle => bundle({ id: 'old', status: 'completed', startDate: day(-30), title: 'Right knee, week 2', sessionsPerDay: 1, targetPct: 50, items: [pItem('o1', 'Bridge'), pItem('o2', 'Wall slides', 'mobility')] });

  it('an empty program offers quick starts; "Start from a template" opens the picker on the Templates tab', async () => {
    const user = userEvent.setup();
    renderSheet({ patientId: 'pt1' });
    expect(screen.queryByRole('button', { name: 'Repeat an earlier program' })).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Start from a template' }));
    expect(pickerProps).toMatchObject({ initialTab: 'templates', patientId: 'pt1' });
    await waitFor(() => expect(pickerProps.patientName).toBe('Ravi Kumar'));
  });

  it('"Repeat an earlier program" shows when the patient has one, and opens the earlier-programs tab', async () => {
    const user = userEvent.setup();
    listPatientPrograms.mockResolvedValue([finished()]);
    renderSheet({ patientId: 'pt1' });
    await user.click(await screen.findByRole('button', { name: 'Repeat an earlier program' }));
    expect(pickerProps.initialTab).toBe('earlier');
    expect(listPatientPrograms).toHaveBeenCalledWith('pt1', TODAY);
  });

  it('a template added from the picker keeps its id and fills a blank name, so saving records where it came from', async () => {
    const user = userEvent.setup();
    pickList = [ex('a', 'Squat')];
    pickMeta = { templateId: 't5', suggestedTitle: 'Hip week 1' };
    renderSheet({ patientId: 'pt1' });
    await user.click(screen.getByRole('button', { name: 'Start from a template' }));
    await user.click(screen.getByRole('button', { name: 'pick from library' }));
    expect(screen.getByLabelText(/^Program name/)).toHaveValue('Hip week 1');
    await user.click(saveButton());
    await waitFor(() => expect(createProgram).toHaveBeenCalledWith(expect.objectContaining({ sourceTemplateId: 't5', title: 'Hip week 1' })));
    expect(await screen.findByText('from template')).toBeInTheDocument();
  });

  it('a suggested name never replaces one already typed', async () => {
    const user = userEvent.setup();
    pickList = [ex('a', 'Squat')];
    pickMeta = { suggestedTitle: 'Earlier knee' };
    renderSheet({ patientId: 'pt1' });
    await user.type(screen.getByLabelText(/^Program name/), 'Mine');
    await user.click(screen.getByRole('button', { name: '+ Add exercises' }));
    await user.click(screen.getByRole('button', { name: 'pick from library' }));
    expect(screen.getByLabelText(/^Program name/)).toHaveValue('Mine');
  });

  it('"Start from" is gone: templates and earlier programs live in the picker', () => {
    renderSheet({ patientId: 'pt1' });
    expect(screen.queryByText('Start from')).toBeNull();
    expect(listTemplates).not.toHaveBeenCalled();
  });
});

describe('ProgramSheet: warm-up, main and cool-down blocks', () => {
  it('"+ Add a warm-up" opens the picker for the warm-up and what is added lands in the Warm-up block', async () => {
    const user = userEvent.setup();
    pickList = [ex('w1', 'Ankle pumps')];
    renderSheet({ patientId: 'pt1', startFrom: { template } });
    await user.click(screen.getByRole('button', { name: /^\+ Add to warm-up/ }));
    expect(pickerProps.target).toBe('warm_up');
    await user.click(screen.getByRole('button', { name: 'pick from library' }));
    expect(within(screen.getByRole('region', { name: 'Warm-up' })).getByText('Ankle pumps')).toBeInTheDocument();
  });

  it('⋯ → "Move to cool-down" moves a row and the saved list ends with it; the order is warm-up, types, other, cool-down', async () => {
    const user = userEvent.setup();
    const t: ExerciseTemplate = { ...template, items: [tItem(ex('o', 'Odd one', { phase: 'other' }), 0), tItem(ex('a', 'Squat'), 1), tItem(ex('c', 'Calf stretch', { phase: 'cool_down' }), 2), tItem(ex('m', 'Hip circles', { phase: 'mobility' }), 3), tItem(ex('b', 'Marching', { phase: 'warm_up' }), 4)] };
    renderSheet({ patientId: 'pt1', startFrom: { template: t } });
    await menu(user, 'Squat', 'Move to cool-down');
    await user.click(saveButton());
    await waitFor(() => expect(createProgram).toHaveBeenCalled());
    expect(createProgram.mock.calls[0][0].items.map((i: HepItemInput) => `${i.title}:${i.phase}`)).toEqual(['Marching:warm_up', 'Hip circles:mobility', 'Odd one:other', 'Calf stretch:cool_down', 'Squat:cool_down']);
  });

  it('"Move to main exercises" puts a warm-up row back under its exercise\'s type', async () => {
    const user = userEvent.setup();
    libraryList = [ex('b', 'Marching', { phase: 'balance' })];
    renderSheet({ patientId: 'pt1', startFrom: { template } });
    await menu(user, 'Marching', 'Move to main exercises');
    expect(within(screen.getByRole('region', { name: 'Balance' })).getByText('Marching')).toBeInTheDocument();
  });
});

describe('ProgramSheet: layout, plan meter and preview', () => {
  it('on a phone the settings fold into one summary card with Edit', async () => {
    const user = userEvent.setup();
    desktop = false;
    renderSheet({ patientId: 'pt1', startFrom: { template } });
    expect(await screen.findByText('Ravi Kumar · 2× daily · 1 week · starts today · review in 7 days')).toBeInTheDocument();
    expect(screen.queryByLabelText(/^Program name/)).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Edit settings' }));
    expect(screen.getByLabelText(/^Program name/)).toHaveValue('Knee week 1');
  });

  it('on a phone, with no patient chosen yet, the settings start open so the patient search shows', () => {
    desktop = false;
    renderSheet({ startFrom: { template } });
    expect(screen.getByPlaceholderText('Search by name or number')).toBeInTheDocument();
  });

  it('on a desktop the settings sit in a side panel next to the exercises', () => {
    renderSheet({ patientId: 'pt1', startFrom: { template } });
    expect(within(settings()).getByLabelText(/^Program name/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Edit settings' })).toBeNull();
  });

  it('a new program on the free plan shows "Free plan · n of 5 active programs"; none on an edit or an unlimited plan', async () => {
    const { unmount } = renderSheet({ patientId: 'pt1' });
    expect(await screen.findByText('Free plan · 3 of 5 active programs')).toBeInTheDocument();
    expect(countActivePrograms).toHaveBeenCalledWith('c1');
    unmount();
    const edit = renderSheet({ mode: 'edit', bundle: bundle() });
    await screen.findByText('Quad Sets');
    expect(screen.queryByText(/Free plan/)).toBeNull();
    edit.unmount();
    ent = { tier: 'solo', enforcementEnabled: true };
    renderSheet({ patientId: 'pt1' });
    await waitFor(() => expect(screen.queryByText(/Free plan/)).toBeNull());
  });

  it('no plan meter when the count cannot be loaded', async () => {
    countActivePrograms.mockRejectedValue(new Error('offline'));
    renderSheet({ patientId: 'pt1' });
    await waitFor(() => expect(countActivePrograms).toHaveBeenCalled());
    expect(screen.queryByText(/Free plan/)).toBeNull();
  });

  it('"Preview as patient" opens the preview with the program name and its exercises', async () => {
    const user = userEvent.setup();
    renderSheet({ patientId: 'pt1', startFrom: { template } });
    await user.click(screen.getByRole('button', { name: 'Preview as patient' }));
    expect(screen.getByRole('dialog', { name: 'patient preview' })).toHaveTextContent('Knee week 1 · 3 items');
  });

  it('the save button says "Save and share" for a new program and "Save changes" on an edit', () => {
    const { unmount } = renderSheet({ patientId: 'pt1', startFrom: { template } });
    expect(screen.getByRole('button', { name: 'Save and share' })).toBeEnabled();
    unmount();
    renderSheet({ mode: 'edit', bundle: bundle() });
    expect(screen.getByRole('button', { name: 'Save changes' })).toBeEnabled();
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

  it('the picker leaves the program being edited out of the earlier programs', async () => {
    const user = userEvent.setup();
    renderSheet({ mode: 'edit', bundle: bundle() });
    await user.click(screen.getByRole('button', { name: '+ Add exercises' }));
    expect(pickerProps).toMatchObject({ excludeProgramId: 'p1', patientId: 'pt1' });
  });

  it('changing the frequency says today stays and the new number starts tomorrow', async () => {
    const user = userEvent.setup();
    renderSheet({ mode: 'edit', bundle: bundle() });
    await user.click(within(within(settings()).getByRole('group', { name: 'Frequency' })).getByRole('button', { name: '1× daily' }));
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
