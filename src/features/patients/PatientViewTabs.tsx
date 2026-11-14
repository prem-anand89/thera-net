export type PatientView = 'visits' | 'invoices' | 'home-program';

/**
 * The Visits | Invoices | Home program switch on a patient's profile. Invoices shows only where the plan and role allow
 * bills; Home program only for clinical staff (HEP), with a red dot while a pain report is waiting. Arrow keys move
 * between the tabs that are showing.
 */
export function PatientViewTabs({
  active,
  visitCount,
  invoiceCount,
  showInvoices = true,
  showHomeProgram = false,
  homeProgramDot = false,
  onChange,
}: {
  active: PatientView;
  visitCount: number;
  invoiceCount: number;
  showInvoices?: boolean;
  showHomeProgram?: boolean;
  homeProgramDot?: boolean;
  onChange: (next: PatientView) => void;
}) {
  const tabs: [PatientView, string][] = [['visits', `Visits (${visitCount})`]];
  if (showInvoices) tabs.push(['invoices', `Invoices (${invoiceCount})`]);
  if (showHomeProgram) tabs.push(['home-program', 'Home program']);
  const keys = tabs.map(([k]) => k);
  return (
    <div role="tablist" aria-label="Patient records" className="flex items-center gap-1 border-b border-[var(--border)]">
      {tabs.map(([key, label]) => (
        <button
          key={key}
          type="button"
          role="tab"
          id={`patient-tab-${key}`}
          aria-selected={active === key}
          aria-label={key === 'home-program' && homeProgramDot ? 'Home program, a pain report is waiting' : undefined}
          tabIndex={active === key ? 0 : -1}
          className={`-mb-px min-h-10 border-b-2 px-3 text-sm font-medium ${
            active === key
              ? 'border-[var(--teal)] text-[var(--teal)]'
              : 'border-transparent text-[var(--muted)] hover:text-[var(--ink)]'
          }`}
          onClick={() => onChange(key)}
          onKeyDown={(e) => {
            if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
              e.preventDefault();
              const step = e.key === 'ArrowRight' ? 1 : -1;
              const other = keys[(keys.indexOf(key) + step + keys.length) % keys.length];
              onChange(other);
              document.getElementById(`patient-tab-${other}`)?.focus();
            }
          }}
        >
          {label}
          {key === 'home-program' && homeProgramDot && <span aria-hidden="true" className="ml-1.5 inline-block h-2 w-2 rounded-full bg-[var(--rust)] align-middle" />}
        </button>
      ))}
    </div>
  );
}
