import { useDialogBehavior } from '@/components/dialogBehavior';
import { useEffect, useState } from 'react';
import { ErrorNote, btnPrimary, btnSecondary } from '@/components/ui';
import { toFriendlyMessage } from '@/lib/errors';
import { minutesToTime, workingHoursProblem } from '@/domain/schedule';
import type { WorkingHours } from '@/domain/types';
import { WorkingHoursEditor, defaultWorkingHours } from './WorkingHoursEditor';

export { defaultWorkingHours };

type ClinicHoursForSheet = { startHour: number; endHour: number; closedWeekdays?: number[]; operating?: WorkingHours | null };

/**
 * Weekly hours for one therapist. Several times per day are allowed; the gap
 * between them is the break (e.g. 9–1 and 2–6 = lunch 1–2), so breaks never
 * need entering separately. "Clinic hours" clears the custom hours.
 */
export function WorkingHoursSheet({
  open,
  therapistName,
  value,
  clinic,
  onSave,
  onClose,
}: {
  open: boolean;
  therapistName: string;
  value: WorkingHours | null | undefined;
  clinic: ClinicHoursForSheet;
  onSave: (hours: WorkingHours | null) => Promise<void>;
  onClose: () => void;
}) {
  const dialogRef = useDialogBehavior<HTMLDivElement>(open, onClose);
  const [custom, setCustom] = useState(false);
  const [hours, setHours] = useState<WorkingHours>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setCustom(Boolean(value));
    setHours(value ?? defaultWorkingHours(clinic));
    setError(null);
    setBusy(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- reset only when opened
  }, [open]);

  if (!open) return null;

  async function save() {
    const value = custom ? hours : null;
    if (value) {
      const problem = workingHoursProblem(value);
      if (problem) return setError(problem);
    }
    setBusy(true);
    setError(null);
    try {
      await onSave(value);
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
        aria-labelledby="working-hours-title"
        className="flex max-h-[92vh] w-full flex-col rounded-t-2xl bg-[var(--surface)] shadow-xl sm:max-w-lg sm:rounded-2xl"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="border-b border-[var(--border)] p-4 sm:p-5">
          <h2 id="working-hours-title" className="font-display text-lg font-semibold text-[var(--ink)]">
            Working hours · {therapistName}
          </h2>
          <p className="text-sm text-[var(--muted)]">
            Set the day's start and end. Add breaks if needed. Only working time is bookable.
          </p>
          <div className="mt-3 flex rounded-lg border border-[var(--border)] p-0.5" role="radiogroup" aria-label="Hours">
            {[false, true].map((candidate) => (
              <button
                key={String(candidate)}
                type="button"
                role="radio"
                aria-checked={custom === candidate}
                onClick={() => setCustom(candidate)}
                className={`min-h-9 flex-1 rounded-md px-3 text-xs font-medium ${custom === candidate ? 'bg-[var(--teal)] text-white' : 'text-[var(--muted)]'}`}
              >
                {candidate ? 'Own hours' : 'Clinic hours'}
              </button>
            ))}
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-4 sm:p-5">
          {!custom ? (
            <p className="text-sm text-[var(--muted)]">
              Uses the clinic's booking hours ({minutesToTime(clinic.startHour * 60)}–{minutesToTime(clinic.endHour * 60)}) on every open day.
            </p>
          ) : (
            <WorkingHoursEditor hours={hours} onChange={setHours} clinic={clinic} />
          )}
          <ErrorNote message={error} />
        </div>

        <div className="flex justify-end gap-2 border-t border-[var(--border)] p-4 pb-[max(1rem,env(safe-area-inset-bottom))] sm:p-5">
          <button type="button" className={btnSecondary} onClick={onClose} disabled={busy}>Cancel</button>
          <button type="button" className={btnPrimary} onClick={() => void save()} disabled={busy}>{busy ? 'Saving…' : 'Save hours'}</button>
        </div>
      </div>
    </div>
  );
}
