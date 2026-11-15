// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import { ClinicContext } from '@/app/clinicContext';
import type { Clinic } from '@/domain/types';
import type { Program, ProgramItem, ProgramLog, SessionsPerDay, SkipReason } from '@/domain/hep';
import type { ProgramBundle, SessionFeedback } from '@/services/hepService';
import { HomeProgramTab } from './HomeProgramTab';

const listPatientPrograms = vi.fn();
const markPainReviewed = vi.fn();
const setProgramStatus = vi.fn();
const extendProgram = vi.fn();
const duplicateProgram = vi.fn();
const resetPin = vi.fn();
const revokeLink = vi.fn();
const rotateToken = vi.fn();
const saveProgramAsTemplate = vi.fn();
vi.mock('@/services/hepService', async (orig) => ({
  ...(await orig<typeof import('@/services/hepService')>()),
  hepService: {
    listPatientPrograms: (...a: unknown[]) => listPatientPrograms(...a), markPainReviewed: (...a: unknown[]) => markPainReviewed(...a), setProgramStatus: (...a: unknown[]) => setProgramStatus(...a),
    extendProgram: (...a: unknown[]) => extendProgram(...a), duplicateProgram: (...a: unknown[]) => duplicateProgram(...a), resetPin: (...a: unknown[]) => resetPin(...a),
    revokeLink: (...a: unknown[]) => revokeLink(...a), rotateToken: (...a: unknown[]) => rotateToken(...a), saveProgramAsTemplate: (...a: unknown[]) => saveProgramAsTemplate(...a),
  },
}));
vi.mock('@/services', () => ({ repos: { patients: { get: async () => ({ id: 'pt1', name: 'Ravi Kumar', phone: '+91 98765 43210' }) } } }));
vi.mock('./ProgramSheet', () => ({ ProgramSheet: ({ open, mode, bundle, startFrom }: { open: boolean; mode: string; bundle?: { program: { id: string } }; startFrom?: { program?: { program: { id: string } } } }) => (open ? <div role="dialog" aria-label="program sheet">{mode} {bundle?.program.id ?? ''} {startFrom?.program?.program.id ? `from ${startFrom.program.program.id}` : ''}</div> : null) }));
vi.mock('./MessagePatientSheet', () => ({ MessagePatientSheet: ({ token }: { token: string }) => <div role="dialog" aria-label="message sheet">token {token}</div> }));
vi.mock('./PrintSheet', () => ({ PrintSheet: ({ open, pin }: { open: boolean; pin: string | null }) => (open ? <div>print sheet pin {pin ?? 'none'}</div> : null) }));
vi.mock('./HandOverPanel', () => ({ HandOverPanel: ({ pin }: { pin: string | null }) => <div role="dialog" aria-label="hand over">hand over pin {pin}</div> }));

const clinic = { id: 'c1', name: 'Sunrise', timezone: 'UTC' } as unknown as Clinic;
const TODAY = new Intl.DateTimeFormat('en-CA', { timeZone: 'UTC', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
const day = (o: number) => new Date(Date.parse(`${TODAY}T00:00:00Z`) + o * 86_400_000).toISOString().slice(0, 10);
const item = (id: string, title: string, over: Partial<ProgramItem> = {}): ProgramItem => ({
  id, programId: 'p1', title, bodyRegion: 'Knee', phase: 'strengthening', equipment: [], instructions: '', mediaType: 'none', mediaKeys: [], mediaCaptions: [], doseType: 'reps', sets: 3, reps: 10, holdSeconds: null,
  durationSeconds: null, restSeconds: 30, side: 'none', sessionsPerDay: 2, optional: false, sessionsSchedule: [], stopIf: '', specialInstructions: '', sortOrder: 0, addedOn: day(-5), removedOn: null, ...over,
});
const log = (id: string, d: string, s: number, over: Partial<ProgramLog> = {}): ProgramLog => ({ id: id + d + s, programItemId: id, logDate: d, sessionIndex: s as SessionsPerDay, skipped: false, completedAt: `${d}T08:30:00Z`, ...over });
const program = (over: Partial<Program> = {}): Program => ({
  id: 'p1', clinicId: 'c1', patientId: 'pt1', therapistId: 't1', title: 'Right knee, week 1', status: 'active', startDate: day(-5), durationDays: 14, targetPct: 70, checkinOn: null, feedbackDefault: 'pain', sessionsPerDay: 2,
  firstOpenedAt: null, painReviewedThrough: null, items: [item('sq', 'Squat'), item('mr', 'Marching', { phase: 'warm_up' }), item('op', 'Calf stretch', { phase: 'cool_down', optional: true })], createdAt: '', updatedAt: '', ...over,
});
const fb = (over: Partial<SessionFeedback> = {}): SessionFeedback => ({ id: 'f', programId: 'p1', logDate: day(-1), sessionIndex: 1, painScore: 8, effortScore: 6, painItemIds: ['sq'], hardItemIds: ['sq', 'mr'], createdAt: new Date().toISOString(), ...over });
const bothSessions = (d: string) => ['sq', 'mr'].flatMap((id) => [log(id, d, 1), log(id, d, 2)]);
const bundle = (p: Partial<Program> = {}, over: Partial<ProgramBundle> = {}): ProgramBundle => ({ patientPhone: null,
  program: program(p), patientName: 'Ravi Kumar', therapistName: 'Meera Rao', logs: [...bothSessions(day(-4)), ...bothSessions(day(-3)), ...bothSessions(day(-2)), ...bothSessions(day(-1)), log('sq', TODAY, 1), log('mr', TODAY, 1)],
  sessionFeedback: [], access: { token: 'tok123', linkRevoked: false, openCount: 4, lastOpenedAt: `${TODAY}T07:00:00Z` }, ...over,
});

function renderTab() {
  return render(<ClinicContext.Provider value={clinic}><HomeProgramTab patientId="pt1" /></ClinicContext.Provider>);
}
beforeEach(() => {
  listPatientPrograms.mockReset().mockResolvedValue([bundle()]);
  for (const m of [markPainReviewed, setProgramStatus, extendProgram, duplicateProgram, revokeLink, saveProgramAsTemplate]) m.mockReset().mockResolvedValue(undefined);
  resetPin.mockReset().mockResolvedValue('9090');
  rotateToken.mockReset().mockResolvedValue('newtok');
  Object.defineProperty(navigator, 'onLine', { value: true, configurable: true });
});
afterEach(cleanup);

describe('HomeProgramTab: header and progress', () => {
  it('shows the program, its day, times a day, estimate, minimum and who prescribed it', async () => {
    renderTab();
    expect(await screen.findByRole('heading', { name: /Right knee, week 1/ })).toBeInTheDocument();
    expect(screen.getByText(/^Day 6 of 14 · twice a day · about \d+ min a session · completed at 70% · by Meera Rao$/)).toBeInTheDocument();
  });

  it('Today counts sessions ("3 of 8" style) and the habit % ignores optional exercises', async () => {
    renderTab();
    const progress = await screen.findByRole('region', { name: 'Progress' });
    // required: Squat and Marching, twice a day: 4 sessions due today, 2 done (the optional Calf stretch is never counted)
    expect(within(progress).getByText('2 of 4')).toBeInTheDocument();
    expect(within(progress).getByText('80%')).toBeInTheDocument(); // 4 of the 5 finished days were done (the first day has no ticks)
    expect(within(progress).getByText('5 days finished')).toBeInTheDocument();
    expect(within(progress).getByText('4 days')).toBeInTheDocument(); // streak
    expect(within(progress).getByText('Opened 4×')).toBeInTheDocument();
  });

  it('labels the tile Adherence', async () => {
    renderTab();
    const progress = await screen.findByRole('region', { name: 'Progress' });
    expect(within(progress).getByText('Adherence')).toBeInTheDocument();
    expect(within(progress).queryByText('Habit')).toBeNull();
  });

  it('says "Not enough data" before the first day has finished', async () => {
    listPatientPrograms.mockResolvedValue([bundle({ startDate: TODAY, items: [item('sq', 'Squat', { addedOn: TODAY })] }, { logs: [] })]);
    renderTab();
    expect(await screen.findByText('Not enough data')).toBeInTheDocument();
  });

  it('tapping a day shows Morning and Evening with ticks, skips with their reasons, not done, and the Pain / Effort chips', async () => {
    const user = userEvent.setup();
    const logs = [log('sq', day(-1), 1), log('mr', day(-1), 1, { skipped: true, skipReason: 'pain' as SkipReason }), log('sq', day(-1), 2)];
    listPatientPrograms.mockResolvedValue([bundle({}, { logs, sessionFeedback: [fb({ createdAt: '2020-01-01T00:00:00Z' })] })]);
    renderTab();
    await screen.findByRole('region', { name: 'Progress' });
    await user.click(screen.getByRole('button', { name: new RegExp(`^${day(-1)}:`) }));
    const morning = screen.getByRole('heading', { name: 'Morning' }).parentElement?.parentElement as HTMLElement;
    expect(within(morning).getByText('Pain 8/10')).toBeInTheDocument();
    expect(within(morning).getByText('Effort 6/10')).toBeInTheDocument();
    expect(within(morning).getByText('Hurt: Squat. Hardest: Squat, Marching.')).toBeInTheDocument();
    expect(within(morning).getByText('Skipped: Pain')).toBeInTheDocument();
    const evening = screen.getByRole('heading', { name: 'Evening' }).parentElement?.parentElement as HTMLElement;
    expect(within(evening).getAllByText('Not done')).toHaveLength(2); // Marching and the optional Calf stretch, evening
    expect(within(evening).getByText(/^Done \d\d:\d\d$/)).toBeInTheDocument();
  });

  it('By exercise shows the dose, done, Hurt n× and Hardest n×', async () => {
    listPatientPrograms.mockResolvedValue([bundle({}, { sessionFeedback: [fb({ createdAt: '2020-01-01T00:00:00Z' }), fb({ id: 'g', logDate: day(-2), painItemIds: ['sq'], hardItemIds: [], createdAt: '2020-01-01T00:00:00Z' })] })]);
    renderTab();
    const list = await screen.findByRole('region', { name: 'By exercise' });
    const squat = within(list).getByText('Squat').closest('li') as HTMLElement;
    expect(within(squat).getByText(/done 8 of 10 · hurt 2× · hardest 1×/)).toBeInTheDocument();
    expect(within(squat).getByText(/3 sets × 10 reps · twice a day/)).toBeInTheDocument();
    expect(within(list).getByText('Calf stretch').closest('li')).toHaveTextContent('Optional');
  });

  it('By section appears when there is more than one section', async () => {
    renderTab();
    const section = await screen.findByRole('region', { name: 'By section' });
    expect(section).toHaveTextContent(/Warm-up 80% · Strengthening 80%/);
  });
});

describe('HomeProgramTab: needs your attention and pain review', () => {
  it('opening the tab marks new pain as seen for everyone, once, and still shows the report with "Reviewed ✓ just now"', async () => {
    listPatientPrograms.mockResolvedValue([bundle({}, { sessionFeedback: [fb()] })]);
    renderTab();
    const box = await screen.findByRole('region', { name: 'Alerts' });
    expect(within(box).getByText('Pain 8/10 after Squat')).toBeInTheDocument();
    expect(within(box).getByText(/Reviewed ✓ just now/)).toBeInTheDocument();
    await waitFor(() => expect(markPainReviewed).toHaveBeenCalledWith('p1'));
    expect(markPainReviewed).toHaveBeenCalledTimes(1);
  });

  it('once seen elsewhere (reviewed after the report) it is not shown again and nothing is marked', async () => {
    listPatientPrograms.mockResolvedValue([bundle({ painReviewedThrough: new Date(Date.now() + 60_000).toISOString() }, { sessionFeedback: [fb()] })]);
    renderTab();
    await screen.findByRole('region', { name: 'Progress' });
    expect(screen.queryByRole('region', { name: 'Alerts' })).toBeNull();
    expect(markPainReviewed).not.toHaveBeenCalled();
  });

  it('shows the box only when there is something: check-in due and an ended program come with their actions', async () => {
    const user = userEvent.setup();
    listPatientPrograms.mockResolvedValue([bundle({ checkinOn: TODAY })]);
    const { unmount } = renderTab();
    const box = await screen.findByRole('region', { name: 'Alerts' });
    expect(within(box).getByText('Check-in due')).toBeInTheDocument();
    await user.click(within(box).getByRole('button', { name: 'Message patient' }));
    expect(screen.getByRole('dialog', { name: 'message sheet' })).toHaveTextContent('token tok123');
    unmount();
    listPatientPrograms.mockResolvedValue([bundle({ startDate: day(-12), durationDays: 7, items: [item('sq', 'Squat', { addedOn: day(-12) })] }, { logs: [] })]);
    renderTab();
    const ended = await screen.findByRole('region', { name: 'Alerts' });
    expect(within(ended).getByRole('button', { name: 'Prescribe next' })).toBeInTheDocument();
    await user.click(within(ended).getByRole('button', { name: 'Prescribe next' }));
    expect(screen.getByRole('dialog', { name: 'program sheet' })).toHaveTextContent('new');
  });

  it('no box when all is well', async () => {
    renderTab();
    await screen.findByRole('region', { name: 'Progress' });
    expect(screen.queryByRole('region', { name: 'Alerts' })).toBeNull();
  });
});

describe('HomeProgramTab: programs and actions', () => {
  it('switches between active programs and finds completed ones under "Completed (n)"', async () => {
    const user = userEvent.setup();
    listPatientPrograms.mockResolvedValue([bundle(), bundle({ id: 'p2', title: 'Left shoulder', startDate: day(-3) }), bundle({ id: 'p3', title: 'Old knee', status: 'completed', startDate: day(-60) }, { access: null })]);
    renderTab();
    await screen.findByRole('heading', { name: /Right knee, week 1/ });
    await user.click(screen.getByRole('button', { name: 'Left shoulder' }));
    expect(screen.getByRole('heading', { name: /Left shoulder/ })).toBeInTheDocument();
    await user.selectOptions(screen.getByLabelText('Completed programs'), 'p3');
    expect(screen.getByRole('heading', { name: /Old knee/ })).toHaveTextContent('Completed');
    expect(screen.getByRole('option', { name: /Completed \(1\)/ })).toBeInTheDocument();
  });

  it('an empty patient gets the first-program prompt', async () => {
    listPatientPrograms.mockResolvedValue([]);
    renderTab();
    expect(await screen.findByText('No home program yet')).toBeInTheDocument();
    await userEvent.setup().click(screen.getAllByRole('button', { name: '+ New program' })[1]);
    expect(screen.getByRole('dialog', { name: 'program sheet' })).toBeInTheDocument();
  });

  it('Edit program opens the sheet on this program; Share link goes to the patient\'s WhatsApp with the link and no PIN', async () => {
    const user = userEvent.setup();
    renderTab();
    await user.click(await screen.findByRole('button', { name: 'Edit program' }));
    expect(screen.getByRole('dialog', { name: 'program sheet' })).toHaveTextContent('edit p1');
    const href = decodeURIComponent(screen.getByRole('link', { name: 'Share link' }).getAttribute('href') ?? '');
    expect(href).toContain('wa.me/919876543210');
    expect(href).toContain('/p/tok123');
    expect(href).not.toMatch(/PIN\D{0,4}\d{4}/);
  });

  it('Pause, Mark completed (after asking), Extend and Duplicate use the services without touching the exercises', async () => {
    const user = userEvent.setup();
    renderTab();
    const more = async () => user.click(await screen.findByRole('button', { name: 'More actions' }));
    await more();
    await user.click(screen.getByRole('button', { name: 'Pause' }));
    await waitFor(() => expect(setProgramStatus).toHaveBeenCalledWith('p1', 'paused'));
    await more();
    await user.click(screen.getByRole('button', { name: 'Duplicate' }));
    await waitFor(() => expect(duplicateProgram).toHaveBeenCalledWith('p1'));
    await more();
    await user.click(screen.getByRole('button', { name: 'Extend' }));
    await user.click(within(screen.getByRole('dialog', { name: 'Extend this program' })).getByRole('button', { name: '14 days' }));
    await waitFor(() => expect(extendProgram).toHaveBeenCalledWith('p1', 14));
    await more();
    await user.click(screen.getByRole('button', { name: 'Mark completed' }));
    expect(setProgramStatus).toHaveBeenCalledTimes(1);
    await user.click(within(screen.getByRole('dialog', { name: 'Mark this program completed?' })).getByRole('button', { name: 'Mark completed' }));
    await waitFor(() => expect(setProgramStatus).toHaveBeenCalledWith('p1', 'completed'));
  });

  it('Save as template asks for a name first', async () => {
    const user = userEvent.setup();
    renderTab();
    await user.click(await screen.findByRole('button', { name: 'More actions' }));
    await user.click(screen.getByRole('button', { name: 'Save as template' }));
    const name = screen.getByLabelText(/Template name/);
    expect(name).toHaveValue('Right knee, week 1');
    await user.clear(name);
    await user.type(name, 'Knee wk1');
    await user.click(within(screen.getByRole('dialog', { name: 'Save as template' })).getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(saveProgramAsTemplate).toHaveBeenCalledWith('p1', 'Knee wk1'));
  });

  it('Reset PIN… asks first and then shows the new PIN once in the hand-over', async () => {
    const user = userEvent.setup();
    renderTab();
    await user.click(await screen.findByRole('button', { name: 'More actions' }));
    const resets = screen.getAllByRole('button', { name: 'Reset PIN…' }); // the menu item and the link line
    await user.click(resets[resets.length - 1]);
    expect(resetPin).not.toHaveBeenCalled();
    await user.click(within(screen.getByRole('dialog', { name: 'Reset the PIN?' })).getByRole('button', { name: 'Reset PIN' }));
    await waitFor(() => expect(resetPin).toHaveBeenCalledWith('pt1'));
    expect(await screen.findByRole('dialog', { name: 'hand over' })).toHaveTextContent('hand over pin 9090');
  });

  it('Stop sharing asks first, and a stopped link offers to start sharing again', async () => {
    const user = userEvent.setup();
    renderTab();
    await user.click((await screen.findAllByRole('button', { name: 'Stop sharing' }))[0]);
    await user.click(within(screen.getByRole('dialog', { name: 'Stop sharing?' })).getByRole('button', { name: 'Stop sharing' }));
    await waitFor(() => expect(revokeLink).toHaveBeenCalledWith('pt1'));
    cleanup();
    listPatientPrograms.mockResolvedValue([bundle({}, { access: { token: 't', linkRevoked: true, openCount: 4, lastOpenedAt: null } })]);
    renderTab();
    expect(await screen.findByText('Sharing stopped')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'More actions' }));
    await user.click(screen.getByRole('button', { name: 'Start sharing again' }));
    await waitFor(() => expect(rotateToken).toHaveBeenCalledWith('pt1'));
    expect(screen.queryByRole('link', { name: 'Share link' })).toBeNull();
  });

  it('shows the database\'s message when an action fails', async () => {
    const user = userEvent.setup();
    listPatientPrograms.mockResolvedValue([bundle({ status: 'paused' })]);
    setProgramStatus.mockRejectedValue(new Error('You have reached the free-plan limit of 5 active programs. Visit theranet.in to upgrade.'));
    renderTab();
    await user.click(await screen.findByRole('button', { name: 'More actions' }));
    await user.click(screen.getByRole('button', { name: 'Resume' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('free-plan limit of 5 active programs');
  });

  it('offline, with nothing loaded, says the home program needs a connection', () => {
    Object.defineProperty(navigator, 'onLine', { value: false, configurable: true });
    renderTab();
    expect(screen.getByText(/needs a connection/)).toBeInTheDocument();
    expect(listPatientPrograms).not.toHaveBeenCalled();
  });
});
