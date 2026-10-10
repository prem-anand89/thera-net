import { useEffect, useRef, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { repos, bookingService } from '@/services';
import { ErrorNote, btnPrimary, btnSecondary, inputCls } from '@/components/ui';
import { toFriendlyMessage } from '@/lib/errors';
import type { UUID } from '@/domain/types';

const WEEKDAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

/**
 * Admin-side immediate shift assignment: picking a shift template +
 * weekdays assigns the therapist to it right away via `assignShift`
 * (no approval step, unlike the therapist-facing `ShiftRequestSheet`).
 * Custom (non-template) hours stay reachable via the existing
 * `WorkingHoursSheet`/kebab-menu "Working hours, {name}" entry, so this
 * sheet has no custom-hours fallback.
 */
export function AssignShiftSheet({
  open, therapistId, therapistName, clinicId, onClose,
}: {
  open: boolean;
  therapistId: UUID;
  therapistName: string;
  clinicId: UUID;
  onClose: () => void;
}) {
  const templates = useLiveQuery(() => repos.shiftTemplates.list(clinicId), [clinicId]);
  const [shiftId, setShiftId] = useState('');
  const [weekdays, setWeekdays] = useState<number[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setShiftId(''); setWeekdays([]); setError(null); setBusy(false);
  }, [open]);

  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onCloseRef.current(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  if (!open) return null;

  async function submit() {
    if (!shiftId || weekdays.length === 0) return setError('Pick a shift and at least one day.');
    setBusy(true);
    setError(null);
    try {
      await bookingService.assignShift({ therapistId, shiftTemplateId: shiftId, weekdays });
      onClose();
    } catch (err) {
      setError(toFriendlyMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-[var(--ink)]/45 sm:items-center sm:p-4" onClick={onClose}>
      <div role="dialog" aria-modal="true" className="w-full rounded-t-2xl bg-[var(--surface)] p-4 sm:max-w-md sm:rounded-2xl sm:p-6" onClick={(e) => e.stopPropagation()}>
        <h2 className="font-display text-lg font-semibold text-[var(--ink)]">Assign shift, {therapistName}</h2>
        {(templates ?? []).length === 0 ? (
          <p className="mt-2 text-sm text-[var(--muted)]">No shift templates set up yet. Use "Working hours, {therapistName}" to set custom hours instead.</p>
        ) : (
          <>
            <div className="mt-3 flex flex-col gap-3">
              <select className={inputCls} value={shiftId} onChange={(e) => setShiftId(e.target.value)}>
                <option value="">Pick a shift…</option>
                {(templates ?? []).map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
              </select>
              <div className="flex flex-wrap gap-2">
                {WEEKDAY_LABELS.map((label, day) => (
                  <label key={day} className="inline-flex min-h-11 items-center gap-1 text-sm">
                    <input type="checkbox" checked={weekdays.includes(day)} onChange={(e) => setWeekdays((c) => e.target.checked ? [...c, day] : c.filter((d) => d !== day))} />
                    {label}
                  </label>
                ))}
              </div>
            </div>
            <ErrorNote message={error} />
            <div className="mt-4 flex justify-end gap-2">
              <button type="button" className={btnSecondary} onClick={onClose} disabled={busy}>Cancel</button>
              <button type="button" className={btnPrimary} onClick={() => void submit()} disabled={busy}>{busy ? 'Assigning…' : 'Assign shift'}</button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
