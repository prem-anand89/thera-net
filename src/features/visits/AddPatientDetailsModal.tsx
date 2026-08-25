import { useLiveQuery } from 'dexie-react-hooks';
import { repos } from '@/services';
import type { UUID } from '@/domain/types';

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

  if (!patient) return null;

  const hasDetails = patient.phone || patient.age || patient.sex;
  if (hasDetails) return null;

  return (
    <div className="modal-overlay open">
      <div className="modal-card">
        <h3>Add patient details?</h3>
        <p className="modal-sub">{patient.name}</p>
        <p style={{ fontSize: 13, color: 'var(--text-muted)', marginBottom: 16 }}>
          Optional: add phone, age, and sex to complete the patient profile.
        </p>
        <div className="modal-actions">
          <button type="button" className="btn-secondary" onClick={onClose}>
            Edit later
          </button>
          <button
            type="button"
            className="btn-primary"
            onClick={() => {
              onOpenEdit();
              onClose();
            }}
          >
            Add now
          </button>
        </div>
      </div>
    </div>
  );
}
