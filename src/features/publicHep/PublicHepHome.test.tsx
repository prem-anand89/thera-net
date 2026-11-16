// @vitest-environment jsdom
// The signed-in patient page's two tabs (Home and Exercises), the Home RPC's "verify once" rule, and the richer
// exercise page. The sign-in, checklist and session-check flows are covered in PublicHepPage.test.tsx.
import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen, waitFor, within, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PublicHepHome } from '@/services/publicHepService';
import { hepData, item, log } from './hepTestData';
import { PublicHepPage } from './PublicHepPage';

const svc = vi.hoisted(() => ({
  clinicBrand: vi.fn(), getPublicHep: vi.fn(), getPublicHome: vi.fn(), rememberDevice: vi.fn(), submitExerciseLog: vi.fn(), undoExerciseLog: vi.fn(), submitSessionFeedback: vi.fn(),
}));
vi.mock('@/services/publicHepService', () => ({ publicHepService: svc }));
vi.mock('@tanstack/react-router', () => ({ useParams: () => ({ token: 'tok' }) }));
vi.mock('@/lib/supabase', () => ({ publicLogoUrl: () => null }));

const wall = item({ id: 'i1', title: 'Wall Slides', sortOrder: 0 });
const clam = item({ id: 'i2', title: 'Clamshell', sortOrder: 1 });

const fullHome: Omit<PublicHepHome, 'ok'> = {
  firstName: 'Shiva',
  bookingSlug: 'sunrise',
  nextVisit: { at: '2026-11-18T12:00:00Z', therapistName: 'Prem', location: 'clinic' },
  package: { name: 'Physio 10-pack', done: 4, total: 10, expiresOn: '2026-12-31' },
  programs: [
    { id: 'p1', title: 'Knee program', status: 'active', startDate: '2026-11-10', durationDays: 14, itemCount: 2 },
    { id: 'p2', title: 'Neck mobility', status: 'active', startDate: '2026-11-13', durationDays: 7, itemCount: 3 },
    { id: 'p0', title: 'Lower back basics', status: 'completed', startDate: '2026-09-09', durationDays: 15, itemCount: 4 },
  ],
};
const emptyHome: Omit<PublicHepHome, 'ok'> = { firstName: 'Shiva', bookingSlug: null, nextVisit: null, package: null, programs: [{ id: 'p1', title: 'Knee program', status: 'active', startDate: '2026-11-10', durationDays: 14, itemCount: 2 }] };

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'], now: new Date('2026-11-14T06:00:00Z') });
  for (const fn of Object.values(svc)) fn.mockReset();
  svc.clinicBrand.mockResolvedValue({ ok: true, name: 'Sunrise Physiotherapy', logoPath: null });
  svc.rememberDevice.mockResolvedValue({ ok: true, device: 'dev-1' });
  svc.submitExerciseLog.mockResolvedValue({ ok: true, logDate: '2026-11-14' });
  svc.getPublicHome.mockResolvedValue({ ok: true, ...fullHome });
  localStorage.clear();
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

async function openWithDevice(data = hepData([wall, clam])) {
  localStorage.setItem('hep-device:tok', 'dev-1');
  svc.getPublicHep.mockResolvedValue({ ok: true, ...data });
  render(<PublicHepPage />);
  await screen.findByRole('heading', { name: 'Knee program' });
  return userEvent.setup();
}

describe('the tab bar', () => {
  it('opens on Home, and the header keeps the reminder and call buttons on both tabs', async () => {
    const u = await openWithDevice();
    expect(screen.getByRole('tab', { name: 'Home' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('button', { name: 'Add a daily reminder' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Call the clinic' })).toHaveAttribute('href', 'tel:+919876543210');
    await u.click(screen.getByRole('tab', { name: 'Exercises' }));
    expect(screen.getByRole('tab', { name: 'Exercises' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('button', { name: 'Add a daily reminder' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Call the clinic' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Open Wall Slides' })).toBeInTheDocument();
  });
});

describe('Home', () => {
  it('shows the greeting, Today, this week, next visit, package, other and earlier programs, Book and Call', async () => {
    await openWithDevice(hepData([wall, clam], { logs: [log('i1')] }));
    expect(await screen.findByText('Hi Shiva')).toBeInTheDocument();
    expect(screen.getByText('Here is where things stand.')).toBeInTheDocument();

    const todayCard = screen.getByRole('region', { name: 'Today' });
    expect(within(todayCard).getByText('From Meera · 2 exercises · once a day')).toBeInTheDocument();
    expect(within(todayCard).getByText('Day 5 of 14')).toBeInTheDocument();
    expect(within(todayCard).getByText('1 of 2 done')).toBeInTheDocument();
    expect(within(todayCard).getByRole('button', { name: 'Continue my exercises' })).toBeInTheDocument();

    const week = screen.getByRole('region', { name: 'This week' });
    expect(within(week).getByLabelText('Sat: partly done, today')).toBeInTheDocument();
    expect(within(week).getByLabelText('Tue: missed')).toBeInTheDocument();

    const visit = screen.getByRole('region', { name: 'Next visit' });
    expect(within(visit).getByText('Wed, 18 Nov at 5:30 PM')).toBeInTheDocument();
    expect(within(visit).getByText('With Prem · Sunrise Physiotherapy')).toBeInTheDocument();

    const pack = screen.getByRole('region', { name: 'Your package' });
    expect(within(pack).getByText('Physio 10-pack')).toBeInTheDocument();
    expect(within(pack).getByText('6 of 10 left')).toBeInTheDocument();
    expect(within(pack).getByText('Valid until 31/12/26')).toBeInTheDocument();

    const others = screen.getByRole('region', { name: 'Other programs' });
    expect(within(others).getByText('Neck mobility')).toBeInTheDocument();
    expect(within(others).queryByText('Knee program')).toBeNull();
    expect(within(others).getByText('Earlier programs (1)')).toBeInTheDocument();
    expect(within(others).getByText('Lower back basics · 09/09/26 to 23/09/26')).toBeInTheDocument();

    expect(screen.getByRole('link', { name: /Book a visit/ })).toHaveAttribute('href', '/book/sunrise');
    expect(screen.getByRole('link', { name: /Call clinic/ })).toHaveAttribute('href', 'tel:+919876543210');
  });

  it('hides the cards it has nothing for: no visit, no package, no other programs, no booking', async () => {
    svc.getPublicHome.mockResolvedValue({ ok: true, ...emptyHome });
    await openWithDevice();
    await screen.findByText('Hi Shiva');
    expect(screen.getByRole('region', { name: 'Today' })).toBeInTheDocument();
    for (const name of ['Next visit', 'Your package', 'Other programs']) expect(screen.queryByRole('region', { name })).toBeNull();
    expect(screen.queryByText(/Earlier programs/)).toBeNull();
    expect(screen.queryByRole('link', { name: /Book a visit/ })).toBeNull();
    expect(screen.getByRole('link', { name: /Call clinic/ })).toBeInTheDocument();
  });

  it('shows only the Today card when the Home call fails, and the Exercises tab still works', async () => {
    svc.getPublicHome.mockRejectedValue(new Error('function get_public_hep_home does not exist'));
    const u = await openWithDevice();
    await waitFor(() => expect(svc.getPublicHome).toHaveBeenCalled());
    expect(screen.getByRole('region', { name: 'Today' })).toBeInTheDocument();
    expect(screen.queryByText(/^Hi /)).toBeNull();
    expect(screen.queryByRole('region', { name: 'This week' })).toBeNull();
    expect(screen.queryByRole('link', { name: /Book a visit/ })).toBeNull();
    await u.click(screen.getByRole('tab', { name: 'Exercises' }));
    expect(screen.getByRole('button', { name: 'Open Wall Slides' })).toBeInTheDocument();
  });

  it('Start my exercises switches to the Exercises tab', async () => {
    const u = await openWithDevice();
    await u.click(screen.getByRole('button', { name: 'Start my exercises' }));
    expect(screen.getByRole('tab', { name: 'Exercises' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('button', { name: /Start: Wall Slides/ })).toBeInTheDocument();
  });

  it('Open on another program switches the shown program', async () => {
    const u = await openWithDevice();
    const neck = { ...hepData([item({ id: 'n1', title: 'Chin Tucks' })]), shownProgramId: 'p2', programs: [{ id: 'p2', title: 'Neck mobility', startDate: '2026-11-13', durationDays: 7, feedbackDefault: 'pain' as const, prescribedBy: null }] };
    svc.getPublicHep.mockResolvedValueOnce({ ok: true, ...neck });
    await u.click(within(await screen.findByRole('region', { name: 'Other programs' })).getByRole('button', { name: 'Open Neck mobility' }));
    expect(svc.getPublicHep).toHaveBeenLastCalledWith(expect.objectContaining({ programId: 'p2', device: 'dev-1' }));
    expect(await screen.findByRole('heading', { name: 'Neck mobility' })).toBeInTheDocument();
    expect(svc.getPublicHome).toHaveBeenCalledTimes(1);
  });
});

describe('verifying once', () => {
  it('a remembered phone asks for Home with its device token, once, after the program loaded', async () => {
    await openWithDevice();
    await waitFor(() => expect(svc.getPublicHome).toHaveBeenCalledTimes(1));
    expect(svc.getPublicHome).toHaveBeenCalledWith({ token: 'tok', pin: null, device: 'dev-1' });
    expect(svc.getPublicHome.mock.invocationCallOrder[0]).toBeGreaterThan(svc.getPublicHep.mock.invocationCallOrder[0]);
  });

  it('after the PIN with "remember" ticked, Home uses the new device token, not the PIN', async () => {
    svc.getPublicHep.mockResolvedValue({ ok: true, ...hepData([wall]) });
    render(<PublicHepPage />);
    await userEvent.setup().type(await screen.findByLabelText('Your 4-digit PIN'), '1234');
    await screen.findByRole('heading', { name: 'Knee program' });
    await waitFor(() => expect(svc.getPublicHome).toHaveBeenCalledTimes(1));
    expect(svc.getPublicHome).toHaveBeenCalledWith({ token: 'tok', pin: null, device: 'dev-1' });
    expect(svc.getPublicHep).toHaveBeenCalledTimes(1);
  });

  it('after the PIN without "remember", Home uses the same PIN once; a wrong PIN never reaches Home', async () => {
    svc.getPublicHep.mockResolvedValueOnce({ ok: false, reason: 'wrong_pin', attemptsLeft: 4 });
    render(<PublicHepPage />);
    const u = userEvent.setup();
    await u.click(await screen.findByLabelText('Remember this phone for 30 days'));
    await u.type(screen.getByLabelText('Your 4-digit PIN'), '0000');
    await screen.findByText(/That PIN isn't right/);
    expect(svc.getPublicHome).not.toHaveBeenCalled();
    svc.getPublicHep.mockResolvedValue({ ok: true, ...hepData([wall]) });
    await u.type(screen.getByLabelText('Your 4-digit PIN'), '1234');
    await screen.findByRole('heading', { name: 'Knee program' });
    await waitFor(() => expect(svc.getPublicHome).toHaveBeenCalledTimes(1));
    expect(svc.getPublicHome).toHaveBeenCalledWith({ token: 'tok', pin: '1234', device: null });
  });

  it('a Home answer of pin_needed does not sign the patient out', async () => {
    svc.getPublicHome.mockResolvedValue({ ok: false, reason: 'pin_needed' });
    await openWithDevice();
    await waitFor(() => expect(svc.getPublicHome).toHaveBeenCalled());
    expect(screen.getByRole('heading', { name: 'Knee program' })).toBeInTheDocument();
    expect(screen.queryByLabelText('Your 4-digit PIN')).toBeNull();
  });
});

describe('Home answers that arrive late, and Home is asked once', () => {
  it('a late Home answer after "Forget this phone" is dropped, and a new sign-in never shows the old patient', async () => {
    let late: (v: unknown) => void = () => {};
    svc.getPublicHome.mockReturnValueOnce(new Promise((r) => { late = r; }));
    const u = await openWithDevice();
    await waitFor(() => expect(svc.getPublicHome).toHaveBeenCalledTimes(1));
    await u.click(screen.getByRole('tab', { name: 'Exercises' }));
    await u.click(screen.getAllByRole('button', { name: 'Forget this phone' })[0]);
    await screen.findByLabelText('Your 4-digit PIN');
    svc.getPublicHome.mockReturnValue(new Promise(() => {}));
    svc.getPublicHep.mockResolvedValue({ ok: true, ...hepData([wall]) });
    await act(async () => { late({ ok: true, ...fullHome }); });
    await u.type(screen.getByLabelText('Your 4-digit PIN'), '1234');
    await screen.findByRole('heading', { name: 'Knee program' });
    expect(screen.queryByText('Hi Shiva')).toBeNull();
  });

  it('refreshing picture links and switching programs never ask for Home again', async () => {
    const u = await openWithDevice(hepData([item({ id: 'i9', title: 'Heel Raises', mediaType: 'stills', mediaUrls: ['https://signed/a', 'https://signed/b'], mediaCaptions: ['', ''] })]));
    await waitFor(() => expect(svc.getPublicHome).toHaveBeenCalledTimes(1));
    vi.setSystemTime(new Date('2026-11-14T06:05:00Z'));
    await u.click(screen.getByRole('tab', { name: 'Exercises' }));
    await u.click(screen.getByRole('button', { name: 'Open Heel Raises' }));
    const hepCalls = svc.getPublicHep.mock.calls.length;
    fireEvent.error(screen.getAllByRole('img')[0]);
    await waitFor(() => expect(svc.getPublicHep.mock.calls.length).toBe(hepCalls + 1));
    expect(svc.getPublicHep).toHaveBeenLastCalledWith(expect.objectContaining({ reason: 'refresh' }));
    expect(svc.getPublicHome).toHaveBeenCalledTimes(1);
  });
});

describe('pictures in the list and on the exercise page', () => {
  const pic = (over = {}) => item({ id: 'i9', title: 'Heel Raises', mediaType: 'stills', mediaUrls: ['https://signed/a', 'https://signed/b'], mediaCaptions: ['', ''], ...over });

  it('a row with no pictures has no thumbnail and no letter tile; a row with pictures has one', async () => {
    const u = await openWithDevice(hepData([wall, pic()]));
    await u.click(screen.getByRole('tab', { name: 'Exercises' }));
    const plain = screen.getByRole('button', { name: 'Open Wall Slides' });
    expect(plain.querySelector('img')).toBeNull();
    expect(within(plain).queryByText('W')).toBeNull();
    expect(screen.getByRole('button', { name: 'Open Heel Raises' }).querySelector('img')).toHaveAttribute('src', 'https://signed/a');
  });

  it('"Hide pictures in lists" hides the thumbnail but the exercise page still shows the pictures', async () => {
    const u = await openWithDevice(hepData([pic({ hidePicturesInLists: true })]));
    await u.click(screen.getByRole('tab', { name: 'Exercises' }));
    const row = screen.getByRole('button', { name: 'Open Heel Raises' });
    expect(row.querySelector('img')).toBeNull();
    await u.click(row);
    expect(screen.getAllByRole('img').map((i) => i.getAttribute('src'))).toEqual(['https://signed/a', 'https://signed/b']);
  });

  it('an exercise page without pictures has no picture box and no title tile', async () => {
    const u = await openWithDevice(hepData([wall]));
    await u.click(screen.getByRole('tab', { name: 'Exercises' }));
    await u.click(screen.getByRole('button', { name: 'Open Wall Slides' }));
    expect(screen.getByRole('heading', { name: 'Wall Slides' })).toBeInTheDocument();
    expect(screen.queryByRole('img')).toBeNull();
  });
});

describe('the exercise page', () => {
  it('shows Sets, Reps and Hold boxes, and set circles that toggle without saving anything', async () => {
    const hold = item({ id: 'i1', title: 'Wall Slides', doseType: 'hold', sets: 3, reps: 12, holdSeconds: 3 });
    const u = await openWithDevice(hepData([hold]));
    await u.click(screen.getByRole('tab', { name: 'Exercises' }));
    await u.click(screen.getByRole('button', { name: 'Open Wall Slides' }));
    const dose = screen.getByRole('group', { name: '3 sets · 12 reps · hold 3 s' });
    expect(within(dose).getByText('sets')).toBeInTheDocument();
    expect(within(dose).getByText('12')).toBeInTheDocument();
    expect(within(dose).getByText('3 s')).toBeInTheDocument();

    const sets = screen.getByRole('group', { name: 'Sets · tap each one when done' });
    expect(within(sets).getAllByRole('button')).toHaveLength(3);
    await u.click(within(sets).getByRole('button', { name: 'Set 2' }));
    expect(within(sets).getByRole('button', { name: 'Set 1' })).toHaveAttribute('aria-pressed', 'true');
    expect(within(sets).getByRole('button', { name: 'Set 2' })).toHaveAttribute('aria-pressed', 'true');
    expect(within(sets).getByRole('button', { name: 'Set 3' })).toHaveAttribute('aria-pressed', 'false');
    await u.click(within(sets).getByRole('button', { name: 'Set 2' }));
    expect(within(sets).getByRole('button', { name: 'Set 2' })).toHaveAttribute('aria-pressed', 'false');
    expect(svc.submitExerciseLog).not.toHaveBeenCalled();
  });

  it('has no set circles for a single set, shows only 2 boxes when there is no hold or rest, and shows rest when restSeconds > 0', async () => {
    const timed = item({ id: 'i1', title: 'Plank', doseType: 'timed', sets: 1, reps: null, durationSeconds: 30, restSeconds: 0 });
    const repsRest = item({ id: 'i2', title: 'Mini Squats', doseType: 'reps', sets: 3, reps: 10, restSeconds: 45, sortOrder: 1 });
    const u = await openWithDevice(hepData([timed, repsRest]));
    await u.click(screen.getByRole('tab', { name: 'Exercises' }));
    await u.click(screen.getByRole('button', { name: 'Open Plank' }));
    const dose = screen.getByRole('group', { name: '1 set · 30 s' });
    expect(within(dose).getByText('30 s')).toBeInTheDocument();
    expect(within(dose).queryByText('no hold')).toBeNull();
    expect(dose.children).toHaveLength(2);
    expect(screen.queryByRole('group', { name: 'Sets · tap each one when done' })).toBeNull();

    await u.click(screen.getByRole('button', { name: 'Next exercise' }));
    const dose2 = screen.getByRole('group', { name: '3 sets · 10 reps' });
    expect(dose2.children).toHaveLength(3);
    expect(within(dose2).getByText('45 s')).toBeInTheDocument();
    expect(within(dose2).getByText('rest')).toBeInTheDocument();
  });
});
