// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { PhotoEditor } from './PhotoEditor';

const renderEditedPhoto = vi.fn();
vi.mock('@/lib/imageCompression', () => ({ renderEditedPhoto: (...a: unknown[]) => renderEditedPhoto(...a), applySoftFaceBlur: vi.fn() }));

class TestPointerEvent extends MouseEvent {
  pointerId: number;
  constructor(type: string, init: PointerEventInit = {}) { super(type, init); this.pointerId = init.pointerId ?? 1; }
}

beforeEach(() => {
  renderEditedPhoto.mockReset().mockResolvedValue(new Blob(['out'], { type: 'image/webp' }));
  vi.stubGlobal('createImageBitmap', vi.fn(async () => ({ width: 4000, height: 3000, close: vi.fn() })));
  vi.stubGlobal('PointerEvent', TestPointerEvent);
  HTMLElement.prototype.getBoundingClientRect = () => ({ left: 0, top: 0, width: 480, height: 360, right: 480, bottom: 360, x: 0, y: 0, toJSON() {} });
  HTMLElement.prototype.setPointerCapture = vi.fn();
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

const source = new Blob(['photo'], { type: 'image/jpeg' });
function setup() {
  const onDone = vi.fn();
  const onCancel = vi.fn();
  render(<PhotoEditor open source={source} name="picture 1" onCancel={onCancel} onDone={onDone} />);
  return { onDone, onCancel };
}
const useButton = () => screen.getByRole('button', { name: /Use this picture|Preparing/ });
const canvas = () => screen.getByLabelText('Picture preview');
const drag = (el: HTMLElement, from: [number, number], to: [number, number]) => {
  fireEvent.pointerDown(el, { clientX: from[0], clientY: from[1], pointerId: 1 });
  fireEvent.pointerMove(el, { clientX: to[0], clientY: to[1], pointerId: 1 });
  fireEvent.pointerUp(el, { clientX: to[0], clientY: to[1], pointerId: 1 });
};

describe('PhotoEditor', () => {
  it('opens on the picture with Original shape, no zoom and the tools to hand', async () => {
    setup();
    await waitFor(() => expect(useButton()).toBeEnabled());
    expect(screen.getByRole('heading', { name: 'Adjust picture 1' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Original' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByLabelText('Zoom')).toHaveValue('1');
    expect(screen.getByRole('button', { name: 'Move' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.queryByRole('button', { name: 'Reset' })).toBeNull();
  });

  it('"Use this picture" with nothing changed hands back the original untouched and renders nothing', async () => {
    const user = userEvent.setup();
    const { onDone } = setup();
    await waitFor(() => expect(useButton()).toBeEnabled());
    await user.click(useButton());
    expect(onDone).toHaveBeenCalledWith(source, false);
    expect(renderEditedPhoto).not.toHaveBeenCalled();
  });

  it('shape, zoom and turn are sent to the renderer, and the finished picture is handed back as changed', async () => {
    const user = userEvent.setup();
    const { onDone } = setup();
    await waitFor(() => expect(useButton()).toBeEnabled());
    await user.click(screen.getByRole('button', { name: 'Square' }));
    fireEvent.change(screen.getByLabelText('Zoom'), { target: { value: '2' } });
    await user.click(screen.getByRole('button', { name: /Turn/ }));
    expect(screen.getByRole('button', { name: 'Reset' })).toBeInTheDocument();
    await user.click(useButton());
    await waitFor(() => expect(onDone).toHaveBeenCalled());
    expect(renderEditedPhoto).toHaveBeenCalledWith(source, expect.objectContaining({ shape: 'square', zoom: 2, rotation: 90, blur: [] }));
    expect(onDone).toHaveBeenCalledWith(expect.any(Blob), true);
  });

  it('dragging in Move mode moves the picture only when it is zoomed in', async () => {
    const user = userEvent.setup();
    setup();
    await waitFor(() => expect(useButton()).toBeEnabled());
    expect(screen.getByText('Zoom in, then drag the picture to frame it.')).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Zoom'), { target: { value: '2' } });
    expect(screen.getByText('Drag the picture to move it.')).toBeInTheDocument();
    drag(canvas(), [240, 180], [300, 180]);
    await user.click(useButton());
    await waitFor(() => expect(renderEditedPhoto).toHaveBeenCalled());
    const edit = renderEditedPhoto.mock.calls[0][1] as { cx: number };
    expect(edit.cx).toBeLessThan(0.5); // dragged right, so the crop moved left
  });

  it('Blur a face: dragging over the picture adds a blurred area that is saved, and can be undone', async () => {
    const user = userEvent.setup();
    setup();
    await waitFor(() => expect(useButton()).toBeEnabled());
    await user.click(screen.getByRole('button', { name: 'Blur a face' }));
    expect(screen.getByText('Drag over a face to blur it.')).toBeInTheDocument();
    drag(canvas(), [96, 72], [192, 144]);
    expect(screen.getByText(/1 area blurred/)).toBeInTheDocument();
    drag(canvas(), [300, 200], [360, 260]);
    expect(screen.getByText(/2 areas blurred/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Undo last blur' }));
    expect(screen.getByText(/1 area blurred/)).toBeInTheDocument();
    await user.click(useButton());
    await waitFor(() => expect(renderEditedPhoto).toHaveBeenCalled());
    const edit = renderEditedPhoto.mock.calls[0][1] as { blur: Array<{ x: number; y: number; w: number; h: number }> };
    expect(edit.blur).toHaveLength(1);
    expect(edit.blur[0].x).toBeCloseTo(0.2); expect(edit.blur[0].y).toBeCloseTo(0.2);
    expect(edit.blur[0].w).toBeCloseTo(0.2); expect(edit.blur[0].h).toBeCloseTo(0.2);
  });

  it('a tiny accidental drag in Blur mode adds nothing', async () => {
    const user = userEvent.setup();
    setup();
    await waitFor(() => expect(useButton()).toBeEnabled());
    await user.click(screen.getByRole('button', { name: 'Blur a face' }));
    drag(canvas(), [100, 100], [103, 102]);
    expect(screen.queryByText(/blurred/)).toBeNull();
  });

  it('Reset puts everything back', async () => {
    const user = userEvent.setup();
    setup();
    await waitFor(() => expect(useButton()).toBeEnabled());
    await user.click(screen.getByRole('button', { name: 'Wide 4:3' }));
    await user.click(screen.getByRole('button', { name: 'Reset' }));
    expect(screen.getByRole('button', { name: 'Original' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.queryByRole('button', { name: 'Reset' })).toBeNull();
  });

  it('Cancel closes without saving anything', async () => {
    const user = userEvent.setup();
    const { onCancel, onDone } = setup();
    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(onCancel).toHaveBeenCalled();
    expect(onDone).not.toHaveBeenCalled();
  });

  it('says so when the picture cannot be opened, and when it cannot be prepared', async () => {
    const user = userEvent.setup();
    vi.stubGlobal('createImageBitmap', vi.fn(async () => { throw new Error('bad'); }));
    const { unmount } = render(<PhotoEditor open source={source} onCancel={vi.fn()} onDone={vi.fn()} />);
    expect(await screen.findByRole('alert')).toHaveTextContent('could not be opened');
    unmount();
    vi.stubGlobal('createImageBitmap', vi.fn(async () => ({ width: 100, height: 100, close: vi.fn() })));
    renderEditedPhoto.mockRejectedValue(new Error('canvas'));
    render(<PhotoEditor open source={source} onCancel={vi.fn()} onDone={vi.fn()} />);
    await waitFor(() => expect(useButton()).toBeEnabled());
    await user.click(screen.getByRole('button', { name: 'Original' })); // no edit yet
    await user.click(screen.getByRole('button', { name: /Turn/ }));
    await user.click(useButton());
    expect(await screen.findByRole('alert')).toHaveTextContent('Could not prepare the picture');
  });
});
