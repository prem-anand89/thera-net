import { Link } from '@tanstack/react-router';
import type { PatientProfileBackTarget } from '@/app/router';
import { patientIdentityLine } from './formatters';
import type { VisitCardData } from './types';

export function PatientNameBlock({
  data,
  onEditPatient,
  backTo,
}: {
  data: VisitCardData;
  onEditPatient?: () => void;
  /** Where the patient profile's own "← Back" link should return to —
   *  set by whichever list is rendering this row (Ledger, Workspace).
   *  Omitted where clicking through doesn't leave the current page in
   *  any meaningful sense (e.g. Patient Profile's own visit history). */
  backTo?: PatientProfileBackTarget;
}) {
  return (
    <div className="min-w-0">
      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
        <Link
          to="/patients/$patientId"
          params={{ patientId: data.patientId }}
          search={backTo ? { from: backTo } : undefined}
          className="whitespace-nowrap font-display text-sm font-medium text-[var(--ink)] hover:underline"
        >
          {data.patientName}
        </Link>
        {onEditPatient && (
          <button
            type="button"
            className="text-[var(--muted)] hover:text-[var(--ink)]"
            aria-label="Edit patient"
            title="Edit patient"
            onClick={onEditPatient}
          >
            ✎
          </button>
        )}
      </div>
      <div className="text-xs text-[var(--muted)]">
        {patientIdentityLine(data.mrno, data.age, data.sex)}
      </div>
    </div>
  );
}
