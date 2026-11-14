// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  applySoftFaceBlur,
  compressImageForUpload,
  createThumbnailBlob,
  HEP_GIF_TOO_LARGE_MESSAGE,
  MAX_HEP_GIF_BYTES,
  renderEditedPhoto,
} from './imageCompression';
import { NO_EDIT } from '@/domain/hepPhoto';

function fakeCtx(width: number, height: number) {
  const calls: Array<[string, ...unknown[]]> = [];
  const ctx = {
    canvas: { width, height },
    filter: 'none',
    save: () => calls.push(['save']),
    restore: () => calls.push(['restore']),
    beginPath: () => calls.push(['beginPath']),
    rect: (...a: unknown[]) => calls.push(['rect', ...a]),
    clip: () => calls.push(['clip']),
    drawImage: (...a: unknown[]) => calls.push(['drawImage', ...a]),
  };
  return { ctx: ctx as unknown as CanvasRenderingContext2D, calls, raw: ctx };
}

/** Stubs createImageBitmap and a canvas that records its size and can be told which type it can encode. */
function stubBrowser(bitmap: { width: number; height: number }, canWebp = true) {
  const closed = vi.fn();
  vi.stubGlobal('createImageBitmap', vi.fn(async () => ({ ...bitmap, close: closed })));
  const made: Array<{ width: number; height: number; drawn: unknown[][]; requestedTypes: string[] }> = [];
  vi.stubGlobal('document', {
    createElement: () => {
      const rec = { width: 0, height: 0, drawn: [] as unknown[][], requestedTypes: [] as string[] };
      made.push(rec);
      return {
        get width() { return rec.width; }, set width(v: number) { rec.width = v; },
        get height() { return rec.height; }, set height(v: number) { rec.height = v; },
        getContext: () => ({ drawImage: (...a: unknown[]) => rec.drawn.push(a), canvas: rec, filter: 'none', save() {}, restore() {}, beginPath() {}, rect() {}, clip() {}, translate() {}, rotate() {} }),
        toBlob: (cb: (b: Blob | null) => void, type: string) => {
          rec.requestedTypes.push(type);
          cb(new Blob(['x'], { type: type === 'image/webp' && !canWebp ? 'image/png' : type }));
        },
      };
    },
  });
  return { made, closed };
}

afterEach(() => vi.unstubAllGlobals());

describe('compressImageForUpload', () => {
  it('lets a GIF through untouched when it is within 1 MB (the animation survives)', async () => {
    const gif = new File([new Uint8Array(500 * 1024)], 'a.gif', { type: 'image/gif' });
    expect(await compressImageForUpload(gif)).toBe(gif);
  });

  it('rejects a GIF over 1 MB with a clear message', async () => {
    const big = new File([new Uint8Array(MAX_HEP_GIF_BYTES + 1)], 'big.gif', { type: 'image/gif' });
    await expect(compressImageForUpload(big)).rejects.toThrow(HEP_GIF_TOO_LARGE_MESSAGE);
    expect(HEP_GIF_TOO_LARGE_MESSAGE).toContain('1 MB');
  });

  it('scales a large phone photo so its longest side is 1280 px and saves it as WebP', async () => {
    const { made, closed } = stubBrowser({ width: 4000, height: 3000 });
    const out = await compressImageForUpload(new File(['x'], 'p.jpg', { type: 'image/jpeg' }));
    expect(made[0].width).toBe(1280);
    expect(made[0].height).toBe(960);
    expect(out.type).toBe('image/webp');
    expect(closed).toHaveBeenCalled();
  });

  it('never enlarges a small picture', async () => {
    const { made } = stubBrowser({ width: 800, height: 600 });
    await compressImageForUpload(new File(['x'], 'p.png', { type: 'image/png' }));
    expect([made[0].width, made[0].height]).toEqual([800, 600]);
  });

  it('falls back to JPEG when the browser cannot write WebP', async () => {
    const { made } = stubBrowser({ width: 900, height: 900 }, false);
    const out = await compressImageForUpload(new File(['x'], 'p.jpg', { type: 'image/jpeg' }));
    expect(made[0].requestedTypes).toEqual(['image/webp', 'image/jpeg']);
    expect(out.type).toBe('image/jpeg');
  });

  it('makes a 160 px thumbnail (a GIF gives its first frame)', async () => {
    const { made } = stubBrowser({ width: 640, height: 480 });
    await createThumbnailBlob(new Blob(['x'], { type: 'image/gif' }));
    expect([made[0].width, made[0].height]).toEqual([160, 120]);
  });
});

describe('applySoftFaceBlur', () => {
  it('blurs inside the box with an 8 px filter and restores the canvas state', () => {
    const { ctx, calls, raw } = fakeCtx(400, 300);
    raw.filter = 'none';
    applySoftFaceBlur(ctx, { x: 100, y: 50, width: 80, height: 90 });
    expect(calls.map((c) => c[0])).toEqual(['save', 'beginPath', 'rect', 'clip', 'drawImage', 'restore']);
    expect(calls[2]).toEqual(['rect', 100, 50, 80, 90]);
    expect(raw.filter).toBe('blur(8px)');
  });

  it('clamps a box that hangs over the canvas edges', () => {
    const { ctx, calls } = fakeCtx(400, 300);
    applySoftFaceBlur(ctx, { x: -20, y: 250, width: 100, height: 100 });
    expect(calls.find((c) => c[0] === 'rect')).toEqual(['rect', 0, 250, 80, 50]);
  });

  it('does nothing, without throwing, for an empty or fully outside box', () => {
    for (const box of [{ x: 10, y: 10, width: 0, height: 40 }, { x: 10, y: 10, width: 40, height: -5 }, { x: 500, y: 20, width: 30, height: 30 }]) {
      const { ctx, calls } = fakeCtx(400, 300);
      expect(() => applySoftFaceBlur(ctx, box)).not.toThrow();
      expect(calls).toEqual([]);
    }
  });
});

describe('renderEditedPhoto', () => {
  it('with no edits scales to 1280 and saves WebP, like a plain upload', async () => {
    const { made, closed } = stubBrowser({ width: 4000, height: 3000 });
    const out = await renderEditedPhoto(new Blob(['x']), NO_EDIT);
    expect([made[0].width, made[0].height]).toEqual([1280, 960]);
    expect(made[0].drawn[0].slice(1)).toEqual([0, 0, 4000, 3000, 0, 0, 1280, 960]);
    expect(out.type).toBe('image/webp');
    expect(closed).toHaveBeenCalled();
  });

  it('crops to the chosen shape and zoom before scaling', async () => {
    const { made } = stubBrowser({ width: 4000, height: 3000 });
    await renderEditedPhoto(new Blob(['x']), { ...NO_EDIT, shape: 'square', zoom: 2 });
    expect(made[0].drawn[0].slice(1)).toEqual([1250, 750, 1500, 1500, 0, 0, 1280, 1280]);
  });

  it('a quarter turn swaps the picture\'s sides before cropping (a 4000x3000 photo becomes 3000x4000)', async () => {
    const { made } = stubBrowser({ width: 4000, height: 3000 });
    await renderEditedPhoto(new Blob(['x']), { ...NO_EDIT, rotation: 90 });
    expect([made[0].width, made[0].height]).toEqual([3000, 4000]); // the turned copy
    expect([made[1].width, made[1].height]).toEqual([960, 1280]); // the saved picture
  });

  it('blurs each box with a filter scaled to the picture, and nothing else', async () => {
    const filters: string[] = [];
    const { made } = stubBrowser({ width: 1000, height: 1000 });
    const original = (globalThis as unknown as { document: { createElement: () => { getContext: () => { filter: string } } } }).document.createElement;
    (globalThis as unknown as { document: { createElement: () => unknown } }).document.createElement = () => {
      const el = original() as { getContext: () => { filter: string; drawImage: (...a: unknown[]) => void } };
      const real = el.getContext;
      el.getContext = () => { const c = real(); Object.defineProperty(c, 'filter', { set: (v: string) => filters.push(v), get: () => 'none' }); return c; };
      return el;
    };
    await renderEditedPhoto(new Blob(['x']), { ...NO_EDIT, blur: [{ x: 0.1, y: 0.1, w: 0.2, h: 0.2 }, { x: 0.5, y: 0.5, w: 0.3, h: 0.3 }] });
    expect(filters.filter((f) => f.startsWith('blur'))).toEqual(['blur(11px)', 'blur(11px)']);
    expect(made.length).toBeGreaterThan(0);
  });
});
