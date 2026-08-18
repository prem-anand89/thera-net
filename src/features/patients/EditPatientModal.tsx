import { useEffect, useState } from 'react';
import type { Patient, ReferringSource } from '@/domain/types';
import {
  REFERRING_SOURCE_LABELS,
  coerceReferringSource,
  referringSourceDetailLabel,
} from '@/domain/types';
import { toFriendlyMessage } from '@/lib/errors';
import { patientService } from '@/services';

interface EditPatientModalProps {
  patient: Patient;
  open: boolean;
  onClose: () => void;
  onSave?: () => void;
}

export function EditPatientModal({ patient, open, onClose, onSave }: EditPatientModalProps) {
  const [formData, setFormData] = useState({
    name: patient.name,
    age: patient.age ?? '',
    sex: patient.sex ?? '',
    phone: patient.phone ?? '',
    referringSource: (coerceReferringSource(patient.referringSource) ?? '') as ReferringSource | '',
    referringSourceDetail: patient.referringSourceDetail ?? '',
  });
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setFormData({
      name: patient.name,
      age: patient.age ?? '',
      sex: patient.sex ?? '',
      phone: patient.phone ?? '',
      referringSource: (coerceReferringSource(patient.referringSource) ?? '') as ReferringSource | '',
      referringSourceDetail: patient.referringSourceDetail ?? '',
    });
  }, [patient]);

  async function handleSave() {
    setSaving(true);
    setError(null);
    try {
      await patientService.update(patient.id, {
        name: formData.name,
        age: formData.age === '' ? null : Number(formData.age),
        sex: (formData.sex as Patient['sex']) || null,
        phone: formData.phone || null,
        referringSource: formData.referringSource || null,
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

  const detailLabel = referringSourceDetailLabel(formData.referringSource);

  return (
    <div className="fixed inset-0 z-30 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div className="modal-shell w-full max-w-sm max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2>Edit patient</h2>
          <button className="modal-close" onClick={onClose}>✕</button>
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
              value={formData.referringSource}
              onChange={(e) =>
                setFormData({
                  ...formData,
                  referringSource: e.target.value as ReferringSource | '',
                  referringSourceDetail: '',
                })
              }
              className="field-input"
              disabled={saving}
              aria-label="Referral source"
            >
              <option value="">—</option>
              {(Object.entries(REFERRING_SOURCE_LABELS) as [ReferringSource, string][]).map(
                ([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                )
              )}
            </select>
          </div>

          {detailLabel && (
            <div className="field-block">
              <label className="field-label">{detailLabel}</label>
              <input
                type="text"
                value={formData.referringSourceDetail}
                onChange={(e) => setFormData({ ...formData, referringSourceDetail: e.target.value })}
                className="field-input"
                disabled={saving}
              />
            </div>
          )}
        </div>

        <div className="modal-actions">
          <button className="btn-secondary" onClick={onClose} disabled={saving}>
            Cancel
          </button>
          <button className="btn-primary" onClick={() => void handleSave()} disabled={saving}>
            {saving ? 'Saving...' : 'Save'}
          </button>
        </div>
      </div>
    </div>
  );
}
