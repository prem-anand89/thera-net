// Asks a curator where the pictures come from before one or more exercises go into the TheraNet Library, and for the two
// confirmations that matter: the movements are shown correctly (AI pictures), and the clinic may share the pictures.
import { useEffect, useState } from 'react';
import { Button } from '@/components/Button';
import { Field, SheetDialog, btnPrimary, btnSecondary, inputCls } from '@/components/ui';
import { IMAGE_SOURCES, IMAGE_SOURCE_LABELS, type ImageSource, type LibraryProvenance } from '@/domain/hep';

export function PublishToLibraryDialog({ open, count, hasPictures, update = false, busy = false, error, onConfirm, onCancel }: {
  open: boolean;
  /** How many exercises are being published (1 for the exercise form). */
  count: number;
  /** True when at least one of them has pictures. */
  hasPictures: boolean;
  /** True when the single exercise is already in the library and this updates it. */
  update?: boolean;
  busy?: boolean;
  error?: string | null;
  onConfirm: (provenance: LibraryProvenance) => void;
  onCancel: () => void;
}) {
  const [source, setSource] = useState<ImageSource | ''>('');
  const [note, setNote] = useState('');
  const [movementsOk, setMovementsOk] = useState(false);
  const [mayShare, setMayShare] = useState(false);

  useEffect(() => {
    if (open) { setSource(''); setNote(''); setMovementsOk(false); setMayShare(false); }
  }, [open]);

  const needsSource = hasPictures;
  const ready =
    (!needsSource || (source !== '' && mayShare)) &&
    (source !== 'ai_generated' || movementsOk);
  const what = count === 1 ? 'this exercise' : `these ${count} exercises`;

  return (
    <SheetDialog
      open={open}
      title={update ? 'Update in TheraNet Library?' : 'Add to TheraNet Library?'}
      onClose={onCancel}
      busy={busy}
      error={error}
      footer={
        <>
          <Button type="button" className={btnSecondary} onClick={onCancel} disabled={busy}>Cancel</Button>
          <Button
            type="button"
            className={btnPrimary}
            disabled={busy || !ready}
            onClick={() => onConfirm({ imageSource: needsSource && source !== '' ? source : null, imageNote: note.trim() === '' ? null : note.trim() })}
          >
            {busy ? 'Working…' : update ? 'Update library' : 'Add to library'}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <p className="text-sm text-[var(--muted)]">
          This copies {what} (and any pictures) into the TheraNet Library, where other clinics can add {count === 1 ? 'it' : 'them'} to their own Library. Clinics that already copied {count === 1 ? 'it' : 'them'} keep their version.
        </p>
        {needsSource ? (
          <>
            <Field label="Where do the pictures come from?" htmlFor="lib-image-source">
              <select id="lib-image-source" className={inputCls} value={source} onChange={(e) => setSource(e.target.value as ImageSource | '')}>
                <option value="">Choose…</option>
                {IMAGE_SOURCES.map((k) => <option key={k} value={k}>{IMAGE_SOURCE_LABELS[k]}</option>)}
              </select>
            </Field>
            <Field label="Note (optional)" htmlFor="lib-image-note" hint="For example: generated with a named tool, checked by a named physiotherapist.">
              <input id="lib-image-note" className={inputCls} maxLength={200} value={note} onChange={(e) => setNote(e.target.value)} />
            </Field>
            {source === 'ai_generated' && (
              <label className="flex items-start gap-2 text-sm text-[var(--ink)]">
                <input type="checkbox" className="mt-1" checked={movementsOk} onChange={(e) => setMovementsOk(e.target.checked)} />
                <span>I have checked that the movements are shown correctly.</span>
              </label>
            )}
            <label className="flex items-start gap-2 text-sm text-[var(--ink)]">
              <input type="checkbox" className="mt-1" checked={mayShare} onChange={(e) => setMayShare(e.target.checked)} />
              <span>I have the right to share these pictures with all TheraNet clinics.</span>
            </label>
          </>
        ) : (
          <p className="text-sm text-[var(--muted)]">There are no pictures to share, so only the text and the usual dose are copied.</p>
        )}
      </div>
    </SheetDialog>
  );
}
