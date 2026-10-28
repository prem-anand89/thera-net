import { useEffect, useId, useMemo, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { useClinic } from '@/app/clinicContext';
import { useDialogBehavior } from '@/components/dialogBehavior';
import { btnPrimary, btnSecondary, Field, inputCls } from '@/components/ui';
import { FOLLOW_UP_PRESETS, followUpDateFor } from '@/domain/followUp';
import { toLocalDateStr } from '@/domain/schedule';
import { formatDateDMY } from '@/domain/fiscalYear';
import type { Patient, UUID } from '@/domain/types';
import { toFriendlyMessage } from '@/lib/errors';
import { patientService, repos } from '@/services';

/**
 * Set, change or remove a patient's follow-up review: when they should come back, who should see them, and a short
 * note. A target date only; nothing is booked or sent from here (the Workspace "Follow up" card does the messaging
 * and booking). Opened from the patient profile, a visit's ⋮ menu, the saved-visit screen and the note editor.
 */
export function FollowUpDialog({
  open,
  patientId,
  defaultTherapistId,
  onClose,
  onSaved,
}: {
  open: boolean;
  patientId: UUID;
  /** Who it goes to when the patient has none yet (the visit's therapist, or the signed-in one). */
  defaultTherapistId?: UUID | null;
  onClose: () => void;
  onSaved?: (patient: Patient | null) => void;
}) {
  const clinic = useClinic();
  const today = toLocalDateStr(new Date());
  const patient = useLiveQuery(() => repos.patients.get(patientId), [patientId]);
  const therapists = useLiveQuery(() => repos.therapists.list(clinic.id), [clinic.id]);
  const lastVisitTherapist = useLiveQuery(async () => {
    const visits = await repos.visits.list({ clinicId: clinic.id, patientId });
    return [...visits].filter((v) => !v.deleted).sort((a, b) => b.visitDate.localeCompare(a.visitDate))[0]?.therapistId ?? null;
  }, [clinic.id, patientId]);

  const [on, setOn] = useState('');
  const [note, setNote] = useState('');
  const [therapistId, setTherapistId] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const titleId = useId();
  const panelRef = useDialogBehavior<HTMLDivElement>(open, onClose);

  // Fill the form once per opening (a background sync must not overwrite what is being typed).
  useEffect(() => {
    if (!open) {
      setLoaded(false);
      return;
    }
    if (loaded || !patient || lastVisitTherapist === undefined) return;
    setOn(patient.followUpOn ?? '');
    setNote(patient.followUpNote ?? '');
    setTherapistId(patient.followUpTherapistId ?? defaultTherapistId ?? lastVisitTherapist ?? '');
    setError(null);
    setLoaded(true);
  }, [open, loaded, patient, lastVisitTherapist, defaultTherapistId]);

  const roster = useMemo(
    () => (therapists ?? []).filter((t) => t.active !== false || t.id === therapistId).sort((a, b) => a.name.localeCompare(b.name)),
    [therapists, therapistId]
  );
  if (!open) return null;

  async function save() {
    setBusy(true);
    setError(null);
    try {
      const updated = await patientService.setFollowUp(patientId, { on, note, therapistId: therapistId || null });
      onSaved?.(updated);
      onClose();
    } catch (e) {
      setError(toFriendlyMessage(e));
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    setBusy(true);
    setError(null);
    try {
      await patientService.setFollowUp(patientId, null);
      onSaved?.(null);
      onClose();
    } catch (e) {
      setError(toFriendlyMessage(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-[var(--ink)]/40 p-4" onClick={onClose}>
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="dialog-panel w-full max-w-sm space-y-3 rounded-[10px] bg-[var(--surface)] p-5"
        onClick={(e) => e.stopPropagation()}
      >
        <div>
          <h2 id={titleId} className="text-sm font-semibold text-[var(--ink)]">
            Follow-up review
          </h2>
          {patient && <p className="text-xs text-[var(--muted)]">{patient.name}</p>}
        </div>

        <div>
          <span className="mb-1 block text-xs font-medium text-[var(--muted)]">Come back in</span>
          <div className="flex flex-wrap gap-1.5">
            {FOLLOW_UP_PRESETS.map((preset) => {
              const date = followUpDateFor(preset.key, today);
              return (
                <button
                  key={preset.key}
                  type="button"
                  aria-pressed={on === date}
                  onClick={() => setOn(date)}
                  className={`min-h-9 rounded-full border px-3 text-xs font-medium ${
                    on === date
                      ? 'border-[var(--teal)] bg-[var(--teal-light)] text-[var(--teal-strong)]'
                      : 'border-[var(--border)] bg-[var(--surface)] text-[var(--ink)] hover:border-[var(--teal)]'
                  }`}
                >
                  {preset.label}
                </button>
              );
            })}
          </div>
        </div>

        <Field label="Or pick a date" htmlFor="follow-up-date">
          <input id="follow-up-date" type="date" className={inputCls} min={today} value={on} onChange={(e) => setOn(e.target.value)} />
        </Field>
        {on && <p className="-mt-1 text-xs text-[var(--muted)]">Target: {formatDateDMY(on)}. Nothing is booked until a time is agreed.</p>}

        <Field label="Who should see them">
          <select className={inputCls} value={therapistId} onChange={(e) => setTherapistId(e.target.value)}>
            <option value="">Anyone</option>
            {roster.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </select>
        </Field>

        <Field label="Note (optional)">
          <input
            className={inputCls}
            maxLength={200}
            placeholder="e.g. reassess knee"
            value={note}
            onChange={(e) => setNote(e.target.value)}
          />
        </Field>

        {error && <p role="alert" className="text-xs text-[var(--rust)]">{error}</p>}

        <div className="flex items-center justify-between gap-2 pt-1">
          {patient?.followUpOn ? (
            <button type="button" className="min-h-11 text-xs font-medium text-[var(--rust)]" disabled={busy} onClick={() => void remove()}>
              Remove
            </button>
          ) : (
            <span />
          )}
          <div className="flex gap-2">
            <button type="button" className={btnSecondary} onClick={onClose} disabled={busy}>
              Cancel
            </button>
            <button type="button" className={btnPrimary} disabled={busy || !on} onClick={() => void save()}>
              {busy ? 'Saving…' : 'Save'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
