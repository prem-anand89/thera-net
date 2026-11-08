import { useState } from 'react';
import { admissionService } from '@/services';
import type { Admission, Patient } from '@/domain/types';
import { toLocalDateStr } from '@/domain/schedule';
import { btnPrimary, btnSecondary, Field, inputCls, SheetDialog } from '@/components/ui';
import { toFriendlyMessage } from '@/lib/errors';

/** Discharge: the date (today unless changed) closes the stay. The discharge bill is a separate step from the profile. */
export function DischargeSheet({
  open,
  onClose,
  patient,
  stay,
}: {
  open: boolean;
  onClose: () => void;
  patient: Pick<Patient, 'name'>;
  stay: Admission;
}) {
  return open ? <DischargeForm onClose={onClose} patient={patient} stay={stay} /> : null;
}

function DischargeForm({ onClose, patient, stay }: { onClose: () => void; patient: Pick<Patient, 'name'>; stay: Admission }) {
  const [date, setDate] = useState(toLocalDateStr(new Date()));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function discharge() {
    setBusy(true);
    setError(null);
    try {
      await admissionService.discharge(stay.id, date);
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
      title="Discharge"
      onClose={onClose}
      error={error}
      busy={busy}
      footer={
        <>
          <button type="button" className={btnSecondary} onClick={onClose} disabled={busy}>
            Cancel
          </button>
          <button type="button" className={btnPrimary} onClick={() => void discharge()} disabled={busy}>
            Discharge
          </button>
        </>
      }
    >
      <div className="space-y-3">
        <p className="text-sm text-[var(--muted)]">
          {patient.name} leaves the ward on this date and no longer appears in ward rounds. Their sessions stay on the record.
        </p>
        <Field label="Discharged on" htmlFor="discharge-date">
          <input id="discharge-date" type="date" className={inputCls} value={date} onChange={(e) => setDate(e.target.value)} />
        </Field>
      </div>
    </SheetDialog>
  );
}
