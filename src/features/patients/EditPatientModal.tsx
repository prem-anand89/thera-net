import { useState } from 'react';
import type { Patient } from '@/domain/types';
import { toFriendlyMessage } from '@/lib/errors';
import { repos } from '@/services';

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
    referringSource: patient.referringSource ?? '',
  });
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function handleSave() {
    setSaving(true);
    setError(null);
    try {
      await repos.patients.put({
        ...patient,
        name: formData.name,
        age: formData.age ? Number(formData.age) : null,
        sex: (formData.sex as 'M' | 'F' | 'Other' | null) || null,
        phone: formData.phone || null,
        referringSource: (formData.referringSource as Patient['referringSource']) || null,
        updatedAt: new Date().toISOString(),
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

  return (
    <div className="fixed inset-0 z-30 flex items-center justify-center bg-black/40" onClick={onClose}>
      <div className="modal-shell w-96" onClick={(e) => e.stopPropagation()}>
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

          <div className="grid grid-cols-2 gap-3">
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
            />
          </div>

          <div className="field-block">
            <label className="field-label">Referral source</label>
            <select
              value={formData.referringSource}
              onChange={(e) => setFormData({ ...formData, referringSource: e.target.value })}
              className="field-input"
              disabled={saving}
            >
              <option value="">—</option>
              <option value="hospital">Hospital</option>
              <option value="doctor">Doctor</option>
              <option value="physiotherapist">Physiotherapist</option>
              <option value="patient_referred">Patient referral</option>
              <option value="self">Self</option>
            </select>
          </div>
        </div>

        <div className="modal-actions">
          <button className="btn-secondary" onClick={onClose} disabled={saving}>
            Cancel
          </button>
          <button className="btn-primary" onClick={handleSave} disabled={saving}>
            {saving ? 'Saving...' : 'Save'}
          </button>
        </div>
      </div>
    </div>
  );
}
