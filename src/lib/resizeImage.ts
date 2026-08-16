/**
 * Downscales an image file client-side before upload — a therapist photo
 * only ever needs to render as a small avatar, so there's no reason to
 * ship a multi-MB phone photo to storage (and back down to every device
 * that loads it) when a few hundred KB at most covers every place this
 * is shown. Never upscales: a smaller source image is returned as-is.
 */
export async function resizeImageToBlob(file: File, maxDimension: number, quality = 0.85): Promise<Blob> {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, maxDimension / Math.max(bitmap.width, bitmap.height));
  const width = Math.round(bitmap.width * scale);
  const height = Math.round(bitmap.height * scale);

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas not supported');
  ctx.drawImage(bitmap, 0, 0, width, height);
  bitmap.close();

  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error('Could not encode image'))),
      'image/jpeg',
      quality
    );
  });
}
