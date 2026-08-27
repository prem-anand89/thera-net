import { useState } from 'react';
import type { Invoice, InvoiceClinicalSnapshot } from '@/domain/types';
import { invoiceService } from '@/services';
import { toFriendlyMessage } from '@/lib/errors';
import { btnPrimary, btnSecondary, ErrorNote } from '@/components/ui';
import {
  EMPTY_CLINICAL_FIELDS,
  InvoiceClinicalFieldsForm,
  type ClinicalFields,
} from '@/components/InvoiceClinicalFields';

function fieldsFromSnapshot(snapshot: InvoiceClinicalSnapshot | null | undefined): ClinicalFields {
  if (!snapshot) return EMPTY_CLINICAL_FIELDS;
  return {
    diagnosis: snapshot.diagnosis ?? '',
    referringPhysician: snapshot.referringPhysician ?? '',
    physicianRegistrationNo: snapshot.physicianRegistrationNo ?? '',
    placeOfService: snapshot.placeOfService ?? 'clinic',
    treatmentPerformed: snapshot.treatmentPerformed ?? '',
  };
}

/**
 * Corrects an already-issued invoice's clinical-context snapshot in place —
 * diagnosis, referring physician, place of service, treatment performed.
 * The amount, line items, and invoice number are never touched here (that's
 * AmendInvoiceDialog's job, which issues a whole new invoice number); this
 * is for the case where the bill is right but a detail on it — a
 * misspelled diagnosis, a physician's registration number — needs fixing
 * without reopening the financial record. See migration 20260827000004 for
 * why only this one field can move on an issued invoice.
 */
export function EditInvoiceDetailsDialog({
  clinicId,
  invoice,
  onClose,
}: {
  clinicId: string;
  invoice: Invoice;
  onClose: () => void;
}) {
  const [fields, setFields] = useState<ClinicalFields>(
    fieldsFromSnapshot(invoice.clinicalSnapshot)
  );
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);

  function updateField<K extends keyof ClinicalFields>(key: K, value: ClinicalFields[K]) {
    setFields((f) => ({ ...f, [key]: value }));
  }

  async function save() {
    setBusy(true);
    setError(null);
    try {
      const hasAnyClinicalField =
        fields.diagnosis.trim() ||
        fields.referringPhysician.trim() ||
        fields.physicianRegistrationNo.trim() ||
        fields.treatmentPerformed.trim();
      const clinicalSnapshot: InvoiceClinicalSnapshot | null = hasAnyClinicalField
        ? {
            diagnosis: fields.diagnosis.trim() || null,
            diagnosisIcdCode: invoice.clinicalSnapshot?.diagnosisIcdCode ?? null,
            referringPhysician: fields.referringPhysician.trim() || null,
            physicianRegistrationNo: fields.physicianRegistrationNo.trim() || null,
            placeOfService: fields.placeOfService,
            treatmentPerformed: fields.treatmentPerformed.trim() || null,
            sourceNoteId: invoice.clinicalSnapshot?.sourceNoteId ?? null,
            editedByBiller: true,
          }
        : null;

      await invoiceService.updateClinicalDetails(invoice.id, clinicId, clinicalSnapshot);
      setSaved(true);
    } catch (e) {
      setError(toFriendlyMessage(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-20 flex items-center justify-center bg-[var(--ink)]/40 p-3 sm:p-4">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="edit-invoice-details-title"
        className="max-h-[90vh] w-full max-w-sm space-y-4 overflow-y-auto rounded-2xl bg-[var(--surface)] p-4 sm:p-5"
      >
        {saved ? (
          <>
            <h2 id="edit-invoice-details-title" className="text-sm font-semibold text-[var(--ink)]">
              Details updated
            </h2>
            <p className="text-sm text-[var(--ink)]">
              {invoice.invoiceNo}'s clinical details have been updated. The amount and line items
              are unchanged.
            </p>
            <div className="flex justify-end">
              <button type="button" className={btnPrimary} onClick={onClose}>
                Done
              </button>
            </div>
          </>
        ) : (
          <>
            <h2 id="edit-invoice-details-title" className="text-sm font-semibold text-[var(--ink)]">
              Edit details — {invoice.invoiceNo}
            </h2>
            <p className="text-sm text-[var(--muted)]">
              Corrects diagnosis, referring physician, place of service, and treatment performed on
              this bill. The amount and line items stay exactly as issued — to change those, amend
              the invoice instead.
            </p>

            <InvoiceClinicalFieldsForm fields={fields} onChange={updateField} />

            <ErrorNote message={error} />
            <div className="flex justify-end gap-2">
              <button type="button" className={btnSecondary} onClick={onClose}>
                Cancel
              </button>
              <button
                type="button"
                className={btnPrimary}
                disabled={busy}
                onClick={() => void save()}
              >
                {busy ? 'Saving…' : 'Save details'}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
