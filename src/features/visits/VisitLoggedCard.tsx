import { Link } from '@tanstack/react-router';
import { formatDateDMY } from '@/domain/fiscalYear';
import { formatINR } from '@/domain/money';
import { ErrorNote, SectionCard } from '@/components/ui';
import type { UUID } from '@/domain/types';

export interface SavedVisitInfo {
  visitId: UUID;
  patientId: UUID;
  patientName: string;
  patientPhone: string | null;
  serviceLabel: string;
  isPackage: boolean;
  alreadyCollected: boolean;
  byPartner?: boolean;
  collectedLabel?: string;
  therapistId: UUID;
  billPaise: number;
  visitDate: string;
  mrno: string;
  paymentError?: string;
}

export interface VisitLoggedCardProps {
  justSaved: SavedVisitInfo;
  therapistName?: string;
  paymentDue: number;
  canBill: boolean;
  clinicalDocsEnabled?: boolean;
  enablePatientComms?: boolean;
  feedbackRequested: boolean;
  onRequestFeedback: () => void;
  onTakePayment: () => void;
  onGiveBill: () => void;
  onNewVisitSamePatient: () => void;
  onNewVisitNextPatient: () => void;
  onDone: () => void;
}

function NoteIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 20 20" fill="none" aria-hidden="true" className="shrink-0">
      <path
        d="M4.5 3.5h11a1 1 0 011 1v11a1 1 0 01-1 1h-11a1 1 0 01-1-1v-11a1 1 0 011-1z"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M7 7.5h6M7 10.5h6M7 13.5h3.5"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinecap="round"
      />
    </svg>
  );
}

function ReceiptIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 20 20" fill="none" aria-hidden="true" className="shrink-0">
      <path
        d="M5 3.5h10a1 1 0 011 1v12l-2.5-1.5L11 16.5l-2.5-1.5L6 16.5 3.5 15v-10.5a1 1 0 011-1z"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path d="M7 7.5h6M7 10.5h4" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
    </svg>
  );
}

function StarIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 20 20" fill="none" aria-hidden="true" className="shrink-0">
      <path
        d="M10 3.5l2.1 4.3 4.7.7-3.4 3.3.8 4.7-4.2-2.2-4.2 2.2.8-4.7-3.4-3.3 4.7-.7L10 3.5z"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function UserPlusIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 20 20" fill="none" aria-hidden="true" className="shrink-0">
      <path
        d="M10 10a3.5 3.5 0 100-7 3.5 3.5 0 000 7zM4 16.5c0-2.5 2.7-4.5 6-4.5m4 2.5v4m-2-2h4"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function NextPatientIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 20 20" fill="none" aria-hidden="true" className="shrink-0">
      <path
        d="M8 10a3.5 3.5 0 100-7 3.5 3.5 0 000 7zM2.5 16.5c0-2.5 2.5-4.5 5.5-4.5M14 6v6m-3-3h6"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function VisitLoggedCard({
  justSaved,
  therapistName,
  paymentDue,
  canBill,
  clinicalDocsEnabled,
  enablePatientComms,
  feedbackRequested,
  onRequestFeedback,
  onTakePayment,
  onGiveBill,
  onNewVisitSamePatient,
  onNewVisitNextPatient,
  onDone,
}: VisitLoggedCardProps) {
  const patientFirstName = justSaved.patientName.trim().split(/\s+/)[0] || 'patient';

  return (
    <SectionCard title="Visit logged">
      {/* Summary / Receipt Card */}
      <div className="rounded-xl border border-[var(--border)] bg-[var(--paper)] p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h3 className="font-display text-base font-semibold text-[var(--ink)]">
              {justSaved.patientName}
            </h3>
            {justSaved.mrno && (
              <p className="text-xs text-[var(--muted)]">MRN #{justSaved.mrno}</p>
            )}
          </div>
          {paymentDue > 0 ? (
            <span className="inline-flex items-center rounded-full border border-[var(--rust)] bg-[var(--surface)] px-2.5 py-1 text-xs font-medium text-[var(--rust)]">
              Payment due · {formatINR(paymentDue)}
            </span>
          ) : justSaved.alreadyCollected ? (
            <span
              className="inline-flex items-center rounded-full border border-[var(--teal)] bg-[var(--surface)] px-2.5 py-1 text-xs font-medium text-[var(--teal)]"
              data-testid="collected-line"
            >
              ✓ {formatINR(justSaved.billPaise)} collected{justSaved.collectedLabel ? ` · ${justSaved.collectedLabel}` : ''}
            </span>
          ) : (
            <span className="inline-flex items-center rounded-full border border-[var(--border)] bg-[var(--surface)] px-2.5 py-1 text-xs font-medium text-[var(--muted)]">
              {justSaved.isPackage ? 'Package session · ₹0' : 'Settled'}
            </span>
          )}
        </div>

        <div className="mt-3 grid grid-cols-2 gap-3 border-t border-[var(--border)] pt-3 text-xs sm:grid-cols-3">
          <div>
            <span className="block text-[var(--muted)]">Service</span>
            <span className="font-medium text-[var(--ink)]">{justSaved.serviceLabel}</span>
          </div>
          <div>
            <span className="block text-[var(--muted)]">Date</span>
            <span className="font-medium text-[var(--ink)]">{formatDateDMY(justSaved.visitDate)}</span>
          </div>
          {therapistName && (
            <div>
              <span className="block text-[var(--muted)]">Therapist</span>
              <span className="font-medium text-[var(--ink)]">{therapistName}</span>
            </div>
          )}
        </div>
      </div>

      {justSaved.paymentError && (
        <div className="mt-3">
          <ErrorNote
            message={`The visit was saved, but the payment was not recorded: ${justSaved.paymentError} Use Take payment to record it.`}
          />
        </div>
      )}

      {paymentDue > 0 && (
        <div className="mt-3">
          <button
            type="button"
            className="w-full inline-flex min-h-11 items-center justify-center gap-2 rounded-lg bg-[var(--teal)] px-4 py-2 text-sm font-medium text-white hover:opacity-95 transition-colors"
            onClick={onTakePayment}
          >
            Take payment · {formatINR(paymentDue)}
          </button>
        </div>
      )}

      {/* Patient-specific actions */}
      <div className="mt-5 space-y-2.5">
        <h4 className="text-xs font-semibold uppercase tracking-wider text-[var(--muted)]">
          Actions for {patientFirstName}
        </h4>
        <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
          {clinicalDocsEnabled && (
            <Link
              to="/patients/$patientId/notes/new"
              params={{ patientId: justSaved.patientId }}
              search={{ visitId: justSaved.visitId }}
              className="inline-flex min-h-11 items-center justify-center gap-2 rounded-lg bg-[var(--teal)] px-4 py-2 text-sm font-medium text-white hover:opacity-95 transition-colors"
            >
              <NoteIcon />
              <span>Add clinical note</span>
            </Link>
          )}

          {canBill && (
            <button
              type="button"
              className="inline-flex min-h-11 items-center justify-center gap-2 rounded-lg border border-[var(--border)] bg-[var(--surface)] px-4 py-2 text-sm font-medium text-[var(--ink)] hover:bg-[var(--paper)] transition-colors"
              onClick={onGiveBill}
            >
              <ReceiptIcon />
              <span>Give bill</span>
            </button>
          )}

          {enablePatientComms && (
            <button
              type="button"
              className="inline-flex min-h-11 items-center justify-center gap-2 rounded-lg border border-[var(--border)] bg-[var(--surface)] px-4 py-2 text-sm font-medium text-[var(--ink)] hover:bg-[var(--paper)] disabled:opacity-50 transition-colors"
              disabled={feedbackRequested}
              onClick={onRequestFeedback}
              title="Ask this patient for feedback"
            >
              <StarIcon />
              <span>{feedbackRequested ? 'Review requested ✓' : 'Request review'}</span>
            </button>
          )}

          <button
            type="button"
            className="inline-flex min-h-11 items-center justify-center gap-2 rounded-lg border border-[var(--border)] bg-[var(--surface)] px-4 py-2 text-sm font-medium text-[var(--ink)] hover:bg-[var(--paper)] transition-colors"
            onClick={onNewVisitSamePatient}
          >
            <UserPlusIcon />
            <span>Another visit for {patientFirstName}</span>
          </button>
        </div>
      </div>

      {/* Next steps / Exit area */}
      <div className="mt-6 space-y-2.5 border-t border-[var(--border)] pt-5">
        <button
          type="button"
          className="w-full inline-flex min-h-11 items-center justify-center gap-2 rounded-lg border border-[var(--teal)] bg-[var(--surface)] px-4 py-2 text-sm font-medium text-[var(--teal)] hover:bg-[var(--paper)] transition-colors"
          onClick={onNewVisitNextPatient}
        >
          <NextPatientIcon />
          <span>Log visit for next patient</span>
        </button>

        <button
          type="button"
          className="w-full inline-flex min-h-11 items-center justify-center rounded-lg border border-[var(--border)] bg-[var(--surface)] px-4 py-2 text-sm font-medium text-[var(--muted)] hover:text-[var(--ink)] hover:bg-[var(--paper)] transition-colors"
          onClick={onDone}
        >
          Done
        </button>
      </div>
    </SectionCard>
  );
}
