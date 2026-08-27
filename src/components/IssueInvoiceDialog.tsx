import { useEffect, useMemo, useState } from 'react';
import { Link } from '@tanstack/react-router';
import { useLiveQuery } from 'dexie-react-hooks';
import type { ConsultationNote, InvoiceClinicalSnapshot, PaymentMode } from '@/domain/types';
import type { CoreAssessmentPayload } from '@/domain/coreAssessment';
import { btnPrimary, btnSecondary, inputCls, ErrorNote, Field } from '@/components/ui';
import { invoiceService, paymentService, repos } from '@/services';
import { toFriendlyMessage } from '@/lib/errors';
import { treatmentsDisplayText } from '@/components/VisitCard';
import type { InvoicePrintBackTarget } from '@/app/router';

const PAYMENT_MODES: PaymentMode[] = ['Cash', 'Card', 'UPI', 'Insurance'];

export interface IssueInvoiceTarget {
  visitId: string;
  /** Added for the clinical-snapshot pre-fill (Billing & Notes Rebuild
   *  Phase 1, 1.4) — both call sites already have it on the row. */
  patientId: string;
  patientLabel: string;
  serviceLabel: string;
  isPackage: boolean;
  /** Visit already has a direct payment covering the bill (paymentState
   *  'collected_no_receipt') — pre-selects "Collected now" so staff aren't
   *  asked a question that's already been answered. Issuing the invoice
   *  itself never touches the existing direct payment either way. */
  alreadyCollected?: boolean;
}

/** Extracts the referral block from a note's payload, but only for a heavy
 *  (initial/followup) note — a light session note (Phase 2) has no
 *  `referral` field at all. */
function noteReferral(
  note: ConsultationNote | undefined
): CoreAssessmentPayload['referral'] | undefined {
  if (!note || note.noteMode === 'session') return undefined;
  const payload = note.assessmentPayload as CoreAssessmentPayload | null;
  return payload?.referral;
}

interface ClinicalFields {
  diagnosis: string;
  referringPhysician: string;
  physicianRegistrationNo: string;
  placeOfService: 'clinic' | 'home';
  treatmentPerformed: string;
}

const EMPTY_FIELDS: ClinicalFields = {
  diagnosis: '',
  referringPhysician: '',
  physicianRegistrationNo: '',
  placeOfService: 'clinic',
  treatmentPerformed: '',
};

export function IssueInvoiceDialog({
  clinicId,
  target,
  onClose,
  returnTo,
}: {
  clinicId: string;
  target: IssueInvoiceTarget;
  onClose: () => void;
  /** Where the print page's own "← Back" should return to — this dialog
   *  opens from both Ledger and Workspace. */
  returnTo: InvoicePrintBackTarget;
}) {
  const [paymentMode, setPaymentMode] = useState<PaymentMode>('Cash');
  const [collectedNow, setCollectedNow] = useState(target.alreadyCollected ?? true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [issued, setIssued] = useState<{ invoiceId: string; invoiceNo: string } | null>(null);

  // Clinical pre-fill (1.4) — degrades silently to empty fields whenever
  // the source data isn't cached locally (e.g. an offline device that
  // never synced this patient's notes); it never blocks issuance either
  // way, since every field here stays editable and is entirely optional
  // server-side (`p_clinical_snapshot` defaults to null).
  const visit = useLiveQuery(() => repos.visits.get(target.visitId), [target.visitId]);
  const visitNote = useLiveQuery(
    () => repos.consultationNotes.getByVisitId(target.visitId),
    [target.visitId]
  );
  const patientNotes = useLiveQuery(
    () => repos.consultationNotes.listByPatient(clinicId, target.patientId),
    [clinicId, target.patientId]
  );
  const treatmentCatalog = useLiveQuery(
    () => repos.treatmentCatalog.list(clinicId, true),
    [clinicId]
  );

  const sourceNote = useMemo((): ConsultationNote | undefined => {
    if (noteReferral(visitNote)) return visitNote;
    // Fall back to the most recently updated completed heavy note in the
    // patient's history — the visit's own note may be a light session note
    // (Phase 2), or simply not carry a referral block yet.
    return (patientNotes ?? [])
      .filter(
        (n) => n.status === 'completed' && (n.noteMode === 'initial' || n.noteMode === 'followup')
      )
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
      .find((n) => noteReferral(n));
  }, [visitNote, patientNotes]);

  const referral = noteReferral(sourceNote);

  const prefill: ClinicalFields = useMemo(() => {
    if (!visit) return EMPTY_FIELDS;
    const treatmentNames = (visit.treatmentIds ?? [])
      .map((id) => treatmentCatalog?.find((t) => t.id === id)?.name)
      .filter((n): n is string => !!n);
    return {
      diagnosis: referral?.diagnosis ?? '',
      referringPhysician: referral?.referringPhysician ?? '',
      physicianRegistrationNo: referral?.physicianRegistrationNo ?? '',
      placeOfService: visit.location ?? 'clinic',
      treatmentPerformed: treatmentsDisplayText(treatmentNames, visit.treatmentNotes),
    };
  }, [visit, referral, treatmentCatalog]);

  const [fields, setFields] = useState<ClinicalFields>(EMPTY_FIELDS);
  const [touched, setTouched] = useState(false);

  // Keep syncing from the (async, live-queried) pre-fill until the biller
  // actually edits a field — not just once `visit` resolves. `visit`,
  // `visitNote`/`patientNotes`, and `treatmentCatalog` are four independent
  // live queries with no ordering guarantee between them; syncing only on
  // `visit`'s own resolution risked locking in a blank prefill if the
  // others were still loading at that moment. Re-running on every `prefill`
  // change instead means whichever query resolves last still lands
  // correctly, and `touched` is what stops a later resolution from
  // clobbering something the biller already typed.
  useEffect(() => {
    if (!touched) setFields(prefill);
  }, [prefill, touched]);

  function updateField<K extends keyof ClinicalFields>(key: K, value: ClinicalFields[K]) {
    setTouched(true);
    setFields((f) => ({ ...f, [key]: value }));
  }

  async function issue() {
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
            diagnosisIcdCode: referral?.diagnosisIcdCode ?? null,
            referringPhysician: fields.referringPhysician.trim() || null,
            physicianRegistrationNo: fields.physicianRegistrationNo.trim() || null,
            placeOfService: fields.placeOfService,
            treatmentPerformed: fields.treatmentPerformed.trim() || null,
            sourceNoteId: sourceNote?.id ?? null,
            editedByBiller:
              fields.diagnosis !== prefill.diagnosis ||
              fields.referringPhysician !== prefill.referringPhysician ||
              fields.physicianRegistrationNo !== prefill.physicianRegistrationNo ||
              fields.placeOfService !== prefill.placeOfService ||
              fields.treatmentPerformed !== prefill.treatmentPerformed,
          }
        : null;

      const invoice = await invoiceService.issueForVisit(
        target.visitId,
        paymentMode,
        clinicalSnapshot
      );
      try {
        await paymentService.setStatus(invoice.id, clinicId, collectedNow ? 'paid' : 'outstanding');
      } catch (statusError) {
        console.error('Could not record payment status', statusError);
      }
      setIssued({ invoiceId: invoice.id, invoiceNo: invoice.invoiceNo });
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
        aria-labelledby="issue-invoice-title"
        className="max-h-[90vh] w-full max-w-sm space-y-4 overflow-y-auto rounded-2xl bg-[var(--surface)] p-4 sm:p-5"
      >
        {issued ? (
          <>
            <h2 id="issue-invoice-title" className="text-sm font-semibold text-[var(--ink)]">
              Invoice issued
            </h2>
            <p className="text-sm text-[var(--ink)]">
              Invoice {issued.invoiceNo} issued for {target.patientLabel}.
            </p>
            <div className="flex justify-end gap-2">
              <Link
                to="/invoices/$invoiceId/print"
                params={{ invoiceId: issued.invoiceId }}
                search={{ from: returnTo }}
                className={btnSecondary}
              >
                Print
              </Link>
              <button type="button" className={btnPrimary} onClick={onClose}>
                Done
              </button>
            </div>
          </>
        ) : (
          <>
            <h2 id="issue-invoice-title" className="text-sm font-semibold text-[var(--ink)]">
              Issue invoice
            </h2>
            <p className="text-sm text-[var(--muted)]">
              {target.patientLabel} — {target.serviceLabel}
              {target.isPackage && ', all sessions of this package'}
            </p>
            <Field label="Payment mode">
              <select
                className={inputCls}
                value={paymentMode}
                onChange={(e) => setPaymentMode(e.target.value as PaymentMode)}
              >
                {PAYMENT_MODES.map((m) => (
                  <option key={m}>{m}</option>
                ))}
              </select>
            </Field>
            {target.alreadyCollected && (
              <p className="text-xs text-[var(--muted)]">
                Already collected for this visit — defaulting to "Collected now" below.
              </p>
            )}
            <div className="flex gap-4 text-sm">
              <label className="flex items-center gap-2">
                <input type="radio" checked={collectedNow} onChange={() => setCollectedNow(true)} />
                Collected now
              </label>
              <label className="flex items-center gap-2">
                <input
                  type="radio"
                  checked={!collectedNow}
                  onChange={() => setCollectedNow(false)}
                />
                Not collected — pay later
              </label>
            </div>

            <div className="space-y-3 border-t border-[var(--border)] pt-3">
              <p className="text-xs font-medium uppercase tracking-wide text-[var(--muted)]">
                Clinical details (for TPA/insurance bills)
              </p>
              <Field
                label="Diagnosis"
                hint={referral?.diagnosis ? "From patient's note — edit if needed" : undefined}
              >
                <input
                  className={inputCls}
                  value={fields.diagnosis}
                  onChange={(e) => updateField('diagnosis', e.target.value)}
                  placeholder="e.g. Lumbar disc prolapse L4-L5"
                />
              </Field>
              <Field
                label="Referring physician"
                hint={
                  referral?.referringPhysician ? "From patient's note — edit if needed" : undefined
                }
              >
                <div className="flex gap-2">
                  <input
                    className={inputCls}
                    value={fields.referringPhysician}
                    onChange={(e) => updateField('referringPhysician', e.target.value)}
                    placeholder="Physician name"
                  />
                  <input
                    className={inputCls}
                    value={fields.physicianRegistrationNo}
                    onChange={(e) => updateField('physicianRegistrationNo', e.target.value)}
                    placeholder="Reg. No."
                  />
                </div>
              </Field>
              <Field label="Place of service">
                <select
                  className={inputCls}
                  value={fields.placeOfService}
                  onChange={(e) =>
                    updateField('placeOfService', e.target.value as 'clinic' | 'home')
                  }
                >
                  <option value="clinic">Clinic (OP visit)</option>
                  <option value="home">Home (domiciliary)</option>
                </select>
              </Field>
              <Field
                label="Treatment performed"
                hint={
                  prefill.treatmentPerformed
                    ? "From this visit's record — edit if needed"
                    : undefined
                }
              >
                <input
                  className={inputCls}
                  value={fields.treatmentPerformed}
                  onChange={(e) => updateField('treatmentPerformed', e.target.value)}
                  placeholder="e.g. Manual therapy, therapeutic exercise"
                />
              </Field>
            </div>

            <ErrorNote message={error} />
            <p className="text-xs text-[var(--muted)]">
              The invoice number is issued by the server and the bill becomes immutable — this needs
              a connection and cannot be undone.
            </p>
            <div className="flex justify-end gap-2">
              <button type="button" className={btnSecondary} onClick={onClose}>
                Cancel
              </button>
              <button
                type="button"
                className={btnPrimary}
                disabled={busy}
                onClick={() => void issue()}
              >
                {busy ? 'Issuing…' : 'Issue invoice'}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
