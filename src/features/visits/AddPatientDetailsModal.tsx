import { useLiveQuery } from 'dexie-react-hooks';
import { repos } from '@/services';
import type { UUID } from '@/domain/types';
import { btnPrimary, btnSecondary, SheetDialog } from '@/components/ui';

/** Quick prompt to add optional patient details (phone, age, sex) after
 *  a new walk-in patient is created during visit logging. Offers two paths:
 *  "Add now" opens the full editor, "Edit later" dismisses and continues. */
export function AddPatientDetailsModal({
  patientId,
  onClose,
  onOpenEdit,
}: {
  patientId: UUID;
  onClose: () => void;
  onOpenEdit: () => void;
}) {
  const patient = useLiveQuery(() => repos.patients.get(patientId), [patientId]);

  const hasDetails = Boolean(patient?.phone || patient?.age || patient?.sex);
  const open = Boolean(patient && !hasDetails);

  return (
    <SheetDialog
      open={open}
      title="Add patient details?"
      onClose={onClose}
      footer={
        <>
          <button type="button" className={btnSecondary} onClick={onClose}>
            Edit later
          </button>
          <button
            type="button"
            className={btnPrimary}
            onClick={() => {
              onOpenEdit();
              onClose();
            }}
          >
            Add now
          </button>
        </>
      }
    >
      {patient && (
        <div className="space-y-1.5">
          <p className="text-sm font-medium text-[var(--ink)]">{patient.name}</p>
          <p className="text-sm text-[var(--muted)]">
            Optional: add phone, age, and sex to complete the patient profile.
          </p>
        </div>
      )}
    </SheetDialog>
  );
}
