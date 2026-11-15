// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { hepData, item, log } from './hepTestData';
import { PublicHepPage } from './PublicHepPage';

const svc = vi.hoisted(() => ({
  clinicBrand: vi.fn(), getPublicHep: vi.fn(), rememberDevice: vi.fn(), submitExerciseLog: vi.fn(), undoExerciseLog: vi.fn(), submitSessionFeedback: vi.fn(),
}));
vi.mock('@/services/publicHepService', () => ({ publicHepService: svc }));
vi.mock('@tanstack/react-router', () => ({ useParams: () => ({ token: 'tok' }) }));
vi.mock('@/lib/supabase', () => ({ publicLogoUrl: () => null }));

const wall = item({ id: 'i1', title: 'Wall Slides', sortOrder: 0 });
const clam = item({ id: 'i2', title: 'Clamshell', sortOrder: 1 });
const bridge = item({ id: 'i3', title: 'Glute Bridge', sortOrder: 2, phase: 'warm_up' });

const ok = { ok: true } as const;
const brandOk = { ok: true, name: 'Sunrise Physiotherapy', logoPath: null };

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'], now: new Date('2026-11-14T06:00:00Z') });
  for (const fn of Object.values(svc)) fn.mockReset();
  svc.clinicBrand.mockResolvedValue(brandOk);
  svc.rememberDevice.mockResolvedValue({ ok: true, device: 'dev-1' });
  svc.submitExerciseLog.mockResolvedValue({ ...ok, logDate: '2026-11-14' });
  svc.undoExerciseLog.mockResolvedValue(ok);
  svc.submitSessionFeedback.mockResolvedValue(ok);
  localStorage.clear();
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  document.head.querySelectorAll('meta[name="robots"]').forEach((m) => m.remove());
});

const user = () => userEvent.setup();

async function signInWith(data: ReturnType<typeof hepData>) {
  svc.getPublicHep.mockResolvedValue({ ok: true, ...data });
  render(<PublicHepPage />);
  const u = user();
  await u.type(await screen.findByLabelText('Your 4-digit PIN'), '1234');
  await screen.findByRole('heading', { name: 'Knee program' });
  return u;
}

describe('signing in', () => {
  it('shows the clinic name, "Your Home Exercise Program", and no exercise or patient name before the PIN', async () => {
    render(<PublicHepPage />);
    expect(await screen.findByText('Sunrise Physiotherapy')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Your Home Exercise Program' })).toBeInTheDocument();
    expect(screen.queryByText('Wall Slides')).toBeNull();
    expect(svc.getPublicHep).not.toHaveBeenCalled();
  });

  it('tells iPhone users to open the link in Safari, and nobody else', async () => {
    const ua = vi.spyOn(navigator, 'userAgent', 'get');
    ua.mockReturnValue('Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)');
    const first = render(<PublicHepPage />);
    expect(await screen.findByText(/open this link in Safari so it remembers you/)).toBeInTheDocument();
    first.unmount();
    ua.mockReturnValue('Mozilla/5.0 (Linux; Android 14)');
    render(<PublicHepPage />);
    await screen.findByText('Sunrise Physiotherapy');
    expect(screen.queryByText(/open this link in Safari/)).toBeNull();
    ua.mockRestore();
  });

  it('asks search engines not to index the page while it is open', async () => {
    const { unmount } = render(<PublicHepPage />);
    await screen.findByText('Sunrise Physiotherapy');
    expect(document.head.querySelector('meta[name="robots"]')?.getAttribute('content')).toBe('noindex, nofollow');
    unmount();
    expect(document.head.querySelector('meta[name="robots"]')).toBeNull();
  });

  it('shows the generic page with no brand for an unknown or revoked link', async () => {
    svc.clinicBrand.mockResolvedValue({ ok: false, reason: 'unavailable' });
    render(<PublicHepPage />);
    expect(await screen.findByText("This link isn't working. Ask your clinic for a new one.")).toBeInTheDocument();
    expect(screen.queryByLabelText('Your 4-digit PIN')).toBeNull();
    expect(screen.queryByText('Sunrise Physiotherapy')).toBeNull();
  });

  it('says how many tries are left, then that it is locked, and shows no titles', async () => {
    svc.getPublicHep.mockResolvedValueOnce({ ok: false, reason: 'wrong_pin', attemptsLeft: 2 });
    render(<PublicHepPage />);
    const u = user();
    await u.type(await screen.findByLabelText('Your 4-digit PIN'), '0000');
    expect(await screen.findByText("That PIN isn't right. 2 tries left.")).toBeInTheDocument();
    svc.getPublicHep.mockResolvedValueOnce({ ok: false, reason: 'locked', attemptsLeft: 0 });
    await u.type(screen.getByLabelText('Your 4-digit PIN'), '1111');
    expect(await screen.findByText('Too many tries. Please try again in 15 minutes.')).toBeInTheDocument();
    expect(screen.queryByText('Wall Slides')).toBeNull();
  });

  it('says "Please wait a minute and try again" when the server answers busy', async () => {
    svc.getPublicHep.mockResolvedValueOnce({ ok: false, reason: 'busy' });
    render(<PublicHepPage />);
    await user().type(await screen.findByLabelText('Your 4-digit PIN'), '1234');
    expect(await screen.findByText('Please wait a minute and try again.')).toBeInTheDocument();
  });

  it('opens with the PIN, remembers the phone by default, and never stores the PIN', async () => {
    await signInWith(hepData([wall]));
    expect(svc.getPublicHep).toHaveBeenCalledWith({ token: 'tok', pin: '1234' });
    expect(svc.rememberDevice).toHaveBeenCalledWith('tok', '1234');
    expect(localStorage.getItem('hep-device:tok')).toBe('dev-1');
    expect(JSON.stringify({ ...localStorage })).not.toContain('1234');
  });

  it('does not remember the phone when the box is unticked', async () => {
    svc.getPublicHep.mockResolvedValue({ ok: true, ...hepData([wall]) });
    render(<PublicHepPage />);
    const u = user();
    await u.click(await screen.findByLabelText('Remember this phone for 30 days'));
    await u.type(screen.getByLabelText('Your 4-digit PIN'), '1234');
    await screen.findByRole('heading', { name: 'Knee program' });
    expect(svc.rememberDevice).not.toHaveBeenCalled();
    expect(localStorage.getItem('hep-device:tok')).toBeNull();
  });
});

describe('a remembered phone', () => {
  it('opens without a PIN', async () => {
    localStorage.setItem('hep-device:tok', 'dev-1');
    svc.getPublicHep.mockResolvedValue({ ok: true, ...hepData([wall]) });
    render(<PublicHepPage />);
    expect(await screen.findByRole('heading', { name: 'Knee program' })).toBeInTheDocument();
    expect(svc.getPublicHep).toHaveBeenCalledWith({ token: 'tok', device: 'dev-1' });
    expect(svc.clinicBrand).not.toHaveBeenCalled();
  });

  it('falls back to the PIN screen on pin_needed and forgets the stale token', async () => {
    localStorage.setItem('hep-device:tok', 'old');
    svc.getPublicHep.mockResolvedValue({ ok: false, reason: 'pin_needed' });
    render(<PublicHepPage />);
    expect(await screen.findByLabelText('Your 4-digit PIN')).toBeInTheDocument();
    expect(localStorage.getItem('hep-device:tok')).toBeNull();
  });

  it('Forget this phone removes the device token and returns to the PIN screen', async () => {
    localStorage.setItem('hep-device:tok', 'dev-1');
    svc.getPublicHep.mockResolvedValue({ ok: true, ...hepData([wall]) });
    render(<PublicHepPage />);
    await screen.findByRole('heading', { name: 'Knee program' });
    await user().click(screen.getByRole('button', { name: 'Forget this phone' }));
    expect(localStorage.getItem('hep-device:tok')).toBeNull();
    expect(await screen.findByLabelText('Your 4-digit PIN')).toBeInTheDocument();
  });

  it('sends the device token, not the PIN, once the phone is remembered', async () => {
    const u = await signInWith(hepData([wall]));
    await u.click(screen.getByRole('button', { name: 'Mark Wall Slides as done' }));
    await waitFor(() => expect(svc.submitExerciseLog).toHaveBeenCalled());
    expect(svc.submitExerciseLog.mock.calls[0][0]).toMatchObject({ token: 'tok', device: 'dev-1', pin: null });
  });
});

describe('the checklist', () => {
  it('shows the day, and "Today: 3 of 8 done" counting sessions rather than exercises', async () => {
    const four = ['a', 'b', 'c', 'd'].map((id, i) => item({ id, title: `Ex ${id}`, sortOrder: i, sessionsPerDay: 2 }));
    await signInWith(hepData(four, { logs: [log('a', 1), log('b', 1), log('c', 2)] }));
    expect(screen.getByText(/Day 5 of 14/)).toBeInTheDocument();
    expect(screen.getByText(/Today: 3 of 8 done/)).toBeInTheDocument();
  });

  it('one tap on the tick logs the session and offers Undo; Undo calls undo', async () => {
    const u = await signInWith(hepData([wall, clam]));
    await u.click(screen.getByRole('button', { name: 'Mark Wall Slides as done' }));
    expect(svc.submitExerciseLog).toHaveBeenCalledWith(expect.objectContaining({ itemId: 'i1', sessionIndex: 1, logDate: '2026-11-14', skipped: false }));
    expect(screen.getByText('Marked done: Wall Slides')).toBeInTheDocument();
    expect(screen.getByText(/Today: 1 of 2 done/)).toBeInTheDocument();
    await u.click(screen.getByRole('button', { name: 'Undo' }));
    expect(svc.undoExerciseLog).toHaveBeenCalledWith(expect.objectContaining({ itemId: 'i1', sessionIndex: 1, logDate: '2026-11-14' }));
    expect(screen.getByText(/Today: 0 of 2 done/)).toBeInTheDocument();
  });

  it('a twice-a-day program gets a Morning | Evening switch and one tick per exercise for the chosen session', async () => {
    const twice = item({ id: 'i1', title: 'Wall Slides', sessionsPerDay: 2 });
    const u = await signInWith(hepData([twice]));
    const group = screen.getByRole('group', { name: 'Session' });
    expect(within(group).getByRole('button', { name: /Morning/ })).toHaveAttribute('aria-pressed', 'true');
    await u.click(screen.getByRole('button', { name: 'Mark Wall Slides as done' }));
    expect(svc.submitExerciseLog).toHaveBeenLastCalledWith(expect.objectContaining({ sessionIndex: 1 }));
    await u.click(within(group).getByRole('button', { name: /Evening/ }));
    await u.click(screen.getByRole('button', { name: 'Mark Wall Slides as done' }));
    expect(svc.submitExerciseLog).toHaveBeenLastCalledWith(expect.objectContaining({ sessionIndex: 2 }));
  });

  it('Skip › on a section asks one reason and logs every open exercise in it as skipped', async () => {
    const u = await signInWith(hepData([wall, clam, bridge]));
    const section = screen.getByRole('region', { name: 'Strengthening' });
    await u.click(within(section).getByRole('button', { name: 'Skip ›' }));
    await u.click(within(section).getByRole('button', { name: 'Pain' }));
    await waitFor(() => expect(svc.submitExerciseLog).toHaveBeenCalledTimes(2));
    expect(svc.submitExerciseLog).toHaveBeenCalledWith(expect.objectContaining({ itemId: 'i1', skipped: true, skipReason: 'pain' }));
  });

  it('a section with one open exercise has neither All done nor Skip ›', async () => {
    await signInWith(hepData([wall, clam, bridge], { logs: [log('i2')] }));
    const section = screen.getByRole('region', { name: 'Strengthening' });
    expect(within(section).queryByRole('button', { name: 'All done' })).toBeNull();
    expect(within(section).queryByRole('button', { name: 'Skip ›' })).toBeNull();
  });

  it('the Start button sticks to the bottom and every row ends with a ›', async () => {
    await signInWith(hepData([wall, clam]));
    expect(screen.getByRole('button', { name: /Start: Wall Slides/ })).toHaveClass('sticky', 'bottom-0');
    const rows = screen.getAllByRole('listitem');
    expect(rows).toHaveLength(2);
    for (const row of rows) expect(within(row).getByText('›')).toHaveAttribute('aria-hidden', 'true');
  });

  it('All done on a section logs each open exercise in it as done', async () => {
    const u = await signInWith(hepData([wall, clam, bridge]));
    await u.click(within(screen.getByRole('region', { name: 'Strengthening' })).getByRole('button', { name: 'All done' }));
    await waitFor(() => expect(svc.submitExerciseLog).toHaveBeenCalledTimes(2));
    expect(svc.submitExerciseLog.mock.calls.map(([a]) => a.itemId).sort()).toEqual(['i1', 'i2']);
    expect(svc.submitExerciseLog.mock.calls.every(([a]) => a.skipped === false)).toBe(true);
  });

  it('takes a tap back and says so when it could not be saved', async () => {
    const u = await signInWith(hepData([wall]));
    svc.submitExerciseLog.mockResolvedValueOnce({ ok: false, reason: 'unavailable' });
    await u.click(screen.getByRole('button', { name: 'Mark Wall Slides as done' }));
    expect(await screen.findByRole('alert')).toHaveTextContent("That didn't save");
    expect(screen.getByText(/Today: 0 of 1 done/)).toBeInTheDocument();
  });

  it('says the tap was not saved when the connection fails', async () => {
    const u = await signInWith(hepData([wall]));
    svc.submitExerciseLog.mockRejectedValueOnce(new Error('Failed to fetch'));
    await u.click(screen.getByRole('button', { name: 'Mark Wall Slides as done' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('No connection');
    expect(screen.getByText(/Today: 0 of 1 done/)).toBeInTheDocument();
  });

  it('shows "Optional" and leaves optional exercises out of the count', async () => {
    await signInWith(hepData([wall, item({ id: 'o', title: 'Extra Stretch', optional: true, sortOrder: 1 })]));
    expect(screen.getByText('Optional')).toBeInTheDocument();
    expect(screen.getByText(/Today: 0 of 1 done/)).toBeInTheDocument();
  });

  it('Start opens the first exercise, and Continue the next one that is not done', async () => {
    const u = await signInWith(hepData([wall, clam], { logs: [log('i1')] }));
    await u.click(screen.getByRole('button', { name: /Continue: Clamshell/ }));
    expect(screen.getByRole('heading', { name: 'Clamshell' })).toBeInTheDocument();
  });
});

describe('one exercise at a time', () => {
  const rich = item({ id: 'i1', title: 'Wall Slides', instructions: 'Stand against a wall.\nSlide down slowly.\nPush back up.', stopIf: 'Your knee locks.', equipment: ['Theraband'], side: 'both', doseType: 'hold', sets: 3, reps: 12, holdSeconds: 3, restSeconds: 30 });

  it('shows the dose in one line, "each side", the equipment, the steps and the Stop-if line', async () => {
    const u = await signInWith(hepData([rich]));
    await u.click(screen.getByRole('button', { name: 'Open Wall Slides' }));
    expect(screen.getByText('3 sets · 12 reps · hold 3 s')).toBeInTheDocument();
    expect(screen.getByText(/each side · needs theraband/)).toBeInTheDocument();
    expect(screen.getByText('Slide down slowly.')).toBeInTheDocument();
    expect(screen.getByText(/Your knee locks\./)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Start 12 holds' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Rest 30 s' })).toBeInTheDocument();
  });

  it('opens the steps the first time and collapses them to the first step afterwards', async () => {
    const u = await signInWith(hepData([rich]));
    await u.click(screen.getByRole('button', { name: 'Open Wall Slides' }));
    expect(screen.getByText('Push back up.')).toBeInTheDocument();
    await u.click(screen.getByRole('button', { name: '‹ List' }));
    await u.click(screen.getByRole('button', { name: 'Open Wall Slides' }));
    expect(screen.queryByText('Push back up.')).toBeNull();
    expect(screen.getByText(/1\. Stand against a wall\./)).toBeInTheDocument();
  });

  it('Done · Next marks it done and opens the next exercise that is not done', async () => {
    const u = await signInWith(hepData([wall, clam]));
    await u.click(screen.getByRole('button', { name: 'Open Wall Slides' }));
    await u.click(screen.getByRole('button', { name: '✓ Done · Next ›' }));
    expect(svc.submitExerciseLog).toHaveBeenCalledWith(expect.objectContaining({ itemId: 'i1', skipped: false }));
    expect(screen.getByRole('heading', { name: 'Clamshell' })).toBeInTheDocument();
  });

  it('Skip needs one reason and sends it; after the last exercise it returns to the list', async () => {
    const u = await signInWith(hepData([wall]));
    await u.click(screen.getByRole('button', { name: 'Open Wall Slides' }));
    await u.click(screen.getByRole('button', { name: 'Skip' }));
    expect(svc.submitExerciseLog).not.toHaveBeenCalled();
    await u.click(screen.getByRole('button', { name: 'No time' }));
    expect(svc.submitExerciseLog).toHaveBeenCalledWith(expect.objectContaining({ itemId: 'i1', skipped: true, skipReason: 'no_time' }));
    expect(screen.queryByRole('heading', { name: 'Wall Slides' })).toBeNull();
  });

  it('shows Undo and Next once an exercise has a status', async () => {
    const u = await signInWith(hepData([wall, clam], { logs: [log('i1')] }));
    await u.click(screen.getByRole('button', { name: 'Open Wall Slides' }));
    await u.click(screen.getByRole('button', { name: 'Undo' }));
    expect(svc.undoExerciseLog).toHaveBeenCalledWith(expect.objectContaining({ itemId: 'i1' }));
  });
});

describe('how did this session feel', () => {
  it('appears when every exercise of the session has a status, and sends pain with the marked exercise', async () => {
    const u = await signInWith(hepData([wall, clam], { logs: [log('i2')] }));
    expect(screen.queryByRole('region', { name: 'How did this session feel?' })).toBeNull();
    await u.click(screen.getByRole('button', { name: 'Mark Wall Slides as done' }));
    const card = await screen.findByRole('region', { name: 'How did this session feel?' });
    await u.click(within(card).getByRole('button', { name: '8' }));
    expect(within(card).getByText('Severe')).toBeInTheDocument();
    expect(within(card).getByRole('link', { name: 'Call the clinic' })).toHaveAttribute('href', 'tel:+919876543210');
    await u.click(within(card).getByRole('button', { name: 'Wall Slides' }));
    await u.click(within(card).getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(svc.submitSessionFeedback).toHaveBeenCalled());
    expect(svc.submitSessionFeedback).toHaveBeenCalledWith(expect.objectContaining({ programId: 'p1', sessionIndex: 1, logDate: '2026-11-14', pain: 8, effort: null, painItemIds: ['i1'], hardItemIds: [] }));
    await waitFor(() => expect(screen.queryByRole('region', { name: 'How did this session feel?' })).toBeNull());
  });

  it('opens on Effort when the program asks about effort first, and switching keeps what was entered', async () => {
    const u = await signInWith(hepData([wall], { logs: [log('i1')], programs: [{ id: 'p1', title: 'Knee program', startDate: '2026-11-10', durationDays: 14, feedbackDefault: 'effort', prescribedBy: null }] }));
    const card = await screen.findByRole('region', { name: 'How did this session feel?' });
    expect(within(card).getByRole('button', { name: 'Effort' })).toHaveAttribute('aria-pressed', 'true');
    await u.click(within(card).getByRole('button', { name: '6' }));
    expect(within(card).getByText('Somewhat hard')).toBeInTheDocument();
    await u.click(within(card).getByRole('button', { name: 'Pain' }));
    await u.click(within(card).getByRole('button', { name: '2' }));
    await u.click(within(card).getByRole('button', { name: 'Effort' }));
    expect(within(card).getByRole('button', { name: '6' })).toHaveAttribute('aria-pressed', 'true');
    await u.click(within(card).getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(svc.submitSessionFeedback).toHaveBeenCalledWith(expect.objectContaining({ pain: 2, effort: 6 })));
  });

  it('Not now closes it and it does not come back by itself, but "Rate this session" opens it again', async () => {
    const u = await signInWith(hepData([wall], { logs: [log('i1')] }));
    const card = await screen.findByRole('region', { name: 'How did this session feel?' });
    await u.click(within(card).getByRole('button', { name: 'Not now' }));
    expect(screen.queryByRole('region', { name: 'How did this session feel?' })).toBeNull();
    await u.click(screen.getByRole('button', { name: 'Rate this session' }));
    expect(screen.getByRole('region', { name: 'How did this session feel?' })).toBeInTheDocument();
  });

  it('is available from "Rate this session" before the session is finished', async () => {
    const u = await signInWith(hepData([wall, clam]));
    await u.click(screen.getByRole('button', { name: 'Rate this session' }));
    expect(screen.getByRole('region', { name: 'How did this session feel?' })).toBeInTheDocument();
  });
});
