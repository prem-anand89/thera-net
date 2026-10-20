import type { Patient } from '@/domain/types';
import { patientSummary, type SimilarMatch } from '@/domain/similarPatients';

/**
 * "Is this one of them?" for a patient being created: each look-alike with what tells people apart
 * (ID, age and sex, condition, last visit) and a button to use that record, plus a deliberate
 * "Different person". Nothing renders when there are no matches or the choice is already made.
 */
export function SimilarPatients({
  matches,
  lastVisitOn,
  onUse,
  onDifferent,
  differentConfirmed,
}: {
  matches: SimilarMatch[];
  lastVisitOn?: Map<string, string>;
  onUse: (patient: Patient) => void;
  onDifferent: () => void;
  differentConfirmed: boolean;
}) {
  if (!matches.length) return null;
  if (differentConfirmed) {
    return <p className="text-xs text-[var(--muted)]" data-similar-resolved>Treated as a different person from {matches.length === 1 ? 'the similar patient' : 'the similar patients'} on file.</p>;
  }
  const byPhone = matches.some((m) => m.matchedBy === 'phone');
  return (
    <section aria-label="Similar patients" className="space-y-2 rounded-lg border border-[var(--rust)] bg-[var(--rust-light)] p-3 text-sm" data-similar-patients>
      <p className="text-xs font-medium text-[var(--rust)]">
        {byPhone ? 'This phone number is already on file.' : 'A patient with a similar name is already on file.'} Same person?
      </p>
      <ul className="space-y-1.5">
        {matches.map(({ patient, matchedBy }) => (
          <li key={patient.id} className="flex items-center justify-between gap-2 rounded-md bg-[var(--surface)] px-2.5 py-2">
            <span className="min-w-0">
              <span className="block truncate font-medium text-[var(--ink)]">
                {patient.name}
                {matchedBy === 'phone' && <span className="ml-1.5 text-[11px] font-normal text-[var(--rust)]">same phone</span>}
              </span>
              <span className="block truncate text-xs text-[var(--muted)]">{patientSummary(patient, lastVisitOn?.get(patient.id))}</span>
            </span>
            <button type="button" className="min-h-9 shrink-0 rounded-lg border border-[var(--border)] px-2.5 text-xs font-medium text-[var(--teal)] hover:bg-[var(--paper)]" onClick={() => onUse(patient)}>
              Use this patient
            </button>
          </li>
        ))}
      </ul>
      <button type="button" className="min-h-9 text-xs font-medium text-[var(--ink)] underline underline-offset-2" onClick={onDifferent}>
        Different person
      </button>
    </section>
  );
}
