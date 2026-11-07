import { useMemo, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { useClinic } from '@/app/clinicContext';
import { repos, patientService } from '@/services';
import type { Patient } from '@/domain/types';
import { findSimilarPatients } from '@/domain/similarPatients';
import { homeCareOn } from '@/domain/careLocations';
import { SimilarPatients } from '@/components/SimilarPatients';
import { usePatientDirectory } from '@/components/usePatientDirectory';
import { PhoneField } from '@/components/PhoneField';
import { btnPrimary, btnSecondary, Field, inputCls, SheetDialog } from '@/components/ui';
import { askConfirm } from '@/lib/notify';
import { toFriendlyMessage } from '@/lib/errors';
import { useUnsavedWorkProbe } from '@/lib/unsavedWork';

export interface AddPatientSheetProps {
  open: boolean;
  onClose: () => void;
  /** Name and phone the sheet opens with (for example an appointment booked by someone not yet on file). */
  initialName?: string;
  initialPhone?: string;
  /** The patient was saved. `startVisit` is true only when the person chose "Save and start visit". */
  onCreated: (patient: Patient, opts: { startVisit: boolean }) => void;
  /** "Use this patient" on a look-alike: carry on with the existing record instead of creating one. */
  onUseExisting: (patient: Patient) => void;
  /** Offer "Save and start visit" as the main button, with a plain "Save" beside it. */
  offerStartVisit?: boolean;
}

/**
 * Add a patient, on its own: one sheet, one clear button. Used by New Visit (the new patient is chosen in place),
 * the Patients page, and an appointment's "Create visit" for someone not yet on file. The patient is saved only by
 * the sheet's own button, so a half-filled patient form can never sit beside a visit form. Look-alikes must be
 * answered ("Use this patient" or "Different person") before saving. Mounted only while open, so it always starts fresh.
 */
export function AddPatientSheet(props: AddPatientSheetProps) {
  return props.open ? <AddPatientForm {...props} /> : null;
}

function AddPatientForm({ onClose, initialName = '', initialPhone = '', onCreated, onUseExisting, offerStartVisit = false }: AddPatientSheetProps) {
  const clinic = useClinic();
  const [newPatient, setNewPatient] = useState({
    name: initialName,
    mrno: '',
    age: '',
    sex: '',
    phone: initialPhone,
    email: '',
    altPhone: '',
    address: '',
    primaryCondition: '',
    referringSourceId: '',
    referringSourceDetail: '',
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const referringSources = useLiveQuery(() => repos.referringSourceCatalog.list(clinic.id), [clinic.id]) ?? [];
  const allPatients = useLiveQuery(() => repos.patients.list(clinic.id), [clinic.id]);
  // Look-alikes of the patient being typed (same phone, or a near-identical name), with what tells people apart.
  const { lastVisitOn } = usePatientDirectory(clinic.id, true);
  const similar = useMemo(
    () => findSimilarPatients(allPatients ?? [], newPatient.name, newPatient.phone),
    [allPatients, newPatient.name, newPatient.phone]
  );
  const similarKey = similar.map((m) => m.patient.id).join(',');
  const [differentKey, setDifferentKey] = useState<string | null>(null);
  const differentConfirmed = similar.length > 0 && differentKey === similarKey;

  // Anything typed beyond what the sheet opened with.
  const dirty = newPatient.name !== initialName || newPatient.phone !== initialPhone || Boolean(newPatient.age || newPatient.primaryCondition || newPatient.email || newPatient.address);
  useUnsavedWorkProbe(() => dirty);
  async function requestClose() {
    if (busy) return;
    if (dirty) {
      const discard = await askConfirm({
        title: 'Discard this new patient?',
        message: "You've typed details that haven't been saved.",
        confirmLabel: 'Discard',
        cancelLabel: 'Keep editing',
        destructive: true,
      });
      if (!discard) return;
    }
    onClose();
  }

  async function create(startVisit: boolean) {
    setError(null);
    if (!newPatient.name.trim()) return setError('Enter the patient\'s name.');
    if (similar.length > 0 && !differentConfirmed) {
      return setError('This patient may already be on file. Choose "Use this patient" or "Different person".');
    }
    if (differentConfirmed && (!newPatient.age || !newPatient.sex)) {
      return setError('Add age and sex so this patient can be told apart from the similar one.');
    }
    if (busy) return;
    setBusy(true);
    try {
      const created = await patientService.create({
        clinicId: clinic.id,
        name: newPatient.name,
        mrno: newPatient.mrno || undefined,
        age: newPatient.age ? Number(newPatient.age) : null,
        sex: (newPatient.sex || null) as Patient['sex'],
        phone: newPatient.phone || null,
        email: newPatient.email || null,
        altPhone: newPatient.altPhone || null,
        ...(homeCareOn(clinic) ? { address: newPatient.address || null } : {}),
        primaryCondition: newPatient.primaryCondition || null,
        referringSourceId: newPatient.referringSourceId || null,
        referringSourceDetail: newPatient.referringSourceDetail || null,
      });
      onCreated(created, { startVisit });
    } catch (e) {
      setError(toFriendlyMessage(e));
    } finally {
      setBusy(false);
    }
  }

  const footer = offerStartVisit ? (
    <>
      <button type="button" className={btnSecondary} disabled={busy} onClick={() => void create(false)}>
        Save
      </button>
      <button type="button" className={btnPrimary} disabled={busy} onClick={() => void create(true)}>
        {busy ? 'Saving…' : 'Save and start visit'}
      </button>
    </>
  ) : (
    <>
      <button type="button" className={btnSecondary} disabled={busy} onClick={() => void requestClose()}>
        Cancel
      </button>
      <button type="button" className={btnPrimary} disabled={busy} onClick={() => void create(false)}>
        {busy ? 'Adding…' : 'Add patient'}
      </button>
    </>
  );

  return (
    <SheetDialog open title="Add patient" onClose={() => void requestClose()} footer={footer} error={error} busy={busy}>
      <div className="space-y-3">
      <div className="grid grid-cols-1 gap-3">
        <Field label="Name *">
          <input
            className={inputCls}
            value={newPatient.name}
            onChange={(e) => setNewPatient({ ...newPatient, name: e.target.value })}
            placeholder="Patient name"
            autoFocus
          />
        </Field>
        <Field label="Phone" htmlFor="add-patient-phone">
          <PhoneField
            id="add-patient-phone"
            placeholder="Recommended"
            value={newPatient.phone}
            onChange={(phone) => setNewPatient({ ...newPatient, phone })}
          />
        </Field>
        <SimilarPatients
          matches={similar}
          lastVisitOn={lastVisitOn}
          differentConfirmed={differentConfirmed}
          onUse={onUseExisting}
          onDifferent={() => setDifferentKey(similarKey)}
        />
        {!newPatient.phone.trim() && (
          <p className="text-xs text-[var(--muted)]">
            No phone on file — fine for a walk-in with none, but it limits later search and duplicate checks.
          </p>
        )}
        <Field label="Age">
          <input
            type="number"
            className={inputCls}
            placeholder="Optional"
            value={newPatient.age}
            onChange={(e) => setNewPatient({ ...newPatient, age: e.target.value })}
          />
        </Field>
        <Field label="Sex">
          <select
            className={inputCls}
            value={newPatient.sex}
            onChange={(e) => setNewPatient({ ...newPatient, sex: e.target.value })}
          >
            <option value="">—</option>
            <option value="M">M</option>
            <option value="F">F</option>
            <option value="Other">Other</option>
          </select>
        </Field>
        <Field label="Primary condition">
          <input
            className={inputCls}
            placeholder="e.g. Neck Pain"
            value={newPatient.primaryCondition}
            onChange={(e) => setNewPatient({ ...newPatient, primaryCondition: e.target.value })}
          />
        </Field>
        <Field label="Referring source">
          <select
            className={inputCls}
            value={newPatient.referringSourceId}
            onChange={(e) =>
              setNewPatient({
                ...newPatient,
                referringSourceId: e.target.value,
                referringSourceDetail: '',
              })
            }
          >
            <option value="">—</option>
            {referringSources.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </Field>
        {referringSources.find((s) => s.id === newPatient.referringSourceId)?.detailLabel && (
          <Field
            label={
              referringSources.find((s) => s.id === newPatient.referringSourceId)!.detailLabel!
            }
          >
            <input
              className={inputCls}
              value={newPatient.referringSourceDetail}
              onChange={(e) =>
                setNewPatient({ ...newPatient, referringSourceDetail: e.target.value })
              }
            />
          </Field>
        )}
        <details
          className="rounded-lg border border-[var(--border)] px-3 py-2"
          open={Boolean(newPatient.email || newPatient.altPhone || newPatient.mrno || newPatient.address)}
        >
          <summary className="cursor-pointer text-sm font-medium text-[var(--ink)]">
            More details <span className="font-normal text-[var(--muted)]">(optional)</span>
          </summary>
          <div className="mt-3 grid grid-cols-1 gap-3">
            <Field label="Email">
              <input
                type="email"
                className={inputCls}
                value={newPatient.email}
                onChange={(e) => setNewPatient({ ...newPatient, email: e.target.value })}
              />
            </Field>
            <Field label="Alternate phone" htmlFor="add-patient-alt-phone">
              <PhoneField
                id="add-patient-alt-phone"
                placeholder="Family member, landline…"
                value={newPatient.altPhone}
                onChange={(altPhone) => setNewPatient({ ...newPatient, altPhone })}
              />
            </Field>
            {homeCareOn(clinic) && (
              <Field label="Address (optional)" htmlFor="add-patient-address">
                <textarea
                  id="add-patient-address"
                  rows={2}
                  className={inputCls}
                  placeholder="For home visits"
                  value={newPatient.address}
                  onChange={(e) => setNewPatient({ ...newPatient, address: e.target.value })}
                />
              </Field>
            )}
            <Field label="Patient ID">
              <input
                className={inputCls}
                placeholder="Leave blank to auto-generate"
                value={newPatient.mrno}
                onChange={(e) => setNewPatient({ ...newPatient, mrno: e.target.value })}
              />
            </Field>
            <p className="text-xs text-[var(--muted)]">Use Patient ID only to keep a number from old records.</p>
          </div>
        </details>
      </div>
      <p className="text-xs text-[var(--muted)]">
        You can complete the rest of these later from the profile.
      </p>
        {offerStartVisit && (
          <button type="button" className="text-xs font-medium text-[var(--muted)] underline" disabled={busy} onClick={() => void requestClose()}>
            Cancel
          </button>
        )}
      </div>
    </SheetDialog>
  );
}
