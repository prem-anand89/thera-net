// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { HepItemInput } from '@/services/hepService';
import { ExercisePreviewPhone, ProgramPreviewDialog } from './PatientPreview';

const mint = vi.hoisted(() => vi.fn());
const cache = vi.hoisted(() => ({ exercises: [] as Array<{ id: string; alsoRegions: string[]; hidePicturesInLists?: boolean }> | undefined }));
const writes = vi.hoisted(() => ({
  hep: new Proxy({}, { get: (t: Record<string, unknown>, k: string) => (t[k] ??= vi.fn()) }) as Record<string, ReturnType<typeof vi.fn>>,
  pub: new Proxy({}, { get: (t: Record<string, unknown>, k: string) => (t[k] ??= vi.fn()) }) as Record<string, ReturnType<typeof vi.fn>>,
}));
vi.mock('@/services/hepMediaService', () => ({ hepMediaService: { mintViewUrls: mint } }));
vi.mock('@/services/hepService', () => ({ hepService: writes.hep }));
vi.mock('@/services/publicHepService', () => ({ publicHepService: writes.pub }));
vi.mock('@/app/clinicContext', () => ({ useClinic: () => ({ id: 'c1', timezone: 'Asia/Kolkata' }) }));
vi.mock('./useHepData', async (orig) => ({ ...(await orig<typeof import('./useHepData')>()), useExercises: () => cache.exercises }));

const input = (over: Partial<HepItemInput> = {}): HepItemInput => ({
  title: 'Bridge', bodyRegion: 'Hip', phase: 'strengthening', instructions: 'Lift your hips.', mediaType: 'none', mediaKeys: [], mediaCaptions: [], equipment: [],
  doseType: 'reps', sets: 3, reps: 10, holdSeconds: null, durationSeconds: null, restSeconds: 0, sessionsPerDay: 1, side: 'none', optional: false, stopIf: '', ...over,
});

beforeEach(() => { cache.exercises = []; mint.mockReset(); mint.mockResolvedValue({ k1: 'https://signed/1', k2: 'https://signed/2' }); });
afterEach(cleanup);

describe('ProgramPreviewDialog', () => {
  const open = (items: HepItemInput[]) =>
    render(<ProgramPreviewDialog open onClose={() => {}} clinicId="c1" clinicName="Sunrise Physio" title="Knee program" items={items} sessionsPerDay={1} />);

  it('shows the checklist inside the phone with the ribbon', async () => {
    open([input(), input({ title: 'Clam', mediaKeys: ['k1'], mediaCaptions: [''] })]);
    expect(screen.getByLabelText('Patient preview')).toBeInTheDocument();
    expect(screen.getByText('Preview · what the patient sees · nothing is saved')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Knee program' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Open Bridge' })).toBeInTheDocument();
    await waitFor(() => expect(mint).toHaveBeenCalledWith('c1', ['k1']));
  });

  it('opens the exercise screen from a row, and ticking Done stays local', async () => {
    const u = userEvent.setup();
    open([input(), input({ title: 'Clam' })]);
    await u.click(screen.getByRole('button', { name: 'Open Clam' }));
    expect(screen.getByRole('heading', { name: 'Clam' })).toBeInTheDocument();
    await u.click(screen.getByRole('button', { name: /List/ }));
    await u.click(screen.getByRole('button', { name: 'Mark Bridge as done' }));
    expect(screen.getByRole('button', { name: 'Undo Bridge' })).toBeInTheDocument();
  });

  it('runs the real flow locally: Start, timer band, Done shows a toast, and nothing is sent anywhere', async () => {
    const u = userEvent.setup();
    open([input({ title: 'Hold it', doseType: 'hold', reps: 2, holdSeconds: 5 }), input({ title: 'Clam' })]);
    await u.click(screen.getByRole('button', { name: 'Open Hold it' }));
    await u.click(screen.getByRole('button', { name: 'Start 2 holds' }));
    expect(screen.getByRole('timer')).toBeInTheDocument();
    await u.click(screen.getByRole('button', { name: /✓ Done/ }));
    expect(screen.getByText('Preview: marked done, nothing saved')).toBeInTheDocument();
    expect(Object.values(writes.hep).concat(Object.values(writes.pub)).every((f) => f.mock.calls.length === 0)).toBe(true);
  });

  it('starts clean each time it opens', async () => {
    const u = userEvent.setup();
    const el = <ProgramPreviewDialog open onClose={() => {}} clinicId="c1" clinicName="S" title="K" items={[input(), input({ title: 'Clam' })]} sessionsPerDay={1} />;
    const r = render(el);
    await u.click(screen.getByRole('button', { name: 'Mark Bridge as done' }));
    r.rerender(<ProgramPreviewDialog open={false} onClose={() => {}} clinicId="c1" clinicName="S" title="K" items={[input(), input({ title: 'Clam' })]} sessionsPerDay={1} />);
    r.rerender(el);
    expect(screen.getByRole('button', { name: 'Mark Bridge as done' })).toBeInTheDocument();
  });

  it('hides a thumbnail only when its exercise has "Hide pictures in lists"; pelvic floor pictures show', async () => {
    cache.exercises = [{ id: 'src1', alsoRegions: [], hidePicturesInLists: true }];
    open([
      input({ title: 'Bridge2', sourceExerciseId: 'src1', mediaKeys: ['k1'], mediaCaptions: [''] }),
      input({ title: 'Kegel', bodyRegion: 'Pelvic floor: Women', mediaKeys: ['k2'], mediaCaptions: [''] }),
    ]);
    await waitFor(() => expect(screen.getByRole('button', { name: 'Open Kegel' }).querySelector('img')).not.toBeNull());
    expect(screen.getByRole('button', { name: 'Open Bridge2' }).querySelector('img')).toBeNull();
    const u = userEvent.setup();
    await u.click(screen.getByRole('button', { name: 'Open Bridge2' }));
    expect(screen.getByRole('img')).toHaveAttribute('src', 'https://signed/1');
  });

  it('opens on the Exercises tab; Home is built from the program here and nothing is fetched or saved', async () => {
    const u = userEvent.setup();
    open([input(), input({ title: 'Clam' })]);
    expect(screen.getByRole('tab', { name: 'Exercises' })).toHaveAttribute('aria-selected', 'true');
    await u.click(screen.getByRole('button', { name: 'Mark Bridge as done' }));
    await u.click(screen.getByRole('tab', { name: 'Home' }));
    const today = screen.getByRole('region', { name: 'Today' });
    expect(within(today).getByText('1 of 2 done')).toBeInTheDocument();
    await u.click(within(today).getByRole('button', { name: 'Continue my exercises' }));
    expect(screen.getByRole('tab', { name: 'Exercises' })).toHaveAttribute('aria-selected', 'true');
    const exSet = screen.getByRole('button', { name: 'Open Clam' });
    await u.click(exSet);
    await u.click(within(screen.getByRole('group', { name: 'Sets · tap each one when done' })).getByRole('button', { name: 'Set 1' }));
    expect(Object.values(writes.hep).concat(Object.values(writes.pub)).every((f) => f.mock.calls.length === 0)).toBe(true);
  });
});

describe('ExercisePreviewPhone', () => {
  it('shows an unsaved picture from its object URL', () => {
    render(<ExercisePreviewPhone clinicId="c1" item={input()} pictures={[{ key: null, file: null, preview: 'blob:new-1', caption: 'Start', isGif: false }]} />);
    expect(screen.getByRole('img')).toHaveAttribute('src', 'blob:new-1');
    expect(mint).not.toHaveBeenCalled();
  });

  it('shows a saved picture from its minted URL', async () => {
    render(<ExercisePreviewPhone clinicId="c1" item={input()} pictures={[{ key: 'k1', file: null, preview: null, caption: '', isGif: false }]} />);
    await waitFor(() => expect(screen.getByRole('img')).toHaveAttribute('src', 'https://signed/1'));
  });
});
