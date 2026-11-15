// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { HepItemInput } from '@/services/hepService';
import { ExercisePreviewPhone, ProgramPreviewDialog } from './PatientPreview';

const mint = vi.hoisted(() => vi.fn());
vi.mock('@/services/hepMediaService', () => ({ hepMediaService: { mintViewUrls: mint } }));

const input = (over: Partial<HepItemInput> = {}): HepItemInput => ({
  title: 'Bridge', bodyRegion: 'Hip', phase: 'strengthening', instructions: 'Lift your hips.', mediaType: 'none', mediaKeys: [], mediaCaptions: [], equipment: [],
  doseType: 'reps', sets: 3, reps: 10, holdSeconds: null, durationSeconds: null, restSeconds: 0, sessionsPerDay: 1, side: 'none', optional: false, stopIf: '', ...over,
});

beforeEach(() => { mint.mockReset(); mint.mockResolvedValue({ k1: 'https://signed/1', k2: 'https://signed/2' }); });
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
    expect(mint).not.toHaveBeenCalledWith(expect.anything(), expect.anything(), expect.anything());
  });

  it('shows no thumbnail for a pelvic floor exercise in the list', async () => {
    open([input({ title: 'Kegel', bodyRegion: 'Pelvic floor: Women', mediaKeys: ['k1'], mediaCaptions: [''] }), input({ title: 'Clam', mediaKeys: ['k2'], mediaCaptions: [''] })]);
    await waitFor(() => expect(screen.getByRole('button', { name: 'Open Clam' }).querySelector('img')).not.toBeNull());
    expect(screen.getByRole('button', { name: 'Open Kegel' }).querySelector('img')).toBeNull();
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
