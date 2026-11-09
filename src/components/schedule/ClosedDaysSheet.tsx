import { useDialogBehavior } from '@/components/dialogBehavior';
import { useEffect, useRef, useState } from 'react';
import { Link } from '@tanstack/react-router';
import { ErrorNote, Field, btnPrimary, btnSecondary, inputCls } from '@/components/ui';
import { toFriendlyMessage } from '@/lib/errors';
import { bookingService } from '@/services';
import type { UUID } from '@/domain/types';
import { useClinic } from '@/app/clinicContext';
import { clinicDepartments, DEPARTMENT_LABELS, type Department } from '@/domain/departments';

/** Mark one day or a range closed (holiday, training day, renovation). */
export function ClosedDaysSheet({
  open,
  clinicId,
  initialDate,
  onClose,
}: {
  open: boolean;
  clinicId: UUID;
  initialDate: string;
  onClose: () => void;
}) {
  const dialogRef = useDialogBehavior<HTMLDivElement>(open, onClose);
  const clinic = useClinic();
  const depts = clinicDepartments(clinic);
  const [from, setFrom] = useState(initialDate);
  const [to, setTo] = useState(initialDate);
  const [label, setLabel] = useState('');
  const [selectedDepts, setSelectedDepts] = useState<Department[]>(() => [...depts]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setFrom(initialDate);
    setTo(initialDate);
    setLabel('');
    setSelectedDepts([...depts]);
    setError(null);
    setBusy(false);
    // Reset only when the sheet opens. The parent passes inline callbacks and
    // re-renders every minute and on each sync, which used to wipe in-progress
    // input (date, Sent ticks, a closure being typed).
    // eslint-disable-next-line react-hooks/exhaustive-deps -- reset on open only
  }, [open]);

  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  if (!open) return null;

  async function save() {
    if (!from || !to || to < from) return setError('End date can\'t be before the start.');
    if (depts.length > 1 && selectedDepts.length === 0) {
      return setError('Pick at least one department.');
    }
    setBusy(true);
    setError(null);
    try {
      const deptsToSave = depts.length > 1 && selectedDepts.length < depts.length ? selectedDepts : null;
      await bookingService.setClosedDates(clinicId, from, to, label.trim() || null, deptsToSave);
      onClose();
    } catch (saveError) {
      setError(toFriendlyMessage(saveError));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-[var(--ink)]/45 sm:items-center sm:p-4" onClick={onClose}>
      <div
        ref={dialogRef} role="dialog"
        aria-modal="true"
        aria-labelledby="closed-days-title"
        className="w-full rounded-t-2xl bg-[var(--surface)] p-4 pb-[max(1rem,env(safe-area-inset-bottom))] shadow-xl sm:max-w-md sm:rounded-2xl sm:p-6"
        onClick={(event) => event.stopPropagation()}
      >
        <h2 id="closed-days-title" className="font-display text-lg font-semibold text-[var(--ink)]">
          Set closed days
        </h2>
        <p className="mt-1 text-sm text-[var(--muted)]">
          Closed days show on the calendar and can't be picked on your public booking page. Existing
          appointments are kept.
        </p>
        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          <Field label="From">
            <input
              type="date"
              className={inputCls}
              value={from}
              onChange={(event) => {
                setFrom(event.target.value);
                if (to < event.target.value) setTo(event.target.value);
              }}
            />
          </Field>
          <Field label="To">
            <input type="date" className={inputCls} value={to} min={from} onChange={(event) => setTo(event.target.value)} />
          </Field>
        </div>
        <div className="mt-3">
          <Field label="Label (optional)">
            <input
              className={inputCls}
              value={label}
              maxLength={60}
              placeholder="Diwali, staff training…"
              onChange={(event) => setLabel(event.target.value)}
            />
          </Field>
        </div>
        {depts.length > 1 && (
          <div className="mt-3">
            <span className="block text-xs font-medium text-[var(--muted)]">Applies to</span>
            <div className="mt-1 flex flex-wrap gap-4" role="group" aria-label="Applies to">
              {depts.map((d) => (
                <label key={d} className="inline-flex items-center gap-1.5 text-sm text-[var(--ink)] cursor-pointer">
                  <input
                    type="checkbox"
                    className="rounded border-[var(--border)] text-[var(--teal)] focus:ring-[var(--teal)]"
                    checked={selectedDepts.includes(d)}
                    onChange={(e) => {
                      if (e.target.checked) {
                        setSelectedDepts((prev) => [...prev, d]);
                      } else {
                        setSelectedDepts((prev) => prev.filter((x) => x !== d));
                      }
                    }}
                  />
                  {DEPARTMENT_LABELS[d]}
                </label>
              ))}
            </div>
          </div>
        )}
        <p className="mt-3 text-xs text-[var(--muted)]">
          Closed every week on the same day? Set that in{' '}
          <Link to="/settings" search={{ tab: 'booking' }} className="text-[var(--teal)] hover:underline">
            Settings → Schedule &amp; Booking
          </Link>
          .
        </p>
        <ErrorNote message={error} />
        <div className="mt-4 flex justify-end gap-2">
          <button type="button" className={btnSecondary} onClick={onClose} disabled={busy}>
            Cancel
          </button>
          <button type="button" className={btnPrimary} onClick={() => void save()} disabled={busy}>
            {busy ? 'Saving…' : 'Mark closed'}
          </button>
        </div>
      </div>
    </div>
  );
}
