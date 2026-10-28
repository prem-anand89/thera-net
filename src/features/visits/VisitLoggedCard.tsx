import { Link } from '@tanstack/react-router';
import { formatINR } from '@/domain/money';
import { ErrorNote } from '@/components/ui';
import type { UUID } from '@/domain/types';

/** Deduplicate service names appearing multiple times (e.g. Manual Therapy + Manual Therapy -> Manual Therapy (×2)) */
export function formatServiceCounts(rawLabel: string): string {
  if (!rawLabel.includes('+')) return rawLabel;
  const parts = rawLabel.split('+').map((s) => s.trim()).filter(Boolean);
  const counts = new Map<string, number>();
  for (const p of parts) {
    counts.set(p, (counts.get(p) ?? 0) + 1);
  }
  return Array.from(counts.entries())
    .map(([name, count]) => (count > 1 ? `${name} (×${count})` : name))
    .join(' + ');
}

export interface SavedVisitInfo {
  visitId: UUID;
  patientId: UUID;
  patientName: string;
  patientPhone: string | null;
  serviceLabel: string;
  isPackage: boolean;
  packageSessionNumber?: number;
  packageTotalSessions?: number;
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
  /** Payments on record for this visit (live), so the badge stays true after the bill is edited. */
  receivedPaise?: number;
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
  onEdit?: () => void;
}

function PencilIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 20 20" fill="none" aria-hidden="true" className="shrink-0">
      <path
        d="M13.586 3.586a2 2 0 112.828 2.828l-.793.793-2.828-2.828.793-.793zM11.379 5.793L3 14.172V17h2.828l8.38-8.379-2.83-2.828z"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function NoteIcon() {
  return (
    <svg width="17" height="17" viewBox="0 0 20 20" fill="none" aria-hidden="true" className="shrink-0">
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
    <svg width="17" height="17" viewBox="0 0 20 20" fill="none" aria-hidden="true" className="shrink-0">
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
    <svg width="17" height="17" viewBox="0 0 20 20" fill="none" aria-hidden="true" className="shrink-0">
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
    <svg width="17" height="17" viewBox="0 0 20 20" fill="none" aria-hidden="true" className="shrink-0">
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
    <svg width="17" height="17" viewBox="0 0 20 20" fill="none" aria-hidden="true" className="shrink-0">
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
  receivedPaise = 0,
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
  onEdit,
}: VisitLoggedCardProps) {
  const patientFirstName = justSaved.patientName.trim().split(/\s+/)[0] || 'patient';

  // Primary hero action: what is owed > clinical note > bill
  const primaryHero: 'payment' | 'note' | 'bill' | null =
    paymentDue > 0 ? 'payment' : clinicalDocsEnabled ? 'note' : canBill ? 'bill' : null;

  const tileCount =
    (primaryHero !== 'note' && clinicalDocsEnabled ? 1 : 0) +
    (primaryHero !== 'bill' && canBill ? 1 : 0) +
    (enablePatientComms ? 1 : 0) +
    1;
  const tileColumns =
    tileCount === 4 ? 'grid-cols-2 sm:grid-cols-4' : tileCount === 3 ? 'grid-cols-3' : tileCount === 2 ? 'grid-cols-2' : 'grid-cols-1';

  return (
    <section className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-4 sm:p-5 shadow-2xs space-y-4">
      {/* 1. Celebratory Header */}
      <div className="flex items-center justify-between pb-0.5">
        <div className="flex items-center gap-2.5">
          <div className="flex h-7 w-7 items-center justify-center rounded-full bg-[var(--teal-light)] text-[var(--teal-strong)] text-sm font-bold shadow-2xs">
            ✓
          </div>
          <h2 className="font-display text-lg font-bold text-[var(--ink)] tracking-tight">
            Visit logged
          </h2>
        </div>
        <span className="font-sans text-xs font-medium text-[var(--muted)] tabular-nums">
          {new Date(`${justSaved.visitDate}T00:00:00`).toLocaleDateString('en-IN', {
            day: 'numeric',
            month: 'short',
            year: 'numeric',
          })}
        </span>
      </div>

      {/* 2. Recessed Summary Receipt Card */}
      <div className="rounded-xl border border-[var(--border)] bg-[var(--paper)] p-3.5 sm:p-4 space-y-3 shadow-2xs">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h3 className="font-display text-base font-bold text-[var(--ink)]">
              {justSaved.patientName}
            </h3>
            {justSaved.mrno && (
              <p className="text-xs text-[var(--muted)] tabular-nums mt-0.5">
                Patient ID {justSaved.mrno}
              </p>
            )}
          </div>
          {onEdit && (
            <button
              type="button"
              onClick={onEdit}
              className="inline-flex min-h-11 items-center gap-1 px-3 text-xs font-medium text-[var(--teal-strong)] bg-[var(--surface)] hover:bg-[var(--paper)] border border-[var(--border)] rounded-lg transition shadow-2xs shrink-0 sm:min-h-0 sm:px-2.5 sm:py-1"
              aria-label="Edit visit"
            >
              <PencilIcon />
              <span>Edit</span>
            </button>
          )}
        </div>

        {/* Package / Payment Pill with Session Progress Dots */}
        <div>
          {paymentDue > 0 ? (
            <span className="inline-flex items-center rounded-full border border-[var(--rust)] bg-[var(--surface)] px-2.5 py-1 text-xs font-medium text-[var(--rust)] shadow-2xs">
              Payment due · {formatINR(paymentDue)}
              {receivedPaise > 0 ? ` (paid ${formatINR(receivedPaise)})` : ''}
            </span>
          ) : justSaved.alreadyCollected || receivedPaise > 0 ? (
            <span
              className="inline-flex items-center rounded-full border border-[var(--teal)] bg-[var(--surface)] px-2.5 py-1 text-xs font-medium text-[var(--teal-strong)] shadow-2xs"
              data-testid="collected-line"
            >
              ✓ {formatINR(receivedPaise > 0 ? receivedPaise : justSaved.billPaise)} collected{justSaved.alreadyCollected && justSaved.collectedLabel ? ` · ${justSaved.collectedLabel}` : ''}
            </span>
          ) : justSaved.isPackage && justSaved.packageSessionNumber && justSaved.packageTotalSessions ? (
            <span className="inline-flex items-center gap-2 rounded-full border border-[var(--border)] bg-[var(--surface)] px-2.5 py-1 text-xs font-semibold text-[var(--ink)] shadow-2xs">
              {justSaved.packageTotalSessions <= 8 && (
                <span className="flex items-center gap-1" aria-hidden="true">
                  {Array.from({ length: justSaved.packageTotalSessions }).map((_, i) => (
                    <span
                      key={i}
                      className={`h-1.5 w-1.5 rounded-full ${i < justSaved.packageSessionNumber!
                          ? 'bg-[var(--teal-strong)]'
                          : 'bg-[var(--border)]'
                        }`}
                    />
                  ))}
                </span>
              )}
              <span>
                Package session ({justSaved.packageSessionNumber} of {justSaved.packageTotalSessions}) · ₹0
              </span>
            </span>
          ) : (
            <span className="inline-flex items-center rounded-full border border-[var(--border)] bg-[var(--surface)] px-2.5 py-1 text-xs font-medium text-[var(--muted)] shadow-2xs">
              {justSaved.billPaise === 0
                ? justSaved.isPackage
                  ? 'Package session · ₹0'
                  : 'No charge'
                : 'Billing handled separately'}
            </span>
          )}
        </div>

        {/* Details row: Service (left) & Therapist (right) side-by-side */}
        <div className="border-t border-[var(--border)] pt-3 grid grid-cols-2 gap-3 text-xs">
          <div>
            <span className="text-[10px] font-semibold uppercase tracking-wider text-[var(--muted)] block">
              Service
            </span>
            <span className="font-semibold text-[var(--ink)] mt-0.5 block">
              {formatServiceCounts(justSaved.serviceLabel)}
            </span>
          </div>
          {therapistName && (
            <div>
              <span className="text-[10px] font-semibold uppercase tracking-wider text-[var(--muted)] block">
                Therapist
              </span>
              <span className="font-semibold text-[var(--ink)] mt-0.5 block">{therapistName}</span>
            </div>
          )}
        </div>
      </div>

      {justSaved.paymentError && (
        <div className="mt-2">
          <ErrorNote
            message={`The visit was saved, but the payment was not recorded: ${justSaved.paymentError} Use Take payment to record it.`}
          />
        </div>
      )}

      {/* 3. Actions for {patientFirstName}: Primary Hero CTA + Compact Secondary Tile Grid */}
      <div className="space-y-2.5 pt-1">
        <h4 className="text-[11px] font-semibold uppercase tracking-wider text-[var(--muted)]">
          Actions for {patientFirstName}
        </h4>

        {/* Primary Hero Button */}
        {primaryHero === 'payment' && (
          <button
            type="button"
            className="w-full inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-[var(--teal)] px-4 py-2.5 text-sm font-semibold text-white hover:opacity-95 transition-colors shadow-xs"
            onClick={onTakePayment}
          >
            Take payment · {formatINR(paymentDue)}
          </button>
        )}

        {primaryHero === 'note' && (
          <Link
            to="/patients/$patientId/notes/new"
            params={{ patientId: justSaved.patientId }}
            search={{ visitId: justSaved.visitId }}
            className="w-full inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-[var(--teal)] px-4 py-2.5 text-sm font-semibold text-white hover:opacity-95 transition-colors shadow-xs"
            data-testid="clinical-note-link"
          >
            <NoteIcon />
            <span>Add clinical note</span>
          </Link>
        )}

        {primaryHero === 'bill' && (
          <button
            type="button"
            className="w-full inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-[var(--teal)] px-4 py-2.5 text-sm font-semibold text-white hover:opacity-95 transition-colors shadow-xs"
            onClick={onGiveBill}
          >
            <ReceiptIcon />
            <span>Give bill</span>
          </button>
        )}

        {/* Secondary action tiles: columns follow how many there are, so no tile sits alone on a second row. */}
        <div className={`grid gap-2 ${tileColumns}`}>
          {/* If Note was NOT the primary hero, show it in the grid */}
          {primaryHero !== 'note' && clinicalDocsEnabled && (
            <Link
              to="/patients/$patientId/notes/new"
              params={{ patientId: justSaved.patientId }}
              search={{ visitId: justSaved.visitId }}
              className="py-2.5 px-2 rounded-xl bg-[var(--surface)] hover:bg-[var(--paper)] border border-[var(--border)] text-[var(--ink)] transition flex flex-col items-center justify-center gap-1 shadow-2xs min-h-[4.25rem]"
              data-testid="clinical-note-link"
            >
              <span className="text-[var(--teal-strong)]"><NoteIcon /></span>
              <span className="text-[11px] sm:text-xs font-semibold">Add note</span>
            </Link>
          )}

          {/* Give bill (when not the primary hero) */}
          {primaryHero !== 'bill' && canBill && (
            <button
              type="button"
              className="py-2.5 px-2 rounded-xl bg-[var(--surface)] hover:bg-[var(--paper)] border border-[var(--border)] text-[var(--ink)] transition flex flex-col items-center justify-center gap-1 shadow-2xs min-h-[4.25rem]"
              onClick={onGiveBill}
              aria-label="Give bill"
            >
              <span className="text-[var(--teal-strong)]"><ReceiptIcon /></span>
              <span className="text-[11px] sm:text-xs font-semibold">Give bill</span>
            </button>
          )}

          {/* Request review */}
          {enablePatientComms && (
            <button
              type="button"
              disabled={feedbackRequested}
              onClick={onRequestFeedback}
              aria-label={feedbackRequested ? 'Review requested ✓' : 'Request review'}
              className="py-2.5 px-2 rounded-xl bg-[var(--surface)] hover:bg-[var(--paper)] border border-[var(--border)] text-[var(--ink)] disabled:opacity-50 transition flex flex-col items-center justify-center gap-1 shadow-2xs min-h-[4.25rem]"
            >
              <span className="text-[var(--teal-strong)]"><StarIcon /></span>
              <span className="text-[11px] sm:text-xs font-semibold text-center truncate w-full">
                {feedbackRequested ? 'Requested ✓' : 'Ask review'}
              </span>
            </button>
          )}

          {/* Another visit for patient */}
          <button
            type="button"
            onClick={onNewVisitSamePatient}
            aria-label={`Another visit for ${patientFirstName}`}
            className="py-2.5 px-2 rounded-xl bg-[var(--surface)] hover:bg-[var(--paper)] border border-[var(--border)] text-[var(--ink)] transition flex flex-col items-center justify-center gap-1 shadow-2xs min-h-[4.25rem]"
          >
            <span className="text-[var(--teal-strong)]"><UserPlusIcon /></span>
            <span className="text-[11px] sm:text-xs font-semibold text-center truncate w-full">
              Another visit
            </span>
          </button>
        </div>
      </div>

      {/* 4. Bottom Exit / Next Patient Row (Clean Split Footer) */}
      <div className="pt-3 border-t border-[var(--border)] grid grid-cols-12 gap-2 sm:gap-2.5">
        <button
          type="button"
          onClick={onDone}
          className="col-span-4 min-h-11 py-2.5 px-3 rounded-xl bg-[var(--surface)] hover:bg-[var(--paper)] border border-[var(--border)] text-[var(--muted)] hover:text-[var(--ink)] text-xs sm:text-sm font-semibold transition flex items-center justify-center"
        >
          Done
        </button>
        <button
          type="button"
          aria-label="Log visit for next patient"
          onClick={onNewVisitNextPatient}
          className="col-span-8 min-h-11 py-2.5 px-3 rounded-xl bg-[var(--surface)] hover:bg-[var(--paper)] border border-[var(--teal)] text-[var(--teal-strong)] text-xs sm:text-sm font-semibold transition flex items-center justify-center gap-1.5 shadow-2xs"
        >
          <NextPatientIcon />
          <span className="truncate">Log visit for next patient</span>
        </button>
      </div>
    </section>
  );
}
