// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import { ClinicContext } from '@/app/clinicContext';
import type { Clinic } from '@/domain/types';
import type { Program, ProgramItem, ProgramLog, SessionsPerDay } from '@/domain/hep';
import type { ProgramBundle, SessionFeedback } from '@/services/hepService';
import { ProgramsTab } from './ProgramsTab';

const listClinicPrograms = vi.fn();
const setProgramStatus = vi.fn();
const extendProgram = vi.fn();
const duplicateProgram = vi.fn();
vi.mock('@/services/hepService', async (orig) => ({
  ...(await orig<typeof import('@/services/hepService')>()),
  hepService: {
    listClinicPrograms: (...a: unknown[]) => listClinicPrograms(...a), setProgramStatus: (...a: unknown[]) => setProgramStatus(...a),
    extendProgram: (...a: unknown[]) => extendProgram(...a), duplicateProgram: (...a: unknown[]) => duplicateProgram(...a),
  },
}));
let wide = true;
vi.mock('@/components/useMediaQuery', () => ({ useMediaQuery: () => wide }));
let scope = { isAdmin: true, myTherapistId: 't1' as string | undefined };
vi.mock('@/app/useWorkspaceScope', () => ({ useWorkspaceScope: () => scope }));
vi.mock('@tanstack/react-router', () => ({ Link: ({ children, to, params, search, ...rest }: { children: React.ReactNode; to: string; params?: Record<string, string>; search?: Record<string, string> } & Record<string, unknown>) => <a href={to.replace('$patientId', params?.patientId ?? '') + (search?.view ? `?view=${search.view}` : '')} {...rest}>{children}</a> }));
vi.mock('./HomeProgramTab', () => ({ HomeProgramTab: ({ patientId }: { patientId: string }) => <div data-testid="home-program-popup">Home program for {patientId}</div> }));

const clinic = { id: 'c1', name: 'Sunrise', timezone: 'UTC' } as unknown as Clinic;
const TODAY = new Intl.DateTimeFormat('en-CA', { timeZone: 'UTC', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
const day = (offset: number) => new Date(Date.parse(`${TODAY}T00:00:00Z`) + offset * 86_400_000).toISOString().slice(0, 10);
const item = (id: string): ProgramItem => ({
  id, programId: 'p', title: `Item ${id}`, bodyRegion: 'Knee', phase: 'strengthening', equipment: [], instructions: '', mediaType: 'none', mediaKeys: [], mediaCaptions: [], doseType: 'reps', sets: 3, reps: 10,
  holdSeconds: null, durationSeconds: null, restSeconds: 30, side: 'none', sessionsPerDay: 1, optional: false, sessionsSchedule: [], stopIf: '', specialInstructions: '', sortOrder: 0, addedOn: day(-8), removedOn: null,
});
const log = (itemId: string, logDate: string): ProgramLog => ({ id: itemId + logDate, programItemId: itemId, logDate, sessionIndex: 1 as SessionsPerDay, skipped: false, completedAt: `${logDate}T08:00:00Z` });
const bundle = (id: string, patient: string, p: Partial<Program> = {}, over: Partial<ProgramBundle> = {}): ProgramBundle => ({
  program: { id, clinicId: 'c1', patientId: `pt-${id}`, therapistId: 't1', title: `Program ${id}`, status: 'active', startDate: day(-3), durationDays: 14, targetPct: 70, checkinOn: null, feedbackDefault: 'pain', sessionsPerDay: 1,
    firstOpenedAt: null, painReviewedThrough: null, items: [item(`${id}a`), item(`${id}b`)], createdAt: '', updatedAt: '', ...p },
  patientName: patient, therapistName: 'Meera Rao', logs: [log(`${id}a`, TODAY), log(`${id}b`, TODAY)], sessionFeedback: [], access: { token: 't', linkRevoked: false, openCount: 3, lastOpenedAt: null }, patientPhone: '+91 98765 43210', ...over,
});
const pain: SessionFeedback = { id: 'f', programId: 'p1', logDate: TODAY, sessionIndex: 1, painScore: 8, effortScore: null, painItemIds: ['p1a'], hardItemIds: [], createdAt: new Date().toISOString() };

const BUNDLES = [
  bundle('p1', 'Asha Pillai', {}, { sessionFeedback: [pain] }),               // pain: needs attention
  bundle('p2', 'Ravi Kumar', {}, { logs: [log('p2a', day(-3))] }),            // no activity 3 days: needs attention
  bundle('p3', 'Sunil Rao', { therapistId: 't2' }),                            // fine, someone else's
  bundle('p4', 'Old Patient', { status: 'completed' }),                        // past
  bundle('p5', 'Opened Only', {}, { logs: [], access: { token: 't', linkRevoked: false, openCount: 6, lastOpenedAt: null } }), // grey, not attention
];
function renderTab(props: React.ComponentProps<typeof ProgramsTab> = {}) {
  return render(<ClinicContext.Provider value={clinic}><ProgramsTab {...props} /></ClinicContext.Provider>);
}
const chip = (name: RegExp) => screen.getByRole('button', { name });

beforeEach(() => {
  listClinicPrograms.mockReset().mockResolvedValue(BUNDLES);
  setProgramStatus.mockReset().mockResolvedValue(undefined);
  extendProgram.mockReset().mockResolvedValue(undefined);
  duplicateProgram.mockReset().mockResolvedValue({});
  wide = true; scope = { isAdmin: true, myTherapistId: 't1' };
  Object.defineProperty(navigator, 'onLine', { value: true, configurable: true });
});
afterEach(cleanup);

describe('ProgramsTab', () => {
  it('Needs attention is the default: pain 7+ and no activity 2+ days, most urgent first; "Opened 6×, nothing ticked" is grey and not in it', async () => {
    renderTab();
    expect(await screen.findByText('Asha Pillai')).toBeInTheDocument();
    const names = screen.getAllByRole('row').slice(1).map((r) => within(r).getAllByRole('link')[0].textContent);
    expect(names).toEqual(['Asha Pillai', 'Ravi Kumar']);
    expect(screen.getByText('Pain 8/10 after Item p1a')).toBeInTheDocument();
    expect(screen.getByText('No activity 3 days')).toBeInTheDocument();
    expect(chip(/^Needs attention/)).toHaveTextContent('2');
    expect(screen.queryByText('Opened Only')).toBeNull();
  });

  it('counts each filter, and Active shows the others (including the grey one) while Past shows completed', async () => {
    const user = userEvent.setup();
    renderTab();
    await screen.findByText('Asha Pillai');
    expect(chip(/^Active/)).toHaveTextContent('4');
    expect(chip(/^Recently ended/)).toHaveTextContent('0');
    expect(chip(/^Archived/)).toHaveTextContent('1');
    await user.click(chip(/^Active/));
    expect(screen.getByText('Opened Only')).toBeInTheDocument();
    expect(screen.getByText('Opened 6×, nothing ticked')).toBeInTheDocument();
    await user.click(chip(/^Archived/));
    expect(screen.getByText('Old Patient')).toBeInTheDocument();
  });

  it('My patients | All therapists: a therapist starts on Mine; the Therapist column appears only in All', async () => {
    const user = userEvent.setup();
    scope = { isAdmin: false, myTherapistId: 't1' };
    renderTab();
    await screen.findByText('Asha Pillai');
    expect(screen.queryByRole('columnheader', { name: 'Therapist' })).toBeNull();
    await user.click(chip(/^Active/));
    expect(screen.queryByText('Sunil Rao')).toBeNull();
    await user.click(screen.getByRole('button', { name: 'All therapists' }));
    expect(screen.getByText('Sunil Rao')).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: 'Therapist' })).toBeInTheDocument();
  });

  it('an admin starts on All', async () => {
    renderTab();
    await screen.findByText('Asha Pillai');
    expect(screen.getByRole('button', { name: 'All therapists' })).toHaveAttribute('aria-pressed', 'true');
  });

  it('shows the table columns: today, adherence and last active', async () => {
    const user = userEvent.setup();
    renderTab();
    await screen.findByText('Asha Pillai');
    await user.click(chip(/^Active/));
    const row = screen.getByText('Sunil Rao').closest('tr')!;
    expect(within(row).getByText('2 of 2 sessions')).toBeInTheDocument();
    expect(within(row).getByText(/^\d+%$/)).toBeInTheDocument();
    expect(within(row).getByText('Today')).toBeInTheDocument();
    expect(within(row).getByText('2 exercises · Day 4 of 14')).toBeInTheDocument();
  });

  it('phone cards show the same values as the table rows', async () => {
    wide = false;
    renderTab();
    await screen.findByText('Asha Pillai');
    const cards = screen.getAllByRole('listitem').filter((li) => li.closest('ul')?.className.includes('space-y-2'));
    expect(cards).toHaveLength(2);
    expect(within(cards[0]).getByText('Asha Pillai')).toBeInTheDocument();
    expect(within(cards[0]).getByText('Pain 8/10 after Item p1a')).toBeInTheDocument();
    expect(within(cards[0]).getByText(/2 of 2 sessions/)).toBeInTheDocument();
    expect(screen.queryByRole('table')).toBeNull();
  });

  it('searches by patient or program', async () => {
    const user = userEvent.setup();
    renderTab();
    await screen.findByText('Asha Pillai');
    await user.click(chip(/^Active/));
    await user.type(screen.getByRole('searchbox', { name: 'Search programs' }), 'ravi');
    expect(screen.getByText('Ravi Kumar')).toBeInTheDocument();
    expect(screen.queryByText('Sunil Rao')).toBeNull();
    await user.clear(screen.getByRole('searchbox'));
    await user.type(screen.getByRole('searchbox'), 'zzz');
    expect(screen.getByText(/No programs match/)).toBeInTheDocument();
  });

  it('an ended program is in Needs attention with Prescribe next, and Extend adds days', async () => {
    const user = userEvent.setup();
    const onPrescribeNext = vi.fn();
    listClinicPrograms.mockResolvedValue([bundle('p9', 'Ended Person', { startDate: day(-10), durationDays: 7 })]);
    renderTab({ onPrescribeNext });
    await screen.findByText('Ended Person');
    expect(screen.getByText(/^(Met|Not met)/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Prescribe next' }));
    expect(onPrescribeNext).toHaveBeenCalledWith(expect.objectContaining({ id: 'p9' }), expect.objectContaining({ patientName: 'Ended Person' }));
    await user.click(screen.getByRole('button', { name: /^Actions for Ended Person/ }));
    await user.click(screen.getByRole('button', { name: 'Extend' }));
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: '14 days' }));
    await waitFor(() => expect(extendProgram).toHaveBeenCalledWith('p9', 14));
    await waitFor(() => expect(listClinicPrograms).toHaveBeenCalledTimes(2));
  });

  it('Message appears on an active row only when the chart work is wired', async () => {
    const user = userEvent.setup();
    const onMessage = vi.fn();
    const { unmount } = renderTab();
    await screen.findByText('Asha Pillai');
    expect(screen.queryByRole('button', { name: 'Message' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Open' })).toBeInTheDocument();
    unmount();
    renderTab({ onMessage });
    await user.click((await screen.findAllByRole('button', { name: 'Message' }))[0]);
    expect(onMessage).toHaveBeenCalledWith(expect.objectContaining({ id: 'p2' }), expect.objectContaining({ patientName: 'Ravi Kumar' }));
  });

  it('Pause, Resume and Mark completed (after asking) change the status without touching the exercises', async () => {
    const user = userEvent.setup();
    renderTab();
    await screen.findByText('Asha Pillai');
    await user.click(screen.getByRole('button', { name: /^Actions for Asha Pillai/ }));
    await user.click(screen.getByRole('button', { name: 'Pause' }));
    await waitFor(() => expect(setProgramStatus).toHaveBeenCalledWith('p1', 'paused'));
    await user.click(screen.getByRole('button', { name: /^Actions for Asha Pillai/ }));
    await user.click(screen.getByRole('button', { name: 'Mark completed' }));
    expect(setProgramStatus).toHaveBeenCalledTimes(1);
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Mark completed' }));
    await waitFor(() => expect(setProgramStatus).toHaveBeenCalledWith('p1', 'completed'));
  });

  it('a paused program offers Resume, and the database\'s message (for example the free-plan limit) is shown', async () => {
    const user = userEvent.setup();
    listClinicPrograms.mockResolvedValue([bundle('p8', 'Paused Person', { status: 'paused' })]);
    setProgramStatus.mockRejectedValue(new Error('You have reached the free-plan limit of 5 active programs. Visit theranet.in to upgrade.'));
    renderTab();
    await user.click(await screen.findByRole('button', { name: /^Active/ }));
    await user.click(await screen.findByRole('button', { name: /^Actions for Paused Person/ }));
    await user.click(screen.getByRole('button', { name: 'Resume' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('free-plan limit of 5 active programs');
  });

  it('Past rows offer Duplicate', async () => {
    const user = userEvent.setup();
    renderTab();
    await screen.findByText('Asha Pillai');
    await user.click(chip(/^Archived/));
    await user.click(screen.getByRole('button', { name: /^Actions for Old Patient/ }));
    await user.click(screen.getByRole('button', { name: 'Duplicate' }));
    await waitFor(() => expect(duplicateProgram).toHaveBeenCalledWith('p4'));
  });

  it('offline, with nothing loaded, says programs need a connection', () => {
    Object.defineProperty(navigator, 'onLine', { value: false, configurable: true });
    renderTab();
    expect(screen.getByText(/Programs need a connection/)).toBeInTheDocument();
    expect(listClinicPrograms).not.toHaveBeenCalled();
  });

  it('says so when nothing needs attention, and when there are no programs at all', async () => {
    listClinicPrograms.mockResolvedValue([bundle('p3', 'Sunil Rao')]);
    const { unmount } = renderTab();
    expect(await screen.findByText('Nothing needs attention right now.')).toBeInTheDocument();
    unmount();
    listClinicPrograms.mockResolvedValue([]);
    renderTab();
    expect(await screen.findByText(/No programs yet/)).toBeInTheDocument();
  });

  it('has the five filter labels and the owner toggle labels', async () => {
    renderTab();
    await screen.findByText('Asha Pillai');
    for (const n of [/^Needs attention/, /^Active/, /^Ending this week/, /^Recently ended/, /^Archived/]) expect(chip(n)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'My patients' })).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: 'Adherence, last 14 days' })).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: 'Alerts' })).toBeInTheDocument();
  });

  it('Ending this week lists active programs whose last day is within 6 days', async () => {
    const user = userEvent.setup();
    listClinicPrograms.mockResolvedValue([bundle('e1', 'Ending Soon', { startDate: day(-3), durationDays: 7 }), bundle('e2', 'Far Away', { startDate: day(-3), durationDays: 30 })]);
    renderTab();
    await screen.findByRole('button', { name: /^Active/ });
    expect(chip(/^Ending this week/)).toHaveTextContent('1');
    await user.click(chip(/^Ending this week/));
    expect(screen.getByText('Ending Soon')).toBeInTheDocument();
    expect(screen.queryByText('Far Away')).toBeNull();
  });

  it('draws the 14-day strip with the percentage under it, or "Not enough data"', async () => {
    const user = userEvent.setup();
    listClinicPrograms.mockResolvedValue([bundle('s1', 'Strip Person'), bundle('s2', 'New Person', { startDate: TODAY })]);
    renderTab();
    await user.click(await screen.findByRole('button', { name: /^Active/ }));
    const row = screen.getByText('Strip Person').closest('tr')!;
    expect(within(row).getAllByRole('img', { name: /^\d{4}-\d{2}-\d{2}:/ })).toHaveLength(14);
    expect(within(screen.getByText('New Person').closest('tr')!).getByText('Not enough data')).toBeInTheDocument();
  });

  it('the strip shows on phone cards too', async () => {
    wide = false;
    renderTab();
    await screen.findByText('Asha Pillai');
    const card = screen.getByText('Asha Pillai').closest('li')!;
    expect(within(card).getAllByRole('img', { name: /^\d{4}-\d{2}-\d{2}:/ })).toHaveLength(14);
  });

  it('a red alert with a phone is "Call" (tel: link built from the clinic country code); without a phone it is "Open"', async () => {
    listClinicPrograms.mockResolvedValue([
      bundle('c1', 'Has Phone', {}, { sessionFeedback: [{ ...pain, programId: 'c1', painItemIds: ['c1a'] }], patientPhone: '9876543210' }),
      bundle('c2', 'No Phone', {}, { sessionFeedback: [{ ...pain, programId: 'c2', painItemIds: ['c2a'] }], patientPhone: null }),
    ]);
    renderTab();
    await screen.findByText('Has Phone');
    const call = within(screen.getByText('Has Phone').closest('tr')!).getByRole('link', { name: 'Call' });
    expect(call).toHaveAttribute('href', 'tel:+919876543210');
    const noPhone = screen.getByText('No Phone').closest('tr')!;
    expect(within(noPhone).queryByRole('link', { name: 'Call' })).toBeNull();
    expect(within(noPhone).getByRole('button', { name: 'Open' })).toBeInTheDocument();
  });

  it('an amber alert is "Message", and no alert is "Open"', async () => {
    const user = userEvent.setup();
    renderTab({ onMessage: vi.fn() });
    await screen.findByText('Ravi Kumar');
    expect(within(screen.getByText('Ravi Kumar').closest('tr')!).getByRole('button', { name: 'Message' })).toBeInTheDocument();
    await user.click(chip(/^Active/));
    expect(within(screen.getByText('Sunil Rao').closest('tr')!).getByRole('button', { name: 'Open' })).toBeInTheDocument();
  });

  it('clicking Open opens the Home program in an in-place sheet with a Patient chart link and reloads on close', async () => {
    const user = userEvent.setup();
    const onReload = vi.fn().mockResolvedValue(undefined);
    renderTab({ programs: BUNDLES, programsError: null, onReload });
    await user.click(chip(/^Active/));
    await user.click(within(screen.getByText('Sunil Rao').closest('tr')!).getByRole('button', { name: 'Open' }));

    const dialog = screen.getByRole('dialog', { name: 'Sunil Rao — Home program' });
    expect(within(dialog).getByTestId('home-program-popup')).toHaveTextContent('Home program for pt-p3');
    const chartLink = within(dialog).getByRole('link', { name: 'Patient chart →' });
    expect(chartLink).toHaveAttribute('href', '/patients/pt-p3?view=home-program');

    await user.click(within(dialog).getByRole('button', { name: 'Close' }));
    expect(screen.queryByRole('dialog', { name: 'Sunil Rao — Home program' })).toBeNull();
    expect(onReload).toHaveBeenCalledTimes(1);
  });

  it('offers "+ New program" in the top row when wired, and disables it when offline', async () => {
    const user = userEvent.setup();
    const onNewProgram = vi.fn();
    renderTab({ onNewProgram });
    await screen.findByText('Asha Pillai');
    await user.click(screen.getByRole('button', { name: '+ New program' }));
    expect(onNewProgram).toHaveBeenCalledTimes(1);

    Object.defineProperty(navigator, 'onLine', { value: false, configurable: true });
    window.dispatchEvent(new Event('offline'));
    expect(await screen.findByRole('button', { name: 'Needs a connection' })).toBeDisabled();
  });

  it('reuses shared programs props without fetching again, and calls onReload after an action', async () => {
    const user = userEvent.setup();
    const onReload = vi.fn().mockResolvedValue(undefined);
    listClinicPrograms.mockClear();
    renderTab({ programs: BUNDLES, programsError: null, onReload });
    expect(screen.getByText('Asha Pillai')).toBeInTheDocument();
    expect(listClinicPrograms).not.toHaveBeenCalled();

    await user.click(screen.getByRole('button', { name: 'Actions for Asha Pillai, Program p1' }));
    await user.click(screen.getByRole('button', { name: 'Pause' }));
    await waitFor(() => expect(onReload).toHaveBeenCalledTimes(1));
    expect(listClinicPrograms).not.toHaveBeenCalled();
  });
});
