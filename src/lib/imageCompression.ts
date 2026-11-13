// Browser-side picture preparation for HEP exercises: shrink phone photos before upload, keep GIFs untouched (they are
// made outside the app), make a small thumbnail for lists, and optionally blur a face. Uses the same
// createImageBitmap + <canvas> approach as resizeImage.ts. No secrets here; uploads go through hep-media's signed URLs.

/** A GIF is made outside the app and only passes through: at most 1 MB (amendment 76). */
export const MAX_HEP_GIF_BYTES = 1024 * 1024;
export const HEP_GIF_TOO_LARGE_MESSAGE = 'That GIF is over 1 MB. Make it shorter or smaller, or use photos.';
export const HEP_MAX_DIMENSION = 1280;
export const HEP_THUMB_SIZE = 160;

/** A region in pixels of the image as it will be saved (after scaling). */
export interface BlurBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * Blurs a rectangle of the canvas in place, kept inside the canvas. A zero-area or fully outside box does nothing.
 * The default 8 px keeps a face unrecognisable without a blocky look.
 */
export function applySoftFaceBlur(ctx: CanvasRenderingContext2D, box: BlurBox, blurPx = 8): void {
  const canvasW = ctx.canvas.width;
  const canvasH = ctx.canvas.height;
  const x = Math.max(0, Math.min(canvasW, box.x));
  const y = Math.max(0, Math.min(canvasH, box.y));
  const right = Math.max(0, Math.min(canvasW, box.x + box.width));
  const bottom = Math.max(0, Math.min(canvasH, box.y + box.height));
  const width = right - x;
  const height = bottom - y;
  if (!(width > 0) || !(height > 0)) return;
  ctx.save();
  ctx.beginPath();
  ctx.rect(x, y, width, height);
  ctx.clip();
  ctx.filter = `blur(${Math.max(1, blurPx)}px)`;
  ctx.drawImage(ctx.canvas, 0, 0);
  ctx.restore();
}

function encode(canvas: HTMLCanvasElement, type: string, quality: number): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('Could not encode image'))), type, quality);
  });
}

/** WebP where the browser can write it; otherwise JPEG (an older browser silently returns a large PNG instead). */
async function encodeSmall(canvas: HTMLCanvasElement, quality: number): Promise<Blob> {
  const webp = await encode(canvas, 'image/webp', quality);
  return webp.type === 'image/webp' ? webp : encode(canvas, 'image/jpeg', quality);
}

/**
 * Prepares one exercise picture for upload. A GIF is returned as it is (so the animation survives) when it is within
 * 1 MB, and rejected with a clear message above that. A still is scaled so its longest side is at most `maxDimension`
 * (never enlarged), optionally blurred over `blurBox`, and saved as WebP.
 */
export async function compressImageForUpload(
  file: File,
  maxDimension = HEP_MAX_DIMENSION,
  quality = 0.82,
  options?: { blurBox?: BlurBox },
): Promise<Blob> {
  if (file.type === 'image/gif') {
    if (file.size > MAX_HEP_GIF_BYTES) throw new Error(HEP_GIF_TOO_LARGE_MESSAGE);
    return file;
  }
  const bitmap = await createImageBitmap(file);
  try {
    const scale = Math.min(1, maxDimension / Math.max(bitmap.width, bitmap.height));
    const width = Math.max(1, Math.round(bitmap.width * scale));
    const height = Math.max(1, Math.round(bitmap.height * scale));
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Canvas not supported');
    ctx.drawImage(bitmap, 0, 0, width, height);
    if (options?.blurBox) applySoftFaceBlur(ctx, options.blurBox, 8);
    return await encodeSmall(canvas, quality);
  } finally {
    bitmap.close();
  }
}

/** The small square-ish picture used in lists: the longest side is `size` px (a GIF gives its first frame). */
export async function createThumbnailBlob(source: Blob, size = HEP_THUMB_SIZE, quality = 0.7): Promise<Blob> {
  const bitmap = await createImageBitmap(source);
  try {
    const scale = Math.min(1, size / Math.max(bitmap.width, bitmap.height));
    const width = Math.max(1, Math.round(bitmap.width * scale));
    const height = Math.max(1, Math.round(bitmap.height * scale));
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Canvas not supported');
    ctx.drawImage(bitmap, 0, 0, width, height);
    return await encodeSmall(canvas, quality);
  } finally {
    bitmap.close();
  }
}
