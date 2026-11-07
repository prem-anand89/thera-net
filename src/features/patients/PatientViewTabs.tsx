export type PatientView = 'visits' | 'invoices';

/** The Visits | Invoices switch on a patient's profile. Arrow keys move between the two tabs. */
export function PatientViewTabs({
  active,
  visitCount,
  invoiceCount,
  onChange,
}: {
  active: PatientView;
  visitCount: number;
  invoiceCount: number;
  onChange: (next: PatientView) => void;
}) {
  const tabs: [PatientView, string][] = [
    ['visits', `Visits (${visitCount})`],
    ['invoices', `Invoices (${invoiceCount})`],
  ];
  return (
    <div role="tablist" aria-label="Patient records" className="flex items-center gap-1 border-b border-[var(--border)]">
      {tabs.map(([key, label]) => (
        <button
          key={key}
          type="button"
          role="tab"
          id={`patient-tab-${key}`}
          aria-selected={active === key}
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
              const other: PatientView = key === 'visits' ? 'invoices' : 'visits';
              onChange(other);
              document.getElementById(`patient-tab-${other}`)?.focus();
            }
          }}
        >
          {label}
        </button>
      ))}
    </div>
  );
}
