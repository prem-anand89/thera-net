import { useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { admissionService } from '@/services';
import type { Admission, Patient } from '@/domain/types';
import { toLocalDateStr } from '@/domain/schedule';
import { btnPrimary, btnSecondary, Field, inputCls, SheetDialog } from '@/components/ui';
import { askConfirm } from '@/lib/notify';
import { toFriendlyMessage } from '@/lib/errors';

export interface AdmissionSheetProps {
  open: boolean;
  onClose: () => void;
  patient: Pick<Patient, 'id' | 'clinicId' | 'name'>;
  /** Given: edit this stay. Absent: admit the patient. */
  stay?: Admission;
  onSaved?: (stay: Admission) => void;
}

/**
 * Admit a patient to the ward, or edit the stay (a bed move is an edit: the row changes in place). Only the date is
 * needed; IPD no, ward/bed, admitting doctor and notes are all optional. Mounted only while open, so it starts fresh.
 */
export function AdmissionSheet(props: AdmissionSheetProps) {
  return props.open ? <AdmissionForm {...props} /> : null;
}

function AdmissionForm({ onClose, patient, stay, onSaved }: AdmissionSheetProps) {
  const [form, setForm] = useState({
    admittedOn: stay?.admittedOn ?? toLocalDateStr(new Date()),
    ipdNo: stay?.ipdNo ?? '',
    wardBed: stay?.wardBed ?? '',
    admittingDoctor: stay?.admittingDoctor ?? '',
    notes: stay?.notes ?? '',
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // A stay with sessions on it cannot be deleted; only a mistaken one (no sessions) offers the link.
  const sessions = useLiveQuery(() => (stay ? admissionService.visitsOf(stay) : Promise.resolve([])), [stay?.id]);
  const set = (patch: Partial<typeof form>) => setForm((f) => ({ ...f, ...patch }));

  async function save() {
    setBusy(true);
    setError(null);
    try {
      const saved = stay
        ? await admissionService.update(stay.id, form)
        : await admissionService.admit(patient.clinicId, patient.id, form);
      onSaved?.(saved);
      onClose();
    } catch (e) {
      setError(toFriendlyMessage(e));
    } finally {
      setBusy(false);
    }
  }

  async function deleteMistaken() {
    if (!stay) return;
    const ok = await askConfirm({
      title: 'Delete this stay?',
      message: `${patient.name} will no longer show as admitted. Use this only for a stay entered by mistake.`,
      confirmLabel: 'Delete stay',
      cancelLabel: 'Keep it',
      destructive: true,
    });
    if (!ok) return;
    setBusy(true);
    setError(null);
    try {
      await admissionService.deleteMistaken(stay.id);
      onClose();
    } catch (e) {
      setError(toFriendlyMessage(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <SheetDialog
      open
      title={stay ? 'Edit stay' : 'Admit to ward'}
      onClose={onClose}
      error={error}
      busy={busy}
      footer={
        <>
          <button type="button" className={btnSecondary} onClick={onClose} disabled={busy}>
            Cancel
          </button>
          <button type="button" className={btnPrimary} onClick={() => void save()} disabled={busy}>
            {stay ? 'Save changes' : 'Admit patient'}
          </button>
        </>
      }
    >
      <div className="space-y-3">
        <p className="text-sm text-[var(--muted)]">{patient.name}</p>
        <Field label="Admitted on" htmlFor="admission-date">
          <input
            id="admission-date"
            type="date"
            className={inputCls}
            value={form.admittedOn}
            onChange={(e) => set({ admittedOn: e.target.value })}
          />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="IPD no (optional)" htmlFor="admission-ipd">
            <input id="admission-ipd" className={inputCls} value={form.ipdNo} onChange={(e) => set({ ipdNo: e.target.value })} />
          </Field>
          <Field label="Ward / bed (optional)" htmlFor="admission-ward">
            <input
              id="admission-ward"
              className={inputCls}
              placeholder="Ortho ward, bed 12"
              value={form.wardBed}
              onChange={(e) => set({ wardBed: e.target.value })}
            />
          </Field>
        </div>
        <Field label="Admitting doctor (optional)" htmlFor="admission-doctor">
          <input
            id="admission-doctor"
            className={inputCls}
            value={form.admittingDoctor}
            onChange={(e) => set({ admittingDoctor: e.target.value })}
          />
        </Field>
        <Field label="Notes (optional)" htmlFor="admission-notes">
          <textarea
            id="admission-notes"
            rows={2}
            className={inputCls}
            value={form.notes}
            onChange={(e) => set({ notes: e.target.value })}
          />
        </Field>
        {stay && sessions && sessions.length === 0 && (
          <button
            type="button"
            className="text-sm text-[var(--rust)] hover:underline"
            onClick={() => void deleteMistaken()}
            disabled={busy}
          >
            Delete this stay (entered by mistake)
          </button>
        )}
      </div>
    </SheetDialog>
  );
}
