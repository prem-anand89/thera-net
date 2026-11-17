// The picture part of the Edit exercise form: drag photos in or choose them, see the accepted types and sizes up front,
// adjust each photo (shape, zoom, turn, blur a face), reorder, caption and remove. Holds no upload logic: the form saves
// the pictures. A saved picture can be adjusted too (it is fetched through its viewing link and re-saved as a new one).
import { useEffect, useRef, useState } from 'react';
import { Button } from '@/components/Button';
import { ErrorNote, btnSecondary, inputCls } from '@/components/ui';
import { HEP_ACCEPT, HEP_UPLOAD_RULES, formatBytes, validatePictureFile } from '@/domain/hepPhoto';
import { PhotoEditor } from './PhotoEditor';

export const MAX_PICTURES = 4;

export interface Picture {
  /** A saved picture's key; null for a new one. */
  key: string | null;
  file: File | null;
  preview: string | null;
  caption: string;
  isGif: boolean;
  /** The file already went through the editor (shrunk and saved as WebP): upload it as it is. */
  ready?: boolean;
}

export interface PictureFieldProps {
  pictures: Picture[];
  setPictures: (next: Picture[]) => void;
  /** A problem to show (a rejected file, a rule): the form puts it in its error line. Null clears it. */
  onProblem: (message: string | null) => void;
  disabled?: boolean;
}

export function PictureField({ pictures, setPictures, onProblem, disabled = false }: PictureFieldProps) {
  const [over, setOver] = useState(false);
  const [editing, setEditing] = useState<{ index: number; source: Blob } | null>(null);
  const urls = useRef<string[]>([]);
  useEffect(() => () => { urls.current.forEach((u) => URL.revokeObjectURL(u)); }, []);

  const hasGif = pictures.some((p) => p.isGif);
  const tooMany = hasGif ? pictures.length > 1 : pictures.length > MAX_PICTURES;
  const singleStillHint = !hasGif && pictures.length === 1;

  function addFiles(list: FileList | File[] | null) {
    if (!list || disabled) return;
    const incoming = [...list];
    const next = [...pictures];
    const problems: string[] = [];
    for (const file of incoming) {
      const bad = validatePictureFile(file);
      if (bad) { problems.push(bad); continue; }
      const gif = file.type === 'image/gif';
      if (gif && (next.length > 0 || incoming.length > 1)) { problems.push('A GIF is a single picture. Remove the others first, or use photos.'); break; }
      if (!gif && next.some((p) => p.isGif)) { problems.push('This exercise already has a GIF. Remove it to add photos.'); break; }
      if (next.length >= MAX_PICTURES) { problems.push(`Up to ${MAX_PICTURES} photos for one exercise.`); break; }
      const preview = URL.createObjectURL(file);
      urls.current.push(preview);
      next.push({ key: null, file, preview, caption: '', isGif: gif });
    }
    onProblem(problems.length > 0 ? problems.slice(0, 2).join(' ') : null);
    if (next.length !== pictures.length) setPictures(next);
  }

  const update = (i: number, patch: Partial<Picture>) => setPictures(pictures.map((p, j) => (j === i ? { ...p, ...patch } : p)));
  const move = (i: number, by: -1 | 1) => {
    const j = i + by;
    if (j < 0 || j >= pictures.length) return;
    const next = [...pictures];
    [next[i], next[j]] = [next[j], next[i]];
    setPictures(next);
  };

  async function openEditor(i: number) {
    const p = pictures[i];
    try {
      let source: Blob | null = p.file;
      if (!source && p.preview) source = await (await fetch(p.preview)).blob();
      if (!source) throw new Error('no picture');
      onProblem(null);
      setEditing({ index: i, source });
    } catch {
      onProblem('This picture could not be opened for adjusting. Remove it and add it again.');
    }
  }

  function edited(blob: Blob, changed: boolean) {
    if (editing && changed) {
      const i = editing.index;
      const old = pictures[i];
      const file = new File([blob], `${(old.file?.name ?? 'picture').replace(/\.[^.]+$/, '')}.${blob.type === 'image/jpeg' ? 'jpg' : 'webp'}`, { type: blob.type });
      const preview = URL.createObjectURL(file);
      urls.current.push(preview);
      update(i, { key: null, file, preview, ready: true });
    }
    setEditing(null);
  }

  return (
    <div className="space-y-2">
      <div
        className={`space-y-2 rounded-xl border-2 border-dashed p-3 text-center transition-colors ${over ? 'border-[var(--teal)] bg-[var(--teal-light)]' : 'border-[var(--border)]'}`}
        onDragOver={(e) => { e.preventDefault(); if (!disabled) setOver(true); }}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => { e.preventDefault(); setOver(false); addFiles(e.dataTransfer.files); }}
      >
        <p className="text-sm text-[var(--ink)]">Drag photos here, or</p>
        <div className="flex flex-wrap justify-center gap-2">
          <label className={`${btnSecondary} inline-flex cursor-pointer items-center`}>
            Choose photos or a GIF
            <input type="file" accept={HEP_ACCEPT} multiple disabled={disabled} className="sr-only" onChange={(e) => { addFiles(e.target.files); e.target.value = ''; }} />
          </label>
          <label className={`${btnSecondary} inline-flex cursor-pointer items-center`}>
            Take photos
            <input type="file" accept="image/jpeg,image/png,image/webp" capture="environment" disabled={disabled} className="sr-only" onChange={(e) => { addFiles(e.target.files); e.target.value = ''; }} />
          </label>
        </div>
        <p className="text-hint text-[var(--muted)]">{HEP_UPLOAD_RULES}</p>
        <p className="text-hint text-[var(--muted)]">Do not include a patient&apos;s face: use the Blur tool on any photo that shows one.</p>
      </div>

      {tooMany && <ErrorNote message={hasGif ? 'A GIF is a single picture.' : `Up to ${MAX_PICTURES} photos for one exercise.`} />}
      {singleStillHint && <p className="text-hint text-[var(--muted)]">Two or more photos show the movement better.</p>}

      {pictures.length > 0 && (
        <ul className="grid grid-cols-1 gap-2 tab:grid-cols-2">
          {pictures.map((p, i) => (
            <li key={p.key ?? p.preview ?? i} className="space-y-1.5 rounded-xl border border-[var(--border)] p-2">
              <div className="flex items-start gap-2">
                {p.preview ? <img src={p.preview} alt={`Picture ${i + 1}`} className="h-20 w-20 shrink-0 rounded-lg object-cover" /> : <span className="flex h-20 w-20 shrink-0 items-center justify-center rounded-lg bg-[var(--paper)] text-xs text-[var(--muted)]">Picture {i + 1}</span>}
                <div className="min-w-0 flex-1 space-y-1">
                  <input className={inputCls} aria-label={`Caption for picture ${i + 1}`} placeholder={i === 0 ? 'Start position' : 'Caption (optional)'} maxLength={60} value={p.caption} onChange={(e) => update(i, { caption: e.target.value })} />
                  <p className="text-hint text-[var(--muted)]">
                    {p.isGif ? 'GIF' : p.ready ? 'Adjusted' : p.file ? 'New photo' : 'Saved'}{p.file ? ` · ${formatBytes(p.file.size)}` : ''}
                  </p>
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-1">
                {!p.isGif && <Button type="button" className="min-h-9 rounded-md px-2 text-xs font-medium text-[var(--teal)] hover:bg-[var(--teal-light)] disabled:opacity-50" disabled={disabled} onClick={() => void openEditor(i)}>Adjust or blur</Button>}
                <Button type="button" aria-label={`Move picture ${i + 1} earlier`} className="min-h-9 min-w-9 text-[var(--muted)] disabled:opacity-30" disabled={disabled || i === 0} onClick={() => move(i, -1)}>←</Button>
                <Button type="button" aria-label={`Move picture ${i + 1} later`} className="min-h-9 min-w-9 text-[var(--muted)] disabled:opacity-30" disabled={disabled || i === pictures.length - 1} onClick={() => move(i, 1)}>→</Button>
                <div className="flex-1" />
                <Button type="button" className="min-h-9 px-2 text-xs text-[var(--rust)] disabled:opacity-50" disabled={disabled} onClick={() => setPictures(pictures.filter((_, j) => j !== i))}>Remove picture {i + 1}</Button>
              </div>
            </li>
          ))}
        </ul>
      )}

      <PhotoEditor open={editing !== null} source={editing?.source ?? null} name={editing ? `picture ${editing.index + 1}` : undefined} onCancel={() => setEditing(null)} onDone={edited} />
    </div>
  );
}
