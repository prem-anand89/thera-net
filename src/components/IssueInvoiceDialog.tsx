import { useDialogBehavior } from '@/components/dialogBehavior';
import { useEffect, useMemo, useState } from 'react';
import { Link } from '@tanstack/react-router';
import { useLiveQuery } from 'dexie-react-hooks';
import type {
  ConsultationNote,
  Invoice,
  InvoiceClinicalSnapshot,
  InvoiceLineItem,
  PaymentMethod,
  PaymentMode,
} from '@/domain/types';
import type { CoreAssessmentPayload } from '@/domain/coreAssessment';
import { btnPrimary, btnSecondary, inputCls, ErrorNote, Field } from '@/components/ui';
import { notify } from '@/lib/notify';
import { invoiceService, paymentService, repos } from '@/services';
import { toFriendlyMessage } from '@/lib/errors';
import { INVOICE_PAYMENT_MODES } from '@/domain/paymentMethods';
import { usePermissions } from '@/app/usePermissions';
import { ClinicAddressPrompt } from '@/components/ClinicAddressPrompt';
import { pickReferralNote, placeOfServiceFor, placeOfServiceLabel, treatmentsFor } from '@/domain/invoiceClinical';
import { formatDateDMY } from '@/domain/fiscalYear';
import { clinicCareLocations } from '@/domain/careLocations';
import type { InvoicePrintBackTarget } from '@/app/router';
import { formatAmount } from '@/domain/money';
import { toLocalDateStr } from '@/domain/schedule';
import { sessionCountLabel, treatmentPeriodOf } from '@/domain/invoiceLine';
import {
  EMPTY_CLINICAL_FIELDS,
  InvoiceClinicalFieldsForm,
  type ClinicalFields,
} from '@/components/InvoiceClinicalFields';

// UPI first — the most common collection method at an Indian clinic front
// desk, so it's both the default selection below and the top option here
// rather than making staff scroll past Cash on every single bill.
// The invoice's payment mode is also how it was paid; the payment record
// uses the (wider) PaymentMethod vocabulary. Insurance settles by transfer.
const METHOD_FOR_MODE: Record<PaymentMode, PaymentMethod> = {
  UPI: 'upi',
  Cash: 'cash',
  Card: 'card',
  Insurance: 'bank_transfer',
};

export interface IssueInvoiceTarget {
  visitId: string;
  /** Several visits billed on one invoice (Patient Profile's bulk select). `visitId` stays the first of them, used for the clinical pre-fill. */
  visitIds?: string[];
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

/** The referral block of a note `pickReferralNote` chose (it only ever returns a heavy note that has one). */
function noteReferral(note: ConsultationNote | undefined): CoreAssessmentPayload['referral'] | undefined {
  return (note?.assessmentPayload as CoreAssessmentPayload | null)?.referral;
}

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
  const dialogRef = useDialogBehavior<HTMLDivElement>(true, onClose, () => !busy);
  const [paymentMode, setPaymentMode] = useState<PaymentMode>('UPI');
  const [collectedNow, setCollectedNow] = useState(target.alreadyCollected ?? true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [issued, setIssued] = useState<{ invoiceId: string; invoiceNo: string } | null>(null);
  // The invoice itself is already issued (the number is spent) even when its
  // paid/outstanding flag could not be saved; keep it so that can be retried.
  const [issuedInvoice, setIssuedInvoice] = useState<Invoice | null>(null);
  const [statusProblem, setStatusProblem] = useState(false);

  // 'form' -> fill in payment mode/clinical details; 'review' -> a preview
  // of exactly what will be issued, computed via the same line-item build
  // issueForVisits itself uses (invoiceService.previewLineItems), so this
  // never drifts from what actually gets issued. No server write happens
  // until "Confirm & issue" from the review step.
  const [step, setStep] = useState<'form' | 'review'>('form');
  const [preview, setPreview] = useState<{
    lineItems: InvoiceLineItem[];
    totalPaise: number;
  } | null>(null);

  // Clinical pre-fill (1.4) — degrades silently to empty fields whenever
  // the source data isn't cached locally (e.g. an offline device that
  // never synced this patient's notes); it never blocks issuance either
  // way, since every field here stays editable and is entirely optional
  // server-side (`p_clinical_snapshot` defaults to null).
  // Every visit on the invoice: the details printed on it come from all of them, not only the first.
  const visitIds = target.visitIds ?? [target.visitId];
  const visitIdsKey = visitIds.join(',');
  const visits = useLiveQuery(
    async () => {
      const rows = await Promise.all(visitIds.map((id) => repos.visits.get(id)));
      return rows.filter((v): v is NonNullable<typeof v> => v !== undefined);
    },
    [visitIdsKey]
  );
  const patientNotes = useLiveQuery(
    () => repos.consultationNotes.listByPatient(clinicId, target.patientId),
    [clinicId, target.patientId]
  );
  const treatmentCatalog = useLiveQuery(
    () => repos.treatmentCatalog.list(clinicId, true),
    [clinicId]
  );

  // The note written for these visits, else the latest completed one up to the last visit (see pickReferralNote).
  const sourceNote = useMemo(
    () => (visits ? pickReferralNote(patientNotes ?? [], visits) : undefined),
    [visits, patientNotes]
  );

  // Front desk has no notes on the device; the server hands over just the referral block instead.
  const { canViewClinicalNotes, isAdmin } = usePermissions();
  // The address is optional at sign-up but prints on every bill: prompt for it here instead of failing later.
  const clinicRow = useLiveQuery(() => repos.clinics.get(clinicId), [clinicId]);
  const addressMissing = clinicRow !== undefined && !clinicRow.address?.trim();
  const [serverReferral, setServerReferral] = useState<CoreAssessmentPayload['referral'] | null>(null);
  useEffect(() => {
    if (canViewClinicalNotes) return;
    let live = true;
    void invoiceService.referralForVisits(visitIds).then((r) => {
      if (live && r) {
        setServerReferral({
          diagnosis: r.diagnosis ?? '',
          diagnosisIcdCode: r.diagnosisIcdCode ?? undefined,
          referringPhysician: r.referringPhysician ?? '',
          physicianRegistrationNo: r.physicianRegistrationNo ?? '',
        });
      }
    });
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canViewClinicalNotes, visitIdsKey]);

  const referral = canViewClinicalNotes ? noteReferral(sourceNote) : (serverReferral ?? undefined);

  const prefill: ClinicalFields = useMemo(() => {
    if (!visits || visits.length === 0) return EMPTY_CLINICAL_FIELDS;
    const place = placeOfServiceFor(visits);
    return {
      diagnosis: referral?.diagnosis ?? '',
      referringPhysician: referral?.referringPhysician ?? '',
      physicianRegistrationNo: referral?.physicianRegistrationNo ?? '',
      placeOfService: place.place,
      locations: place.locations,
      treatmentPerformed: treatmentsFor(visits, treatmentCatalog ?? []),
    };
  }, [visits, referral, treatmentCatalog]);

  const period = preview ? treatmentPeriodOf(preview.lineItems) : null;
  const [fields, setFields] = useState<ClinicalFields>(EMPTY_CLINICAL_FIELDS);
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

  function clinicalSnapshotFromFields(): InvoiceClinicalSnapshot | null {
    const hasAnyClinicalField =
      fields.diagnosis.trim() ||
      fields.referringPhysician.trim() ||
      fields.physicianRegistrationNo.trim() ||
      fields.treatmentPerformed.trim();
    if (!hasAnyClinicalField) return null;
    return {
      diagnosis: fields.diagnosis.trim() || null,
      // The code belongs to the diagnosis the note gave: once the biller changes that text it no longer applies.
      diagnosisIcdCode: fields.diagnosis.trim() === prefill.diagnosis.trim() ? (referral?.diagnosisIcdCode ?? null) : null,
      referringPhysician: fields.referringPhysician.trim() || null,
      physicianRegistrationNo: fields.physicianRegistrationNo.trim() || null,
      placeOfService: fields.placeOfService,
      ...(fields.placeOfService === 'mixed' && fields.locations ? { locations: fields.locations } : {}),
      treatmentPerformed: fields.treatmentPerformed.trim() || null,
      sourceNoteId: sourceNote?.id ?? null,
      editedByBiller:
        fields.diagnosis !== prefill.diagnosis ||
        fields.referringPhysician !== prefill.referringPhysician ||
        fields.physicianRegistrationNo !== prefill.physicianRegistrationNo ||
        fields.placeOfService !== prefill.placeOfService ||
        fields.treatmentPerformed !== prefill.treatmentPerformed,
    };
  }

  async function goToReview() {
    setBusy(true);
    setError(null);
    try {
      const { lineItems, totalPaise } = await invoiceService.previewLineItems(target.visitIds ?? [target.visitId]);
      setPreview({ lineItems, totalPaise });
      setStep('review');
    } catch (e) {
      setError(toFriendlyMessage(e));
    } finally {
      setBusy(false);
    }
  }

  async function recordPaymentStatus(invoice: Invoice) {
    // Safe direction first: an invoice with no status row reads as PAID, so mark
    // it outstanding before anything that can fail. If recording the cash then
    // fails (or the dialog is closed), the invoice still shows what is owed.
    await paymentService.setStatus(invoice.id, clinicId, 'outstanding');
    if (collectedNow) {
      await paymentService.collectInvoiceNow(
        clinicId,
        invoice,
        METHOD_FOR_MODE[paymentMode],
        toLocalDateStr(new Date())
      );
    }
  }

  async function retryPaymentStatus() {
    if (!issuedInvoice) return;
    setBusy(true);
    try {
      await recordPaymentStatus(issuedInvoice);
      setStatusProblem(false);
    } catch (e) {
      console.error('Could not record payment status', e);
      notify.error(`Still could not record the payment: ${toFriendlyMessage(e)}`);
    } finally {
      setBusy(false);
    }
  }

  async function issue() {
    setBusy(true);
    setError(null);
    try {
      const invoice =
        target.visitIds && target.visitIds.length > 1
          ? await invoiceService.issueForVisits(target.visitIds, paymentMode, clinicalSnapshotFromFields())
          : await invoiceService.issueForVisit(target.visitId, paymentMode, clinicalSnapshotFromFields());
      setIssuedInvoice(invoice);
      try {
        await recordPaymentStatus(invoice);
      } catch (statusError) {
        console.error('Could not record payment status', statusError);
        setStatusProblem(true);
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
        ref={dialogRef} role="dialog"
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
            {statusProblem && (
              <div role="alert" className="space-y-2 rounded-lg border border-[var(--amber)]/50 bg-[var(--amber-light,var(--paper))] p-3 text-sm text-[var(--ink)]">
                <p>
                  The invoice was issued, but the payment could not be recorded, so it may still show as
                  unpaid. Tap Retry to record it.
                </p>
                <button type="button" className={btnSecondary} disabled={busy} onClick={() => void retryPaymentStatus()}>
                  {busy ? 'Retrying…' : 'Retry'}
                </button>
              </div>
            )}
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
                {statusProblem ? 'Close anyway' : 'Done'}
              </button>
            </div>
          </>
        ) : step === 'review' ? (
          <>
            <h2 id="issue-invoice-title" className="text-sm font-semibold text-[var(--ink)]">
              Review before issuing
            </h2>
            <p className="text-sm text-[var(--muted)]">{target.patientLabel}</p>

            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-[var(--border)] text-left text-xs uppercase tracking-wide text-[var(--muted)]">
                  <th className="py-1.5">Service</th>
                  <th className="py-1.5">Sessions</th>
                  <th className="py-1.5 text-right">Amount</th>
                </tr>
              </thead>
              <tbody>
                {(preview?.lineItems ?? []).map((li, i) => (
                  <tr key={i} className="border-b border-[var(--border)] align-top">
                    <td className="py-1.5 font-medium text-[var(--ink)]">{li.serviceName}</td>
                    <td className="py-1.5 text-[var(--muted)]">{sessionCountLabel(li)}</td>
                    <td className="font-num py-1.5 text-right">{formatAmount(li.totalPaise)}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr>
                  <td colSpan={2} className="py-2 text-right font-semibold text-[var(--ink)]">
                    Total
                  </td>
                  <td className="font-num py-2 text-right text-base font-bold text-[var(--ink)]">
                    {formatAmount(preview?.totalPaise ?? 0)}
                  </td>
                </tr>
              </tfoot>
            </table>

            <div className="space-y-1 rounded-md border border-[var(--border)] bg-[var(--paper)] p-3 text-sm text-[var(--ink)]">
              <p>
                Payment mode: <span className="font-medium">{paymentMode}</span> —{' '}
                {collectedNow ? 'collected now' : 'not collected, pay later'}
              </p>
              <p className="text-xs text-[var(--muted)]">
                {collectedNow
                  ? `Will record ${formatAmount(preview?.totalPaise ?? 0)} as received today by ${METHOD_FOR_MODE[paymentMode].replace('_', ' ')}, less anything already collected on these visits.`
                  : 'No payment will be recorded; the bill is issued as unpaid.'}
              </p>
              <div className="mt-1.5 space-y-0.5 border-t border-[var(--border)] pt-1.5 text-xs text-[var(--muted)]">
                {period && (
                  <p>
                    Treatment period: {formatDateDMY(period.from)} – {formatDateDMY(period.to)}
                  </p>
                )}
                {fields.diagnosis && <p>Diagnosis: {fields.diagnosis}</p>}
                {fields.referringPhysician && (
                  <p>
                    Referring physician: {fields.referringPhysician}
                    {fields.physicianRegistrationNo && ` (Reg. No. ${fields.physicianRegistrationNo})`}
                  </p>
                )}
                <p>
                  Place of service: {placeOfServiceLabel({ placeOfService: fields.placeOfService, locations: fields.locations })}
                </p>
                {fields.treatmentPerformed && <p>Treatment performed: {fields.treatmentPerformed}</p>}
              </div>
            </div>

            <ErrorNote message={error} />
            <p className="text-xs text-[var(--muted)]">
              The invoice number is issued by the server and the bill becomes immutable — this needs
              a connection and cannot be undone.
            </p>
            <div className="flex justify-end gap-2">
              <button
                type="button"
                className={btnSecondary}
                disabled={busy}
                onClick={() => setStep('form')}
              >
                ← Back to edit
              </button>
              <button
                type="button"
                className={btnPrimary}
                disabled={busy}
                onClick={() => void issue()}
              >
                {busy ? 'Issuing…' : 'Confirm & issue'}
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
            {addressMissing && <ClinicAddressPrompt clinicId={clinicId} canEdit={isAdmin} />}
            <Field label="Payment mode">
              <select
                className={inputCls}
                value={paymentMode}
                onChange={(e) => setPaymentMode(e.target.value as PaymentMode)}
              >
                {INVOICE_PAYMENT_MODES.map((m) => (
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
              <InvoiceClinicalFieldsForm
                fields={fields}
                onChange={updateField}
                placeOptions={clinicCareLocations(clinicRow)}
                hints={{
                  diagnosis: referral?.diagnosis
                    ? "From patient's note — edit if needed"
                    : undefined,
                  referringPhysician: referral?.referringPhysician
                    ? "From patient's note — edit if needed"
                    : undefined,
                  treatmentPerformed: prefill.treatmentPerformed
                    ? visitIds.length > 1
                      ? "From these visits' records — edit if needed"
                      : "From this visit's record — edit if needed"
                    : undefined,
                }}
              />
            </div>

            <ErrorNote message={error} />
            <div className="flex justify-end gap-2">
              <button type="button" className={btnSecondary} onClick={onClose}>
                Cancel
              </button>
              <button
                type="button"
                className={btnPrimary}
                // An admin can fix a missing address on the spot, so it holds up the bill; anyone else cannot, so it
                // does not (they see who to ask).
                disabled={busy || (addressMissing && isAdmin)}
                onClick={() => void goToReview()}
              >
                {busy ? 'Loading…' : 'Review invoice'}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
