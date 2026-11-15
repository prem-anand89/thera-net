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
import { useHomeProgramDot } from './useHomeProgramDot';

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
const library: { current: Array<Record<string, unknown>> } = { current: [] };
vi.mock('./useHepData', async (orig) => ({ ...(await orig<typeof import('./useHepData')>()), useExercises: () => library.current, useThumbUrls: () => ({ k1: 'blob:pic' }) }));
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
  library.current = [];
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
/** The By exercise table shows from tablet width; phones get cards (jsdom has no matchMedia, so cards by default). */
const wideScreen = () => vi.stubGlobal('matchMedia', (q: string) => ({ matches: true, media: q, addEventListener: () => {}, removeEventListener: () => {} }));

describe('HomeProgramTab: header and progress', () => {
  it('the program card: title, status, one sub line, the day bar with its dates, and the review date', async () => {
    listPatientPrograms.mockResolvedValue([bundle({ checkinOn: day(7) })]);
    renderTab();
    expect(await screen.findByRole('heading', { name: /Right knee, week 1/ })).toBeInTheDocument();
    const card = screen.getByRole('region', { name: 'Program' });
    expect(within(card).getByText('Active')).toBeInTheDocument();
    expect(within(card).getByText(/^twice a day · 3 exercises · about \d+ min · completion target 70% · prescribed by Meera Rao · review in 7 days$/)).toBeInTheDocument();
    const bar = within(card).getByRole('progressbar', { name: 'Day 6 of 14' });
    expect(bar).toHaveAttribute('aria-valuenow', '6');
    const dm = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}`;
    expect(within(card).getByText(`${dm(day(-5))} – ${dm(day(8))}`)).toBeInTheDocument();
  });

  it('the patient link line sits in the program card with its actions', async () => {
    renderTab();
    const card = await screen.findByRole('region', { name: 'Program' });
    expect(within(card).getByText('Patient link on · opened today 07:00 · PIN set')).toBeInTheDocument();
    for (const name of ['Copy link', 'Reset PIN…', 'Stop sharing']) expect(within(card).getByRole('button', { name })).toBeInTheDocument();
    expect(within(card).getByRole('link', { name: 'Send on WhatsApp' })).toBeInTheDocument();
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

  const weekFeedback = () => [fb({ createdAt: '2020-01-01T00:00:00Z' }), fb({ id: 'g', logDate: day(-2), painItemIds: ['sq'], hardItemIds: [], createdAt: '2020-01-01T00:00:00Z' })];
  const withSkip = () => bundle({}, { sessionFeedback: weekFeedback(), logs: [...bundle().logs, log('mr', TODAY, 2, { skipped: true, skipReason: 'no_time' as SkipReason })] });

  it('By exercise (table, from tablet width): grouped Warm-up / Main exercises / Cool-down, dose, days done, the 7-day strip and flags', async () => {
    wideScreen();
    listPatientPrograms.mockResolvedValue([withSkip()]);
    renderTab();
    const box = await screen.findByRole('region', { name: 'By exercise' });
    const table = within(box).getByRole('table');
    const groups = within(table).getAllByRole('row').filter((r) => r.getAttribute('data-group') != null).map((r) => r.textContent);
    expect(groups).toEqual(['Warm-up', 'Main exercises', 'Cool-down']);
    const squat = within(table).getByText('Squat').closest('tr') as HTMLElement;
    expect(within(squat).getByText(/3 sets × 10 reps · twice a day/)).toBeInTheDocument();
    expect(within(squat).getByText('4 of 7 days')).toBeInTheDocument(); // day -4 to -1 both sessions; today 1 of 2
    expect(within(squat).getByText('felt hard ×1')).toBeInTheDocument();
    expect(within(squat).getByText('pain ×2')).toBeInTheDocument();
    const cells = within(squat).getAllByRole('img', { name: /^\d\d\/\d\d: / });
    expect(cells).toHaveLength(7);
    expect(cells[6]).toHaveAccessibleName(/partly done$/);
    const marching = within(table).getByText('Marching').closest('tr') as HTMLElement;
    expect(within(marching).getByText('skipped ×1')).toBeInTheDocument();
    expect(within(table).getByText('Calf stretch').closest('tr')).toHaveTextContent('Optional');
  });

  it('By exercise shows a picture only when the exercise has one and it is not hidden in lists; no empty tile otherwise', async () => {
    wideScreen();
    library.current = [
      { id: 'ex1', clinicId: 'c1', title: 'Squat', thumbKey: 'k1', mediaType: 'image', bodyRegion: 'Knee', hidePicturesInLists: false },
      { id: 'ex2', clinicId: 'c1', title: 'Marching', thumbKey: 'k1', mediaType: 'image', bodyRegion: 'Knee', hidePicturesInLists: true },
    ];
    listPatientPrograms.mockResolvedValue([bundle({ items: [item('sq', 'Squat', { sourceExerciseId: 'ex1' }), item('mr', 'Marching', { phase: 'warm_up', sourceExerciseId: 'ex2' }), item('op', 'Calf stretch', { phase: 'cool_down', optional: true })] })]);
    renderTab();
    const box = await screen.findByRole('region', { name: 'By exercise' });
    expect(within(within(box).getByText('Squat').closest('tr') as HTMLElement).getByRole('presentation')).toHaveAttribute('src', 'blob:pic');
    expect((within(box).getByText('Marching').closest('tr') as HTMLElement).querySelector('img')).toBeNull();
    expect((within(box).getByText('Calf stretch').closest('tr') as HTMLElement).querySelector('img, [aria-hidden="true"] span')).toBeNull();
  });

  it('By exercise on a phone is a card per exercise with the same facts', async () => {
    listPatientPrograms.mockResolvedValue([withSkip()]);
    renderTab();
    const box = await screen.findByRole('region', { name: 'By exercise' });
    expect(within(box).queryByRole('table')).toBeNull();
    const squat = within(box).getByText('Squat').closest('li') as HTMLElement;
    expect(within(squat).getByText('4 of 7 days')).toBeInTheDocument();
    expect(within(squat).getByText('felt hard ×1')).toBeInTheDocument();
    expect(within(box).getByRole('heading', { name: 'Warm-up' })).toBeInTheDocument();
    expect(within(box).getByRole('heading', { name: 'Cool-down' })).toBeInTheDocument();
  });

  it('the pain and effort trend draws from the session checks, with a summary for screen readers', async () => {
    listPatientPrograms.mockResolvedValue([bundle({}, { sessionFeedback: [fb({ logDate: day(-3), painScore: 3, effortScore: 5, createdAt: '2020-01-01T00:00:00Z' }), fb({ id: 'g', logDate: day(-1), painScore: 6, effortScore: 6, createdAt: '2020-01-01T00:00:00Z' })] })]);
    const { container } = renderTab();
    const chart = await screen.findByRole('img', { name: 'Pain went from 3 to 6 over the last 7 days. Effort went from 5 to 6.' });
    expect(chart.querySelectorAll('polyline')).toHaveLength(2);
    expect(chart.querySelector('polyline')?.getAttribute('points')?.split(' ')).toHaveLength(2);
    expect(container).toHaveTextContent('Pain (0–10)');
  });

  it('a single session check still shows a round dot for pain and for effort', async () => {
    listPatientPrograms.mockResolvedValue([bundle({}, { sessionFeedback: [fb({ logDate: day(-1), painScore: 5, effortScore: 4, createdAt: '2020-01-01T00:00:00Z' })] })]);
    const { container } = renderTab();
    const chart = await screen.findByRole('img', { name: 'Pain 5 over the last 7 days. Effort 4.' });
    expect(chart.querySelector('polyline')?.getAttribute('points')?.split(' ')).toHaveLength(1);
    expect(container.querySelector('[data-point="pain"]')).not.toBeNull();
    expect(container.querySelector('[data-point="effort"]')).not.toBeNull();
    expect(chart.querySelector('circle')).toBeNull(); // dots live outside the stretched SVG
  });

  it('with no session checks the trend says so in one line', async () => {
    renderTab();
    expect(await screen.findByText('No session feedback yet.')).toBeInTheDocument();
  });

  it('the Today card lists today\'s exercises and sums up yesterday', async () => {
    renderTab();
    const todayCard = await screen.findByRole('region', { name: 'Day' });
    expect(within(todayCard).getByRole('heading', { name: /^Today/ })).toBeInTheDocument();
    expect(within(todayCard).getByText('Yesterday: 4 done')).toBeInTheDocument();
  });

  it('By section appears when there is more than one section', async () => {
    renderTab();
    const section = await screen.findByRole('region', { name: 'By section' });
    expect(section).toHaveTextContent(/Warm-up 80% · Strengthening 80%/);
  });
});

describe('HomeProgramTab: needs your attention and pain review', () => {
  it('a waiting pain report shows a banner with Call (clinic country code) and Mark reviewed, which marks it seen for everyone once', async () => {
    const user = userEvent.setup();
    listPatientPrograms.mockResolvedValue([bundle({}, { sessionFeedback: [fb()] })]);
    renderTab();
    const box = await screen.findByRole('region', { name: 'Alerts' });
    expect(within(box).getByText('Pain 8/10 after Squat')).toBeInTheDocument();
    expect(within(box).getByRole('link', { name: 'Call' })).toHaveAttribute('href', 'tel:+919876543210');
    expect(markPainReviewed).not.toHaveBeenCalled();
    await user.click(within(box).getByRole('button', { name: 'Mark reviewed' }));
    await waitFor(() => expect(markPainReviewed).toHaveBeenCalledWith('p1'));
    expect(markPainReviewed).toHaveBeenCalledTimes(1);
    expect(within(box).getByText(/Reviewed ✓ just now/)).toBeInTheDocument();
    expect(within(box).queryByRole('button', { name: 'Mark reviewed' })).toBeNull();
  });

  it('the profile tab\'s red dot clears after Mark reviewed', async () => {
    const user = userEvent.setup();
    listPatientPrograms.mockResolvedValue([bundle({}, { sessionFeedback: [fb()] })]);
    markPainReviewed.mockImplementation(async () => { listPatientPrograms.mockResolvedValue([bundle({ painReviewedThrough: new Date(Date.now() + 60_000).toISOString() }, { sessionFeedback: [fb()] })]); });
    function Dot() { return <span>dot:{useHomeProgramDot('pt1', true) ? 'on' : 'off'}</span>; }
    render(<ClinicContext.Provider value={clinic}><Dot /><HomeProgramTab patientId="pt1" /></ClinicContext.Provider>);
    expect(await screen.findByText('dot:on')).toBeInTheDocument();
    await user.click(within(await screen.findByRole('region', { name: 'Alerts' })).getByRole('button', { name: 'Mark reviewed' }));
    expect(await screen.findByText('dot:off')).toBeInTheDocument();
  });

  it('if Mark reviewed fails, the banner goes back to waiting and says why', async () => {
    const user = userEvent.setup();
    listPatientPrograms.mockResolvedValue([bundle({}, { sessionFeedback: [fb()] })]);
    markPainReviewed.mockRejectedValue(new Error('Network down'));
    renderTab();
    const box = await screen.findByRole('region', { name: 'Alerts' });
    await user.click(within(box).getByRole('button', { name: 'Mark reviewed' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Network down');
    expect(within(box).getByRole('button', { name: 'Mark reviewed' })).toBeInTheDocument();
    expect(within(box).queryByText(/Reviewed ✓/)).toBeNull();
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
  it('switches between active programs with chips, and "Earlier (n)" unfolds the earlier programs at the bottom', async () => {
    const user = userEvent.setup();
    listPatientPrograms.mockResolvedValue([bundle(), bundle({ id: 'p2', title: 'Left shoulder', startDate: day(-3) }), bundle({ id: 'p3', title: 'Old knee', status: 'completed', startDate: day(-60) }, { access: null })]);
    renderTab();
    await screen.findByRole('heading', { name: /Right knee, week 1/ });
    const chips = screen.getByRole('group', { name: 'Programs' });
    expect(within(chips).getByRole('button', { name: 'Right knee, week 1 · active' })).toHaveAttribute('aria-pressed', 'true');
    await user.click(within(chips).getByRole('button', { name: 'Left shoulder · active' }));
    expect(screen.getByRole('heading', { name: /Left shoulder/ })).toBeInTheDocument();
    const fold = screen.getByRole('button', { name: 'Earlier programs (1)' });
    expect(fold).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByRole('button', { name: /^Old knee/ })).toBeNull();
    await user.click(within(chips).getByRole('button', { name: 'Earlier (1)' }));
    expect(fold).toHaveAttribute('aria-expanded', 'true');
    await user.click(screen.getByRole('button', { name: /^Old knee/ }));
    expect(screen.getByRole('heading', { name: /Old knee/ })).toHaveTextContent('Completed');
  });

  it('chips use the card\'s status word (an active program past its last day is "ended") and dot another program with a pain report waiting', async () => {
    listPatientPrograms.mockResolvedValue([
      bundle(),
      bundle({ id: 'p2', title: 'Left shoulder', startDate: day(-12), durationDays: 7, items: [item('sq', 'Squat', { addedOn: day(-12) })] }, { logs: [] }),
      bundle({ id: 'p4', title: 'Neck', startDate: day(-3) }, { sessionFeedback: [fb({ programId: 'p4' })] }),
    ]);
    renderTab();
    await screen.findByRole('heading', { name: /Right knee, week 1/ });
    const chips = screen.getByRole('group', { name: 'Programs' });
    expect(within(chips).getByRole('button', { name: 'Left shoulder · ended' })).toBeInTheDocument();
    expect(within(chips).getByRole('button', { name: 'Neck · active, pain report waiting' })).toBeInTheDocument();
    expect(within(chips).getByRole('button', { name: 'Right knee, week 1 · active' })).toBeInTheDocument();
  });

  it('an empty patient gets the first-program prompt', async () => {
    listPatientPrograms.mockResolvedValue([]);
    renderTab();
    expect(await screen.findByText('No home program yet')).toBeInTheDocument();
    await userEvent.setup().click(screen.getAllByRole('button', { name: '+ New program' })[1]);
    expect(screen.getByRole('dialog', { name: 'program sheet' })).toBeInTheDocument();
  });

  it('Edit program opens the sheet on this program; Send on WhatsApp goes to the patient\'s WhatsApp with the link and no PIN', async () => {
    const user = userEvent.setup();
    renderTab();
    await user.click(await screen.findByRole('button', { name: 'Edit program' }));
    expect(screen.getByRole('dialog', { name: 'program sheet' })).toHaveTextContent('edit p1');
    const href = decodeURIComponent(screen.getByRole('link', { name: 'Send on WhatsApp' }).getAttribute('href') ?? '');
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
    expect(screen.queryByRole('link', { name: 'Send on WhatsApp' })).toBeNull();
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
