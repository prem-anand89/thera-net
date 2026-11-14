import { describe, expect, it } from 'vitest';
import { DEFAULT_BLUR_STRENGTH, MAX_HEP_PHOTO_BYTES, NO_EDIT, blurLook, boxFromDrag, boxInCrop, pointOnPicture, rotateBox90, rotateEdit, cropRect, formatBytes, isEdited, normBoxToPixels, outputSize, panCentre, rotatedSize, validatePictureFile } from './hepPhoto';

const file = (name: string, type: string, size: number) => ({ name, type, size });

describe('validatePictureFile', () => {
  it('accepts JPG, PNG and WebP photos and a small GIF', () => {
    for (const t of ['image/jpeg', 'image/png', 'image/webp']) expect(validatePictureFile(file('a', t, 2_000_000))).toBeNull();
    expect(validatePictureFile(file('move.gif', 'image/gif', 900_000))).toBeNull();
  });
  it('refuses other types with the types that work, and explains HEIC', () => {
    expect(validatePictureFile(file('doc.pdf', 'application/pdf', 100))).toMatch(/not a supported picture.*JPG, PNG or WebP.*GIF/);
    expect(validatePictureFile(file('IMG_1.HEIC', '', 100))).toMatch(/HEIC.*JPG/);
    expect(validatePictureFile(file('IMG_1.heic', 'image/heic', 100))).toMatch(/HEIC/);
  });
  it('refuses a photo over 25 MB and a GIF over 1 MB, with the size it was', () => {
    expect(validatePictureFile(file('big.jpg', 'image/jpeg', MAX_HEP_PHOTO_BYTES + 1))).toMatch(/at most 25 MB/);
    expect(validatePictureFile(file('big.gif', 'image/gif', 1024 * 1024 + 1))).toMatch(/1\.0 MB.*at most 1 MB/);
    expect(validatePictureFile(file('ok.jpg', 'image/jpeg', MAX_HEP_PHOTO_BYTES))).toBeNull();
  });
  it('refuses an empty file', () => {
    expect(validatePictureFile(file('e.jpg', 'image/jpeg', 0))).toMatch(/empty/);
  });
  it('words sizes plainly', () => {
    expect(formatBytes(500)).toBe('500 B');
    expect(formatBytes(150 * 1024)).toBe('150 KB');
    expect(formatBytes(2.5 * 1024 * 1024)).toBe('2.5 MB');
    expect(formatBytes(12 * 1024 * 1024)).toBe('12 MB');
  });
});

describe('cropRect', () => {
  it('Original at zoom 1 keeps the whole picture', () => {
    expect(cropRect(4000, 3000, NO_EDIT)).toEqual({ sx: 0, sy: 0, sw: 4000, sh: 3000 });
  });
  it('Square keeps the largest square, centred, and moves with the centre', () => {
    expect(cropRect(4000, 3000, { ...NO_EDIT, shape: 'square' })).toEqual({ sx: 500, sy: 0, sw: 3000, sh: 3000 });
    expect(cropRect(4000, 3000, { ...NO_EDIT, shape: 'square', cx: 0 })).toMatchObject({ sx: 0, sw: 3000 });
    expect(cropRect(4000, 3000, { ...NO_EDIT, shape: 'square', cx: 1 })).toMatchObject({ sx: 1000, sw: 3000 });
  });
  it('Wide 4:3 and Tall 3:4 give those proportions', () => {
    const wide = cropRect(3000, 4000, { ...NO_EDIT, shape: 'wide' });
    expect(wide.sw / wide.sh).toBeCloseTo(4 / 3);
    const tall = cropRect(4000, 3000, { ...NO_EDIT, shape: 'tall' });
    expect(tall.sw / tall.sh).toBeCloseTo(3 / 4);
  });
  it('zoom shrinks the crop around the centre and never leaves the picture', () => {
    const r = cropRect(4000, 3000, { ...NO_EDIT, zoom: 2 });
    expect(r).toEqual({ sx: 1000, sy: 750, sw: 2000, sh: 1500 });
    const corner = cropRect(4000, 3000, { ...NO_EDIT, zoom: 4, cx: 0, cy: 1 });
    expect(corner.sx).toBe(0);
    expect(corner.sy + corner.sh).toBeCloseTo(3000);
    expect(cropRect(4000, 3000, { ...NO_EDIT, zoom: 99 }).sw).toBe(1000); // capped at 4x
  });
});

describe('panCentre', () => {
  it('dragging right moves the crop left, by the same distance on screen, and stops at the edge', () => {
    const edit = { ...NO_EDIT, zoom: 2 };
    const moved = panCentre(edit, 4000, 3000, 500, 100, 0); // crop is 2000 px wide shown in 500 px: 4 source px per screen px
    expect(moved.cx).toBeCloseTo(0.5 - 400 / 4000);
    expect(panCentre(edit, 4000, 3000, 500, 100000, 0).cx).toBeCloseTo(0.25); // cannot go past the left edge
  });
  it('does nothing when the whole picture is showing', () => {
    expect(panCentre(NO_EDIT, 4000, 3000, 500, 80, 40)).toEqual({ cx: 0.5, cy: 0.5 });
  });
});

describe('output and boxes', () => {
  it('scales the crop to at most 1280 on the longest side and never enlarges', () => {
    expect(outputSize(4000, 3000, 1280)).toEqual({ width: 1280, height: 960 });
    expect(outputSize(600, 400, 1280)).toEqual({ width: 600, height: 400 });
  });
  it('swaps width and height for a quarter turn', () => {
    expect(rotatedSize(4000, 3000, 90)).toEqual({ w: 3000, h: 4000 });
    expect(rotatedSize(4000, 3000, 180)).toEqual({ w: 4000, h: 3000 });
  });
  it('draws a blur box in any drag direction, keeps it inside the picture, and ignores a tiny one', () => {
    expect(boxFromDrag(0.6, 0.5, 0.2, 0.1)).toEqual({ x: 0.2, y: 0.1, w: expect.closeTo(0.4), h: expect.closeTo(0.4) });
    expect(boxFromDrag(0.9, 0.9, 1.4, 1.4)).toMatchObject({ x: 0.9, y: 0.9 });
    expect(boxFromDrag(0.5, 0.5, 0.51, 0.52)).toBeNull();
    expect(normBoxToPixels({ x: 0.5, y: 0.25, w: 0.2, h: 0.5 }, 1000, 800)).toEqual({ x: 500, y: 200, width: 200, height: 400 });
  });
  it('knows when anything was changed', () => {
    expect(isEdited(NO_EDIT)).toBe(false);
    expect(isEdited({ ...NO_EDIT, rotation: 90 })).toBe(true);
    expect(isEdited({ ...NO_EDIT, blur: [{ x: 0, y: 0, w: 0.1, h: 0.1 }] })).toBe(true);
  });
});

describe('blur boxes follow the picture', () => {
  it('a quarter turn moves a box with the picture (top left of a landscape photo goes to the top right)', () => {
    expect(rotateBox90({ x: 0, y: 0, w: 0.2, h: 0.1 })).toEqual({ x: 0.9, y: 0, w: 0.1, h: 0.2 });
    let b = { x: 0.1, y: 0.3, w: 0.2, h: 0.1 };
    for (let i = 0; i < 4; i++) b = rotateBox90(b);
    expect(b.x).toBeCloseTo(0.1); expect(b.y).toBeCloseTo(0.3); expect(b.w).toBeCloseTo(0.2); expect(b.h).toBeCloseTo(0.1);
  });
  it('rotating the edit turns the angle, the centre and every box together', () => {
    const e = rotateEdit({ ...NO_EDIT, cx: 0.25, cy: 0.5, blur: [{ x: 0, y: 0, w: 0.2, h: 0.1 }] });
    expect(e.rotation).toBe(90);
    expect(e.cx).toBeCloseTo(0.5); expect(e.cy).toBeCloseTo(0.25);
    expect(e.blur[0].x).toBeCloseTo(0.9);
    expect(rotateEdit(rotateEdit(rotateEdit(e))).rotation).toBe(0);
  });
  it('a box stays on the same spot of the picture when the crop moves or zooms', () => {
    const crop = cropRect(4000, 3000, { ...NO_EDIT, zoom: 2 }); // keeps x 1000..3000, y 750..2250
    const inCrop = boxInCrop({ x: 0.5, y: 0.5, w: 0.1, h: 0.1 }, 4000, 3000, crop);
    expect(inCrop.x).toBeCloseTo(0.5); expect(inCrop.w).toBeCloseTo(0.2);
    const back = pointOnPicture(inCrop.x, inCrop.y, 4000, 3000, crop);
    expect(back.x).toBeCloseTo(0.5); expect(back.y).toBeCloseTo(0.5);
    expect(boxInCrop({ x: 0, y: 0, w: 0.1, h: 0.1 }, 4000, 3000, crop).x).toBeLessThan(0); // cut off by the crop
  });
});

describe('blur strength', () => {
  it('is light and partly see-through by default, and scales with the picture so preview and saved match', () => {
    expect(NO_EDIT.blurStrength).toBe(DEFAULT_BLUR_STRENGTH);
    const preview = blurLook(DEFAULT_BLUR_STRENGTH, 480);
    const saved = blurLook(DEFAULT_BLUR_STRENGTH, 1280);
    expect(preview.opacity).toBeLessThan(1);
    expect(preview.radius / 480).toBeCloseTo(saved.radius / 1280, 2);
  });

  it('gets stronger and fully opaque at the top of the scale, and clamps out-of-range values', () => {
    expect(blurLook(5, 1000).radius).toBeGreaterThan(blurLook(1, 1000).radius * 4);
    expect(blurLook(5, 1000).opacity).toBe(1);
    expect(blurLook(9, 1000)).toEqual(blurLook(5, 1000));
    expect(blurLook(0, 1000)).toEqual(blurLook(1, 1000));
  });
});
