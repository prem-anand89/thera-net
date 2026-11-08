import { useMemo, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { useClinic } from '@/app/clinicContext';
import { repos } from '@/services';
import type { Patient } from '@/domain/types';
import { btnSecondary, inputCls, SheetDialog } from '@/components/ui';

const LIMIT = 8;

/**
 * "+ Admit patient" from the ward-rounds card: pick the patient, then the same admit sheet the profile uses opens.
 * A patient who is already on the ward is listed but cannot be picked; "Add a new patient" opens the Add patient sheet.
 */
export function AdmitPatientPicker({
  open,
  onClose,
  admittedIds,
  onPick,
  onAddNew,
}: {
  open: boolean;
  onClose: () => void;
  /** Patients with an open stay. */
  admittedIds: ReadonlySet<string>;
  onPick: (patient: Patient) => void;
  onAddNew: () => void;
}) {
  const clinic = useClinic();
  const [query, setQuery] = useState('');
  const patients = useLiveQuery(() => (open ? repos.patients.list(clinic.id) : []), [clinic.id, open]);
  const matches = useMemo(() => {
    const q = query.trim().toLowerCase();
    const digits = q.replace(/\D/g, '');
    const list = (patients ?? []).filter((p) => !p.deletedAt);
    if (!q) return [];
    return list
      .filter(
        (p) =>
          p.name.toLowerCase().includes(q) ||
          p.mrno.toLowerCase().startsWith(q) ||
          (digits.length >= 3 && (p.phone ?? '').replace(/\D/g, '').includes(digits))
      )
      .slice(0, LIMIT);
  }, [patients, query]);

  return (
    <SheetDialog
      open={open}
      title="Admit patient"
      onClose={onClose}
      footer={
        <button type="button" className={btnSecondary} onClick={onClose}>
          Cancel
        </button>
      }
    >
      <div className="space-y-3">
        <input
          autoFocus
          className={inputCls}
          placeholder="Search by name, ID or phone"
          aria-label="Search patients"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        {query.trim() && matches.length === 0 && patients !== undefined && (
          <p className="text-sm text-[var(--muted)]">No patient found.</p>
        )}
        <ul className="divide-y divide-[var(--border)]">
          {matches.map((p) => {
            const admitted = admittedIds.has(p.id);
            return (
              <li key={p.id}>
                <button
                  type="button"
                  className="flex w-full items-center justify-between gap-2 py-2.5 text-left text-sm hover:bg-[var(--paper)] disabled:opacity-60"
                  disabled={admitted}
                  onClick={() => onPick(p)}
                >
                  <span>
                    <span className="font-medium text-[var(--ink)]">{p.name}</span>{' '}
                    <span className="text-[var(--muted)]">{p.mrno}</span>
                  </span>
                  {admitted && <span className="text-xs text-[var(--muted)]">Already admitted</span>}
                </button>
              </li>
            );
          })}
        </ul>
        <button type="button" className="text-sm font-medium text-[var(--teal)] hover:underline" onClick={onAddNew}>
          + Add a new patient
        </button>
      </div>
    </SheetDialog>
  );
}
