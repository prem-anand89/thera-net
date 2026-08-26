import { useEffect, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import type { Patient, ReferringSourceItem } from '@/domain/types';
import { REFERRING_SOURCE_LABELS } from '@/domain/types';
import { useClinic } from '@/app/clinicContext';
import { toFriendlyMessage } from '@/lib/errors';
import { patientService, repos } from '@/services';

interface EditPatientModalProps {
  patient: Patient;
  open: boolean;
  onClose: () => void;
  onSave?: () => void;
}

// Stable reference so useLiveQuery's transient `undefined` while loading
// doesn't produce a fresh [] on every render and thrash the useEffect below.
const NO_REFERRING_SOURCES: ReferringSourceItem[] = [];

export function EditPatientModal({ patient, open, onClose, onSave }: EditPatientModalProps) {
  const clinic = useClinic();
  const referringSources =
    useLiveQuery(() => repos.referringSourceCatalog.list(clinic.id), [clinic.id]) ??
    NO_REFERRING_SOURCES;

  const [formData, setFormData] = useState({
    name: patient.name,
    mrno: patient.mrno,
    age: patient.age ?? '',
    sex: patient.sex ?? '',
    phone: patient.phone ?? '',
    referringSourceId: patient.referringSourceId ?? '',
    referringSourceDetail: patient.referringSourceDetail ?? '',
  });
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  // Guards against `patient`/`referringSources` re-firing mid-edit (any
  // write to either Dexie table, including an unrelated background sync)
  // and silently clobbering whatever the user is currently typing — same
  // fix as EditVisitModal's `loaded` flag. Reset on close (rather than
  // hydrating once forever) because some callers keep this component
  // mounted across open/close cycles for the same patient (toggling `open`
  // instead of mounting fresh each time) — without the reset, reopening
  // after a cancel would keep showing a stale first-open snapshot instead
  // of picking up real edits made elsewhere in between.
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    if (!open) {
      setLoaded(false);
      return;
    }
    if (loaded) return;
    // A patient saved before this catalog existed only has the legacy
    // referringSource enum — best-effort match it to a seeded catalog entry
    // of the same name so it still shows selected, rather than the picker
    // reading as blank for every patient created before this change.
    const matchedLegacyId =
      patient.referringSourceId ??
      (patient.referringSource
        ? referringSources.find((s) => s.name === REFERRING_SOURCE_LABELS[patient.referringSource!])
            ?.id
        : undefined) ??
      '';
    setFormData({
      name: patient.name,
      mrno: patient.mrno,
      age: patient.age ?? '',
      sex: patient.sex ?? '',
      phone: patient.phone ?? '',
      referringSourceId: matchedLegacyId,
      referringSourceDetail: patient.referringSourceDetail ?? '',
    });
    setLoaded(true);
  }, [patient, referringSources, open, loaded]);

  async function handleSave() {
    setSaving(true);
    setError(null);
    try {
      await patientService.update(patient.id, {
        name: formData.name,
        mrno: formData.mrno,
        age: formData.age === '' ? null : Number(formData.age),
        sex: (formData.sex as Patient['sex']) || null,
        phone: formData.phone || null,
        referringSourceId: formData.referringSourceId || null,
        referringSourceDetail: formData.referringSourceDetail || null,
      });
      onSave?.();
      onClose();
    } catch (e) {
      setError(toFriendlyMessage(e));
    } finally {
      setSaving(false);
    }
  }

  if (!open) return null;

  const detailLabel =
    referringSources.find((s) => s.id === formData.referringSourceId)?.detailLabel ?? null;

  return (
    <div
      className="fixed inset-0 z-30 flex items-center justify-center bg-black/40 p-4"
      onClick={onClose}
    >
      <div
        className="modal-shell w-full max-w-sm max-h-[90vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="modal-header">
          <h2>Edit patient</h2>
          <button type="button" className="modal-close" onClick={onClose}>
            ✕
          </button>
        </div>

        {error && (
          <div className="mx-4 mt-4 rounded bg-[var(--rust-light)] p-2 text-sm text-[var(--rust)]">
            {error}
          </div>
        )}

        <div className="modal-body">
          <div className="field-block">
            <label className="field-label">Name *</label>
            <input
              type="text"
              value={formData.name}
              onChange={(e) => setFormData({ ...formData, name: e.target.value })}
              className="field-input"
              disabled={saving}
            />
          </div>

          <div className="field-block">
            <label className="field-label">Patient ID</label>
            <input
              type="text"
              value={formData.mrno}
              onChange={(e) => setFormData({ ...formData, mrno: e.target.value })}
              className="field-input"
              disabled={saving}
              aria-label="Patient ID"
            />
          </div>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="field-block">
              <label className="field-label">Age</label>
              <input
                type="number"
                min="0"
                max="150"
                value={formData.age}
                onChange={(e) => setFormData({ ...formData, age: e.target.value })}
                className="field-input"
                placeholder="e.g., 45"
                disabled={saving}
              />
            </div>

            <div className="field-block">
              <label className="field-label">Sex</label>
              <select
                value={formData.sex}
                onChange={(e) => setFormData({ ...formData, sex: e.target.value })}
                className="field-input"
                disabled={saving}
              >
                <option value="">—</option>
                <option value="M">M</option>
                <option value="F">F</option>
                <option value="Other">Other</option>
              </select>
            </div>
          </div>

          <div className="field-block">
            <label className="field-label">Phone</label>
            <input
              type="tel"
              value={formData.phone}
              onChange={(e) => setFormData({ ...formData, phone: e.target.value })}
              className="field-input"
              disabled={saving}
              aria-label="Phone"
            />
          </div>

          <div className="field-block">
            <label className="field-label">Referral source</label>
            <select
              value={formData.referringSourceId}
              onChange={(e) =>
                setFormData({
                  ...formData,
                  referringSourceId: e.target.value,
                  referringSourceDetail: '',
                })
              }
              className="field-input"
              disabled={saving}
              aria-label="Referral source"
            >
              <option value="">—</option>
              {referringSources.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </div>

          {detailLabel && (
            <div className="field-block">
              <label className="field-label">{detailLabel}</label>
              <input
                type="text"
                value={formData.referringSourceDetail}
                onChange={(e) =>
                  setFormData({ ...formData, referringSourceDetail: e.target.value })
                }
                className="field-input"
                disabled={saving}
              />
            </div>
          )}
        </div>

        <div className="modal-actions">
          <button type="button" className="btn-secondary" onClick={onClose} disabled={saving}>
            Cancel
          </button>
          <button
            type="button"
            className="btn-primary"
            onClick={() => void handleSave()}
            disabled={saving}
          >
            {saving ? 'Saving...' : 'Save'}
          </button>
        </div>
      </div>
    </div>
  );
}
