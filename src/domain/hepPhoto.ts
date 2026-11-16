// Rules for the pictures staff add to an exercise: which files are accepted, how big, and the crop maths behind the
// photo editor. Pure functions, so the editor on screen and the image that is saved use exactly the same numbers.

/** Photos: shrunk in the browser before upload (longest side 1280 px), so the original may be large. */
export const MAX_HEP_PHOTO_BYTES = 25 * 1024 * 1024;
export const MAX_HEP_GIF_BYTES = 1024 * 1024;
export const HEP_PHOTO_MIME = ['image/jpeg', 'image/png', 'image/webp'] as const;
/** What the file pickers offer. Listing the types (not image/*) makes iPhones hand over a JPEG instead of a HEIC. */
export const HEP_ACCEPT = 'image/jpeg,image/png,image/webp,image/gif';
export const HEP_UPLOAD_RULES = 'Photos: JPG, PNG or WebP, up to 25 MB each (we shrink them for you). GIF: up to 1 MB. 1 to 4 photos, or one GIF.';

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(bytes < 10 * 1024 * 1024 ? 1 : 0)} MB`;
}

/** null when the file can be used; otherwise the sentence to show. */
export function validatePictureFile(file: Pick<File, 'name' | 'type' | 'size'>): string | null {
  const isGif = file.type === 'image/gif';
  if (!isGif && !(HEP_PHOTO_MIME as readonly string[]).includes(file.type)) {
    const ext = file.name.split('.').pop()?.toLowerCase();
    if (ext === 'heic' || ext === 'heif' || file.type === 'image/heic' || file.type === 'image/heif') {
      return `${file.name} is a HEIC photo, which browsers cannot open. On an iPhone, choose it from Photos here (it is converted for you), or share it as JPG.`;
    }
    return `${file.name} is not a supported picture. Use JPG, PNG or WebP photos, or a GIF.`;
  }
  if (file.size === 0) return `${file.name} is empty.`;
  if (isGif && file.size > MAX_HEP_GIF_BYTES) return `${file.name} is ${formatBytes(file.size)}. A GIF can be at most 1 MB: make it shorter or smaller, or use photos.`;
  if (!isGif && file.size > MAX_HEP_PHOTO_BYTES) return `${file.name} is ${formatBytes(file.size)}. Photos can be at most 25 MB.`;
  return null;
}

// ---- Crop maths ---------------------------------------------------------------

export type PhotoShape = 'original' | 'square' | 'wide' | 'tall';
export const PHOTO_SHAPES: Array<{ key: PhotoShape; label: string }> = [
  { key: 'original', label: 'Original' },
  { key: 'square', label: 'Square' },
  { key: 'wide', label: 'Wide 4:3' },
  { key: 'tall', label: 'Tall 3:4' },
];
export const MIN_ZOOM = 1;
export const MAX_ZOOM = 4;

/** A box in 0..1 of the WHOLE (turned) picture, so it stays on the face when the picture is moved or zoomed. x and y are the top left corner. */
export interface NormBox { x: number; y: number; w: number; h: number }

export interface PhotoEdit {
  shape: PhotoShape;
  /** 1 = the whole shape fits the picture; up to 4 = a quarter of it. */
  zoom: number;
  /** The centre of the crop, 0..1 across the (rotated) picture. */
  cx: number;
  cy: number;
  rotation: 0 | 90 | 180 | 270;
  blur: NormBox[];
  /** How strong the blur is, 1 (light, partly see-through) to 5 (strong, fully hidden). */
  blurStrength: number;
}

export const BLUR_STRENGTH_MIN = 1;
export const BLUR_STRENGTH_MAX = 5;
/** Light by default: enough to make a face unrecognisable in a small exercise picture without a heavy grey patch. */
export const DEFAULT_BLUR_STRENGTH = 2;
export const BLUR_STRENGTH_LABELS = ['Very light', 'Light', 'Medium', 'Strong', 'Very strong'] as const;

/**
 * The blur radius (in pixels) and how opaque the blurred patch is, for a strength and a picture's longest side.
 * Both the preview and the saved picture use this, so what is shown is what is saved at any size.
 */
export function blurLook(strength: number, longSide: number): { radius: number; opacity: number } {
  const s = Math.min(BLUR_STRENGTH_MAX, Math.max(BLUR_STRENGTH_MIN, Math.round(strength)));
  const fraction = [0.004, 0.007, 0.011, 0.016, 0.024][s - 1];
  const opacity = [0.6, 0.75, 0.9, 1, 1][s - 1];
  return { radius: Math.max(1, Math.round(longSide * fraction)), opacity };
}

export const NO_EDIT: PhotoEdit = { shape: 'original', zoom: 1, cx: 0.5, cy: 0.5, rotation: 0, blur: [], blurStrength: DEFAULT_BLUR_STRENGTH };

export function rotatedSize(w: number, h: number, rotation: PhotoEdit['rotation']): { w: number; h: number } {
  return rotation === 90 || rotation === 270 ? { w: h, h: w } : { w, h };
}

const aspectOf = (shape: PhotoShape, srcW: number, srcH: number) => (shape === 'square' ? 1 : shape === 'wide' ? 4 / 3 : shape === 'tall' ? 3 / 4 : srcW / srcH);

/** The part of the (already rotated) picture that is kept, in its pixels. Always inside the picture. */
export function cropRect(srcW: number, srcH: number, edit: Pick<PhotoEdit, 'shape' | 'zoom' | 'cx' | 'cy'>): { sx: number; sy: number; sw: number; sh: number } {
  const aspect = aspectOf(edit.shape, srcW, srcH);
  let w = srcW / srcH > aspect ? srcH * aspect : srcW;
  let h = srcW / srcH > aspect ? srcH : srcW / aspect;
  const zoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, edit.zoom));
  w /= zoom;
  h /= zoom;
  const sx = Math.min(srcW - w, Math.max(0, edit.cx * srcW - w / 2));
  const sy = Math.min(srcH - h, Math.max(0, edit.cy * srcH - h / 2));
  return { sx, sy, sw: w, sh: h };
}

/** The saved picture's size: the crop scaled so its longest side is at most `maxDim` (never enlarged). */
export function outputSize(sw: number, sh: number, maxDim: number): { width: number; height: number } {
  const scale = Math.min(1, maxDim / Math.max(sw, sh));
  return { width: Math.max(1, Math.round(sw * scale)), height: Math.max(1, Math.round(sh * scale)) };
}

/** Dragging the picture by `dx`, `dy` display pixels moves the crop the other way. Returns the new centre, kept legal. */
export function panCentre(edit: Pick<PhotoEdit, 'shape' | 'zoom' | 'cx' | 'cy'>, srcW: number, srcH: number, displayW: number, dx: number, dy: number): { cx: number; cy: number } {
  const { sw, sh } = cropRect(srcW, srcH, edit);
  const perPx = sw / displayW; // source pixels per display pixel
  const next = { ...edit, cx: edit.cx - (dx * perPx) / srcW, cy: edit.cy - (dy * perPx) / srcH };
  const { sx, sy } = cropRect(srcW, srcH, next);
  return { cx: (sx + sw / 2) / srcW, cy: (sy + sh / 2) / srcH };
}

/** A quarter turn clockwise: the picture's boxes and centre turn with it. */
export function rotateBox90(b: NormBox): NormBox {
  return { x: 1 - b.y - b.h, y: b.x, w: b.h, h: b.w };
}
export function rotateCentre90(cx: number, cy: number): { cx: number; cy: number } {
  return { cx: 1 - cy, cy: cx };
}

/** Turns the picture a quarter clockwise, with its centre and blur boxes. */
export function rotateEdit(e: PhotoEdit): PhotoEdit {
  const c = rotateCentre90(e.cx, e.cy);
  return { ...e, rotation: (((e.rotation + 90) % 360) as PhotoEdit['rotation']), cx: c.cx, cy: c.cy, blur: e.blur.map(rotateBox90) };
}

/** A whole-picture box as a fraction of the crop that is kept (it may hang outside 0..1 when the crop cuts through it). */
export function boxInCrop(b: NormBox, picW: number, picH: number, crop: { sx: number; sy: number; sw: number; sh: number }): NormBox {
  return { x: (b.x * picW - crop.sx) / crop.sw, y: (b.y * picH - crop.sy) / crop.sh, w: (b.w * picW) / crop.sw, h: (b.h * picH) / crop.sh };
}

/** A crop-relative point (0..1 of what is shown) as a point on the whole picture. */
export function pointOnPicture(px: number, py: number, picW: number, picH: number, crop: { sx: number; sy: number; sw: number; sh: number }): { x: number; y: number } {
  return { x: (crop.sx + px * crop.sw) / picW, y: (crop.sy + py * crop.sh) / picH };
}

export function normBoxToPixels(b: NormBox, width: number, height: number): { x: number; y: number; width: number; height: number } {
  return { x: b.x * width, y: b.y * height, width: b.w * width, height: b.h * height };
}

/** A box drawn by dragging from one point to another (any direction), kept inside 0..1 and ignored when tiny. */
export function boxFromDrag(x0: number, y0: number, x1: number, y1: number): NormBox | null {
  const clamp = (n: number) => Math.min(1, Math.max(0, n));
  const x = clamp(Math.min(x0, x1));
  const y = clamp(Math.min(y0, y1));
  const w = clamp(Math.max(x0, x1)) - x;
  const h = clamp(Math.max(y0, y1)) - y;
  return w < 0.03 || h < 0.03 ? null : { x, y, w, h };
}

export const isEdited = (e: PhotoEdit) => e.shape !== 'original' || e.zoom !== 1 || e.rotation !== 0 || e.blur.length > 0;
