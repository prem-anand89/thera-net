// Adjust one exercise photo before it is saved: choose a shape (Original, Square, Wide, Tall), zoom, drag the picture to
// frame it, turn it, and blur faces. The preview and the saved picture use the same maths (domain/hepPhoto), so what is
// shown is what is saved. A GIF is never edited (it would lose its movement).
import { useEffect, useId, useRef, useState } from 'react';
import { Button } from '@/components/Button';
import { SheetDialog, btnPrimary, btnSecondary, filterChip, segOption, segTrack } from '@/components/ui';
import {
  BLUR_STRENGTH_LABELS, BLUR_STRENGTH_MAX, BLUR_STRENGTH_MIN, DEFAULT_BLUR_STRENGTH, MAX_ZOOM, MIN_ZOOM, NO_EDIT, blurLook, PHOTO_SHAPES, boxFromDrag, boxInCrop, cropRect, isEdited, normBoxToPixels, panCentre, pointOnPicture, rotateEdit, rotatedSize,
  type NormBox, type PhotoEdit,
} from '@/domain/hepPhoto';
import { applySoftFaceBlur, renderEditedPhoto } from '@/lib/imageCompression';

const STRENGTH_KEY = 'hep-blur-strength';

/** The blur strength this therapist used last on this device (light by default). */
function savedStrength(): number {
  try {
    const n = Number(localStorage.getItem(STRENGTH_KEY));
    return n >= BLUR_STRENGTH_MIN && n <= BLUR_STRENGTH_MAX ? n : DEFAULT_BLUR_STRENGTH;
  } catch {
    return DEFAULT_BLUR_STRENGTH;
  }
}
function rememberStrength(n: number) {
  try {
    localStorage.setItem(STRENGTH_KEY, String(n));
  } catch {
    /* storage blocked */
  }
}

const PREVIEW_MAX = 1600; // the preview works from a smaller copy so dragging stays smooth
const VIEW_WIDTH = 480;

export interface PhotoEditorProps {
  open: boolean;
  /** The picture to adjust. */
  source: Blob | null;
  name?: string;
  onCancel: () => void;
  /** The adjusted picture, or the original untouched when nothing was changed (`changed` false). */
  onDone: (blob: Blob, changed: boolean) => void;
}

interface Loaded { preview: HTMLCanvasElement | null; width: number; height: number }

export function PhotoEditor({ open, source, name, onCancel, onDone }: PhotoEditorProps) {
  const [edit, setEdit] = useState<PhotoEdit>(NO_EDIT);
  const strengthId = useId();
  const [mode, setMode] = useState<'move' | 'blur'>('move');
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [draft, setDraft] = useState<{ x0: number; y0: number; x1: number; y1: number } | null>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const drag = useRef<{ x: number; y: number } | null>(null);
  const zoomId = useId();

  // Load a smaller working copy of the picture each time the editor opens.
  useEffect(() => {
    if (!open || !source) return;
    let live = true;
    setEdit({ ...NO_EDIT, blurStrength: savedStrength() }); setMode('move'); setError(null); setDraft(null); setBusy(false); setLoaded(null);
    (async () => {
      try {
        const bitmap = await createImageBitmap(source);
        const scale = Math.min(1, PREVIEW_MAX / Math.max(bitmap.width, bitmap.height));
        const width = Math.max(1, Math.round(bitmap.width * scale));
        const height = Math.max(1, Math.round(bitmap.height * scale));
        const preview = document.createElement('canvas');
        preview.width = width; preview.height = height;
        preview.getContext('2d')?.drawImage(bitmap, 0, 0, width, height);
        bitmap.close();
        if (live) setLoaded({ preview, width, height });
      } catch {
        if (live) setError('This picture could not be opened. Try another file.');
      }
    })();
    return () => { live = false; };
  }, [open, source]);

  const turned = loaded ? rotatedSize(loaded.width, loaded.height, edit.rotation) : null;
  const crop = turned ? cropRect(turned.w, turned.h, edit) : null;
  const viewHeight = crop ? Math.round((VIEW_WIDTH * crop.sh) / crop.sw) : 360;

  // Draw the preview: turn, crop, then blur, exactly as the saved picture will be.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !loaded?.preview || !turned || !crop) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    let image: CanvasImageSource = loaded.preview;
    if (edit.rotation !== 0) {
      const tmp = document.createElement('canvas');
      tmp.width = turned.w; tmp.height = turned.h;
      const t = tmp.getContext('2d');
      if (!t) return;
      t.translate(turned.w / 2, turned.h / 2);
      t.rotate((edit.rotation * Math.PI) / 180);
      t.drawImage(loaded.preview, -loaded.width / 2, -loaded.height / 2);
      image = tmp;
    }
    canvas.width = VIEW_WIDTH; canvas.height = viewHeight;
    ctx.drawImage(image, crop.sx, crop.sy, crop.sw, crop.sh, 0, 0, VIEW_WIDTH, viewHeight);
    const look = blurLook(edit.blurStrength, Math.max(VIEW_WIDTH, viewHeight));
    for (const b of edit.blur) applySoftFaceBlur(ctx, normBoxToPixels(boxInCrop(b, turned.w, turned.h, crop), VIEW_WIDTH, viewHeight), look.radius, look.opacity);
  }, [loaded, edit, turned, crop, viewHeight]);

  const rel = (e: React.PointerEvent) => {
    const r = e.currentTarget.getBoundingClientRect();
    return { px: (e.clientX - r.left) / r.width, py: (e.clientY - r.top) / r.height, w: r.width };
  };
  function down(e: React.PointerEvent) {
    if (!loaded || !crop) return;
    e.currentTarget.setPointerCapture?.(e.pointerId);
    const { px, py } = rel(e);
    drag.current = { x: e.clientX, y: e.clientY };
    if (mode === 'blur') setDraft({ x0: px, y0: py, x1: px, y1: py });
  }
  function move(e: React.PointerEvent) {
    if (!drag.current || !loaded || !turned) return;
    const { px, py, w } = rel(e);
    if (mode === 'blur') { setDraft((d) => (d ? { ...d, x1: px, y1: py } : d)); return; }
    const dx = e.clientX - drag.current.x;
    const dy = e.clientY - drag.current.y;
    drag.current = { x: e.clientX, y: e.clientY };
    setEdit((cur) => ({ ...cur, ...panCentre(cur, turned.w, turned.h, w, dx, dy) }));
  }
  function up() {
    drag.current = null;
    if (mode === 'blur' && draft && turned && crop) {
      const a = pointOnPicture(draft.x0, draft.y0, turned.w, turned.h, crop);
      const b = pointOnPicture(draft.x1, draft.y1, turned.w, turned.h, crop);
      const box = boxFromDrag(a.x, a.y, b.x, b.y);
      if (box) setEdit((cur) => ({ ...cur, blur: [...cur.blur, box] }));
    }
    setDraft(null);
  }

  async function finish() {
    if (!source) return;
    if (!isEdited(edit)) { onDone(source, false); return; }
    setBusy(true);
    setError(null);
    try {
      onDone(await renderEditedPhoto(source, edit), true);
    } catch {
      setError('Could not prepare the picture. Try again.');
    } finally {
      setBusy(false);
    }
  }

  const draftBox: NormBox | null = draft ? { x: Math.min(draft.x0, draft.x1), y: Math.min(draft.y0, draft.y1), w: Math.abs(draft.x1 - draft.x0), h: Math.abs(draft.y1 - draft.y0) } : null;

  return (
    <SheetDialog
      open={open}
      title={name ? `Adjust ${name}` : 'Adjust picture'}
      onClose={onCancel}
      busy={busy}
      error={error}
      footer={
        <>
          <Button type="button" className={btnSecondary} onClick={onCancel} disabled={busy}>Cancel</Button>
          <Button type="button" className={btnPrimary} onClick={() => void finish()} disabled={busy || !loaded}>{busy ? 'Preparing…' : 'Use this picture'}</Button>
        </>
      }
    >
      <div className="space-y-4">
        <div className="mx-auto w-full" style={{ maxWidth: VIEW_WIDTH }}>
          <div className="relative overflow-hidden rounded-xl bg-[var(--paper)]" style={{ aspectRatio: `${VIEW_WIDTH} / ${viewHeight}` }}>
            {!loaded && !error && <p className="absolute inset-0 flex items-center justify-center text-sm text-[var(--muted)]">Opening…</p>}
            <canvas
              ref={canvasRef} aria-label="Picture preview" width={VIEW_WIDTH} height={viewHeight}
              className={`h-full w-full touch-none ${mode === 'blur' ? 'cursor-crosshair' : 'cursor-grab'}`}
              onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up}
            />
            {draftBox && <div className="pointer-events-none absolute border-2 border-dashed border-white shadow" style={{ left: `${draftBox.x * 100}%`, top: `${draftBox.y * 100}%`, width: `${draftBox.w * 100}%`, height: `${draftBox.h * 100}%` }} />}
          </div>
          <p className="mt-1 text-center text-hint text-[var(--muted)]" aria-live="polite">
            {mode === 'blur' ? 'Drag over a face to blur it.' : edit.zoom > 1 ? 'Drag the picture to move it.' : 'Zoom in, then drag the picture to frame it.'}
          </p>
        </div>

        <div className="space-y-1.5">
          <div className="text-label font-medium text-[var(--muted)]">Shape</div>
          <div className={segTrack} role="group" aria-label="Shape">
            {PHOTO_SHAPES.map((s) => (
              <button key={s.key} type="button" aria-pressed={edit.shape === s.key} className={segOption(edit.shape === s.key)} onClick={() => setEdit((cur) => ({ ...cur, shape: s.key, cx: 0.5, cy: 0.5 }))}>{s.label}</button>
            ))}
          </div>
        </div>

        <div className="space-y-1.5">
          <label htmlFor={zoomId} className="text-label font-medium text-[var(--muted)]">Zoom</label>
          <input id={zoomId} type="range" min={MIN_ZOOM} max={MAX_ZOOM} step={0.05} value={edit.zoom} className="w-full" onChange={(e) => setEdit((cur) => { const zoom = Number(e.target.value); return { ...cur, zoom, ...panCentre({ ...cur, zoom }, turned?.w ?? 1, turned?.h ?? 1, VIEW_WIDTH, 0, 0) }; })} />
        </div>

        <div className="flex flex-wrap gap-2">
          <div className={segTrack} role="group" aria-label="Tool">
            <button type="button" aria-pressed={mode === 'move'} className={segOption(mode === 'move')} onClick={() => setMode('move')}>Move</button>
            <button type="button" aria-pressed={mode === 'blur'} className={segOption(mode === 'blur')} onClick={() => setMode('blur')}>Blur a face</button>
          </div>
          <Button type="button" className={filterChip(false)} onClick={() => setEdit((cur) => rotateEdit(cur))}>↻ Turn</Button>
          {edit.blur.length > 0 && <Button type="button" className={filterChip(false)} onClick={() => setEdit((cur) => ({ ...cur, blur: cur.blur.slice(0, -1) }))}>Undo last blur</Button>}
          {isEdited(edit) && <Button type="button" className={filterChip(false)} onClick={() => setEdit((cur) => ({ ...NO_EDIT, blurStrength: cur.blurStrength }))}>Reset</Button>}
        </div>
        {(mode === 'blur' || edit.blur.length > 0) && (
          <div className="space-y-1.5">
            <label htmlFor={strengthId} className="text-label font-medium text-[var(--muted)]">Blur strength: {BLUR_STRENGTH_LABELS[edit.blurStrength - 1]}</label>
            <input
              id={strengthId} type="range" min={BLUR_STRENGTH_MIN} max={BLUR_STRENGTH_MAX} step={1} value={edit.blurStrength} className="w-full"
              onChange={(e) => { const n = Number(e.target.value); rememberStrength(n); setEdit((cur) => ({ ...cur, blurStrength: n })); }}
            />
            <p className="text-hint text-[var(--muted)]">Light keeps the picture natural; use Strong if the face can still be recognised.</p>
          </div>
        )}
        {edit.blur.length > 0 && <p className="text-hint text-[var(--muted)]">{edit.blur.length} {edit.blur.length === 1 ? 'area' : 'areas'} blurred. The blur is part of the saved picture and cannot be undone later.</p>}
      </div>
    </SheetDialog>
  );
}
