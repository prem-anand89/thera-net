// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { useState } from 'react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { PictureField, type Picture } from './PictureField';

vi.mock('./PhotoEditor', () => ({
  PhotoEditor: ({ open, source, onDone, onCancel }: { open: boolean; source: Blob | null; onDone: (b: Blob, changed: boolean) => void; onCancel: () => void }) =>
    open ? (
      <div role="dialog" aria-label="editor">
        <span>editing {source?.size} bytes</span>
        <button type="button" onClick={() => onDone(new Blob(['adjusted'], { type: 'image/webp' }), true)}>finish adjusted</button>
        <button type="button" onClick={() => onDone(new Blob(['same']), false)}>finish unchanged</button>
        <button type="button" onClick={onCancel}>cancel edit</button>
      </div>
    ) : null,
}));

const problem = vi.fn();
let latest: Picture[] = [];
function Harness({ initial = [], disabled = false }: { initial?: Picture[]; disabled?: boolean }) {
  const [pics, setPics] = useState<Picture[]>(initial);
  latest = pics;
  return <PictureField pictures={pics} setPictures={setPics} onProblem={problem} disabled={disabled} />;
}
const jpg = (name: string, size = 3000) => new File([new Uint8Array(size)], name, { type: 'image/jpeg' });
const chooser = () => screen.getByLabelText('Choose photos or a GIF', { selector: 'input' });
const saved = (key: string, caption = ''): Picture => ({ key, file: null, preview: `https://img.test/${key}`, caption, isGif: false });

beforeEach(() => { problem.mockReset(); URL.createObjectURL = vi.fn(() => 'blob:preview'); URL.revokeObjectURL = vi.fn(); });
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe('PictureField', () => {
  it('says up front which types and sizes work', () => {
    render(<Harness />);
    expect(screen.getByText(/JPG, PNG or WebP, up to 25 MB each.*GIF: up to 1 MB.*2 to 4 photos, or one GIF/)).toBeInTheDocument();
    expect(chooser()).toHaveAttribute('accept', 'image/jpeg,image/png,image/webp,image/gif');
  });

  it('adds chosen photos with their size, and asks for at least 2', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.upload(chooser(), jpg('start.jpg', 2 * 1024 * 1024));
    expect(latest).toHaveLength(1);
    expect(screen.getByText('New photo · 2.0 MB')).toBeInTheDocument();
    expect(screen.getByText(/Add at least 2 photos/)).toBeInTheDocument();
    await user.upload(chooser(), jpg('end.jpg'));
    expect(screen.queryByText(/Add at least 2 photos/)).toBeNull();
  });

  it('turns away a file of the wrong type or size with a plain reason, and still adds the good ones', () => {
    render(<Harness />);
    const pdf = new File(['x'], 'plan.pdf', { type: 'application/pdf' });
    const huge = new File([new Uint8Array(1)], 'huge.jpg', { type: 'image/jpeg' });
    Object.defineProperty(huge, 'size', { value: 30 * 1024 * 1024 });
    // The file dialog can be switched to "All files", so the types and sizes are checked here, not only by `accept`.
    fireEvent.change(chooser(), { target: { files: [pdf, huge, jpg('ok.jpg')] } });
    expect(latest.map((p) => p.file?.name)).toEqual(['ok.jpg']);
    const message = problem.mock.calls.at(-1)?.[0] as string;
    expect(message).toMatch(/plan\.pdf is not a supported picture/);
    expect(message).toMatch(/huge\.jpg is 30 MB. Photos can be at most 25 MB/);
  });

  it('explains a HEIC photo instead of failing silently', async () => {
    render(<Harness />);
    const heic = new File(['x'], 'IMG_0001.HEIC', { type: '' });
    fireEvent.change(chooser(), { target: { files: [heic] } });
    expect(problem.mock.calls.at(-1)?.[0]).toMatch(/HEIC.*JPG/);
    expect(latest).toHaveLength(0);
  });

  it('a dropped file is added like a chosen one', () => {
    const { container } = render(<Harness />);
    const zone = container.querySelector('.border-dashed') as HTMLElement;
    fireEvent.drop(zone, { dataTransfer: { files: [jpg('dropped.jpg')] } });
    expect(latest.map((p) => p.file?.name)).toEqual(['dropped.jpg']);
  });

  it('a GIF stands alone, has no Adjust button, and cannot be mixed with photos', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.upload(chooser(), new File([new Uint8Array(500)], 'move.gif', { type: 'image/gif' }));
    expect(screen.queryByRole('button', { name: 'Adjust or blur' })).toBeNull();
    await user.upload(chooser(), jpg('still.jpg'));
    expect(problem.mock.calls.at(-1)?.[0]).toMatch(/already has a GIF/);
    expect(latest).toHaveLength(1);
  });

  it('allows up to 4 photos', async () => {
    const user = userEvent.setup();
    render(<Harness initial={[saved('a'), saved('b'), saved('c'), saved('d')]} />);
    await user.upload(chooser(), jpg('five.jpg'));
    expect(problem.mock.calls.at(-1)?.[0]).toBe('Up to 4 photos for one exercise.');
    expect(latest).toHaveLength(4);
  });

  it('reorders with the arrows (the first and last have only one way to go) and removes', async () => {
    const user = userEvent.setup();
    render(<Harness initial={[saved('a', 'Start'), saved('b', 'End')]} />);
    expect(screen.getByRole('button', { name: 'Move picture 1 earlier' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Move picture 2 later' })).toBeDisabled();
    await user.click(screen.getByRole('button', { name: 'Move picture 1 later' }));
    expect(latest.map((p) => p.key)).toEqual(['b', 'a']);
    await user.click(screen.getByRole('button', { name: 'Remove picture 1' }));
    expect(latest.map((p) => p.key)).toEqual(['a']);
  });

  it('Adjust opens the editor on the new photo; an adjusted result replaces it as a new, ready-to-upload picture', async () => {
    const user = userEvent.setup();
    render(<Harness initial={[{ key: null, file: jpg('start.jpg', 1234), preview: 'blob:x', caption: 'Start', isGif: false }]} />);
    await user.click(screen.getByRole('button', { name: 'Adjust or blur' }));
    expect(screen.getByText('editing 1234 bytes')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'finish adjusted' }));
    expect(latest[0]).toMatchObject({ key: null, ready: true, caption: 'Start' });
    expect(latest[0].file?.name).toBe('start.webp');
    expect(latest[0].file?.type).toBe('image/webp');
    expect(screen.getByText(/^Adjusted/)).toBeInTheDocument();
  });

  it('leaves the picture alone when the editor reports no change, or is cancelled', async () => {
    const user = userEvent.setup();
    render(<Harness initial={[{ key: null, file: jpg('start.jpg'), preview: 'blob:x', caption: '', isGif: false }]} />);
    await user.click(screen.getByRole('button', { name: 'Adjust or blur' }));
    await user.click(screen.getByRole('button', { name: 'finish unchanged' }));
    expect(latest[0].ready).toBeUndefined();
    await user.click(screen.getByRole('button', { name: 'Adjust or blur' }));
    await user.click(screen.getByRole('button', { name: 'cancel edit' }));
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('a saved picture is fetched through its viewing link to be adjusted; if that fails it says so', async () => {
    const user = userEvent.setup();
    vi.stubGlobal('fetch', vi.fn(async () => ({ blob: async () => new Blob([new Uint8Array(77)]) })));
    const { unmount } = render(<Harness initial={[saved('k1')]} />);
    await user.click(screen.getByRole('button', { name: 'Adjust or blur' }));
    expect(await screen.findByText('editing 77 bytes')).toBeInTheDocument();
    unmount();
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('network'); }));
    render(<Harness initial={[saved('k2')]} />);
    await user.click(screen.getByRole('button', { name: 'Adjust or blur' }));
    await vi.waitFor(() => expect(problem.mock.calls.at(-1)?.[0]).toMatch(/could not be opened for adjusting/));
  });

  it('everything is switched off while saving', () => {
    render(<Harness disabled initial={[saved('a'), saved('b')]} />);
    expect(chooser()).toBeDisabled();
    expect(screen.getAllByRole('button', { name: 'Adjust or blur' })[0]).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Remove picture 1' })).toBeDisabled();
  });
});
