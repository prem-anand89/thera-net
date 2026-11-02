import { Field, InfoTip, inputCls } from '@/components/ui';
import { cleanClinicCode } from '@/domain/clinicCode';
import { fiscalYearOf } from '@/domain/fiscalYear';
import { formatInvoiceNo } from '@/domain/invoiceNumber';
import { formatWalkInMrno } from '@/domain/walkInMrno';

export type ClinicCodeValue = { invoicePrefix: string; walkInMrnoPrefix: string | null };

/**
 * The clinic code: one short code that starts both Patient IDs (BM26-0001) and invoice numbers (BM/26-27/0001).
 * Stored in two columns (`invoice_prefix`, `walk_in_mrno_prefix`). While the two are the same, editing the field changes
 * both; a clinic whose two codes already differ keeps them until it taps "Use X for both". A clinic with no patient
 * prefix is on the "W" fallback and is offered the same button.
 */
export function ClinicCodeField({
  invoicePrefix,
  walkInMrnoPrefix,
  fyStartMonth,
  invoicing,
  onChange,
  today = new Date(),
}: {
  invoicePrefix: string;
  walkInMrnoPrefix: string | null | undefined;
  fyStartMonth: number;
  /** Whether the plan has invoicing: the invoice example only shows then. */
  invoicing: boolean;
  onChange: (next: ClinicCodeValue) => void;
  today?: Date;
}) {
  const patientPrefix = walkInMrnoPrefix?.trim() || '';
  const linked = patientPrefix !== '' && patientPrefix === invoicePrefix;
  const patientEffective = patientPrefix || 'W';
  const yy = String(today.getFullYear()).slice(2);
  const differs = invoicePrefix !== '' && patientEffective !== invoicePrefix;

  return (
    <Field
      label={
        <>
          Clinic code
          <InfoTip text="A short code that starts your Patient IDs and invoice numbers. It applies to new patients and new invoices; existing IDs and invoice numbers stay as they are." />
        </>
      }
      htmlFor="clinic-code"
      hint={
        <>
          Patient IDs look like {formatWalkInMrno(patientEffective, yy, 1)}
          {invoicing && invoicePrefix ? ` · Invoices look like ${formatInvoiceNo(invoicePrefix, fiscalYearOf(today, fyStartMonth).label, 1)}` : ''}
        </>
      }
    >
      <input
        id="clinic-code"
        className={`${inputCls} max-w-[10rem] font-mono uppercase`}
        value={invoicePrefix}
        maxLength={6}
        autoComplete="off"
        placeholder="e.g. BM"
        onChange={(e) => {
          const next = cleanClinicCode(e.target.value);
          onChange({ invoicePrefix: next, walkInMrnoPrefix: linked ? next || null : walkInMrnoPrefix ?? null });
        }}
      />
      {differs && (
        <p className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-[var(--muted)]" data-testid="clinic-code-differs">
          <span>
            Patient IDs use <span className="font-mono font-semibold text-[var(--ink)]">{patientEffective}</span>.
          </span>
          <button
            type="button"
            className="min-h-8 rounded-md px-2 text-xs font-semibold text-[var(--teal)] hover:bg-[var(--paper)]"
            onClick={() => onChange({ invoicePrefix, walkInMrnoPrefix: invoicePrefix })}
          >
            Use {invoicePrefix} for both
          </button>
        </p>
      )}
    </Field>
  );
}
