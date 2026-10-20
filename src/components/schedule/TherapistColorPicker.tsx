import { useEffect, useState } from 'react';
import { Panel, btnPrimary, btnSecondary } from '@/components/ui';
import { THERAPIST_PALETTE, THERAPIST_PALETTE_NAMES, isHexColor, isReadableColor } from './scheduleColors';

/**
 * Pick a therapist's schedule color: the app's eight validated swatches (each marked with who already
 * uses it), or a custom color that is dark enough to show on the white schedule, with a live preview.
 * `takenBy` maps a lower-case #rrggbb to the name of ANOTHER therapist using it.
 */
export function TherapistColorPicker({
  value,
  onChange,
  takenBy = {},
  name = 'Therapist',
}: {
  value: string;
  onChange: (hex: string) => void;
  takenBy?: Record<string, string>;
  name?: string;
}) {
  const [customError, setCustomError] = useState<string | null>(null);
  const current = value.toLowerCase();
  const inPalette = THERAPIST_PALETTE.some((c) => c.toLowerCase() === current);

  return (
    <div className="space-y-3" data-color-picker>
      <div className="grid grid-cols-4 gap-x-2 gap-y-3" role="group" aria-label="Schedule color">
        {THERAPIST_PALETTE.map((hex, index) => {
          const owner = takenBy[hex.toLowerCase()];
          const selected = current === hex.toLowerCase();
          return (
            <button
              key={hex}
              type="button"
              aria-pressed={selected}
              aria-label={`${THERAPIST_PALETTE_NAMES[index]}${owner ? `, used by ${owner}` : ''}`}
              onClick={() => {
                setCustomError(null);
                onChange(hex);
              }}
              className="flex min-h-11 flex-col items-center gap-1 rounded-lg px-1 py-1 text-center hover:bg-[var(--paper)]"
            >
              <span
                className={`flex h-8 w-8 items-center justify-center rounded-full text-sm font-bold text-white ${selected ? 'ring-2 ring-[var(--ink)] ring-offset-2' : ''}`}
                style={{ background: hex }}
                aria-hidden
              >
                {selected ? '✓' : ''}
              </span>
              <span className="max-w-full truncate text-[10px] leading-tight text-[var(--muted)]">
                {owner ? `${owner.split(/\s+/)[0]}'s` : THERAPIST_PALETTE_NAMES[index]}
              </span>
            </button>
          );
        })}
      </div>

      <div className="flex items-center gap-3">
        <label className="flex min-h-11 cursor-pointer items-center gap-2 text-sm font-medium text-[var(--teal)]">
          <input
            type="color"
            aria-label="Custom color"
            className="h-8 w-8 cursor-pointer rounded border border-[var(--border)] bg-transparent p-0.5"
            value={isHexColor(value) ? value : '#468adb'}
            onChange={(event) => {
              const next = event.target.value;
              if (!isReadableColor(next)) {
                setCustomError('That color is too light to see on the schedule. Pick a darker one.');
                return;
              }
              setCustomError(null);
              onChange(next);
            }}
          />
          Custom…
        </label>
        {!inPalette && isHexColor(value) && <span className="text-xs text-[var(--muted)]">Custom color in use</span>}
      </div>
      {customError && (
        <p role="alert" className="text-xs text-[var(--rust)]">
          {customError}
        </p>
      )}

      <div>
        <p className="mb-1 text-[11px] font-medium text-[var(--muted)]">Preview</p>
        <div
          className="rounded-md border border-l-4 border-[var(--border)] bg-[var(--surface)] px-2 py-1 text-xs shadow-sm"
          style={{ borderLeftColor: isHexColor(value) ? value : undefined }}
          data-color-preview
        >
          <span className="block font-medium text-[var(--ink)]">Sample patient</span>
          <span className="block text-[11px] text-[var(--muted)]">10:00 AM · {name}</span>
        </div>
      </div>
    </div>
  );
}

/**
 * A small sheet to change one therapist's color straight from the schedule: swatches, preview, Save.
 * `onSave(null)` means "back to the default color".
 */
export function TherapistColorSheet({
  open,
  onClose,
  therapistName,
  value,
  takenBy,
  onSave,
}: {
  open: boolean;
  onClose: () => void;
  therapistName: string;
  value: string;
  takenBy: Record<string, string>;
  onSave: (hex: string | null) => Promise<void> | void;
}) {
  const [draft, setDraft] = useState(value);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (open) setDraft(value);
  }, [open, value]);

  async function save(next: string | null) {
    setBusy(true);
    try {
      await onSave(next);
      onClose();
    } finally {
      setBusy(false);
    }
  }

  return (
    <Panel open={open} onClose={onClose} title={`Color for ${therapistName}`}>
      <TherapistColorPicker value={draft} onChange={setDraft} takenBy={takenBy} name={therapistName} />
      <div className="mt-4 flex flex-wrap items-center gap-2">
        <button type="button" className={`${btnPrimary} min-h-11`} disabled={busy || draft.toLowerCase() === value.toLowerCase()} onClick={() => void save(draft)}>
          Save
        </button>
        <button type="button" className={`${btnSecondary} min-h-11`} disabled={busy} onClick={() => void save(null)}>
          Use default
        </button>
      </div>
    </Panel>
  );
}
