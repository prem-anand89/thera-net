import { useState } from 'react';
import { Link } from '@tanstack/react-router';
import type { UUID } from '@/domain/types';
import type { Paise } from '@/domain/money';
import { formatINR } from '@/domain/money';
import { formatDateDMY } from '@/domain/fiscalYear';
import { Pill, PackageThread } from '@/components/ui';

export type VisitCardPaymentState = 'paid' | 'outstanding' | 'uninvoiced' | 'zero_session';

const PAYMENT_CHIP: Record<VisitCardPaymentState, { tone: 'green' | 'amber' | 'slate'; label: (bill: string) => string }> = {
  paid: { tone: 'green', label: () => 'Paid' },
  outstanding: { tone: 'amber', label: (bill) => `Outstanding ${bill}` },
  uninvoiced: { tone: 'amber', label: (bill) => `Collect ${bill}` },
  zero_session: { tone: 'slate', label: () => '₹0 session' },
};

/**
 * One row's worth of data for `SharedVisitCard`, normalized away from
 * whichever screen-specific shape (TodayVisitRow/RecentVisitRow/raw Visit +
 * lookup maps) the caller actually has. Each screen maps its own rows into
 * this rather than the card importing dashboardService's types directly.
 */
export interface VisitCardData {
  visitId: UUID;
  visitDate: string;
  patientId: UUID;
  patientName: string;
  mrno: string;
  condition: string | null;
  serviceName: string;
  sessionIndex: number | null;
  packageTotal: number | null;
  therapistName: string;
  treatmentNotes: string | null;
  billPaise: Paise;
  paymentState: VisitCardPaymentState;
  invoiceId: UUID | null;
  /** Set when someone other than the original author last touched this row. */
  editedBy?: string | null;
  syncError?: string | null;
  canRepeat: boolean;
  canSplit?: boolean;
  hasSplit?: boolean;
  canDelete: boolean;
}

export function SharedVisitCard({
  data,
  showDate,
  showPatient,
  onInvoice,
  onEdit,
  onSplit,
  onDelete,
}: {
  data: VisitCardData;
  showDate: boolean;
  showPatient: boolean;
  onInvoice: () => void;
  onEdit: () => void;
  onSplit?: () => void;
  onDelete: () => void;
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const chip = PAYMENT_CHIP[data.paymentState];

  const initials = showPatient
    ? data.patientName
        .split(/\s+/)
        .slice(0, 2)
        .map((w) => w[0]?.toUpperCase() ?? '')
        .join('')
    : '';

  const secondaryParts = [
    data.condition,
    `${data.serviceName}${data.sessionIndex && data.packageTotal ? ` (${data.sessionIndex}/${data.packageTotal})` : ''}`,
    data.therapistName,
    data.treatmentNotes,
  ].filter(Boolean);

  const hasMenu = true; // Edit is always available, plus Repeat/Split/Delete as conditional

  return (
    <div className="flex items-start gap-3 py-3">
      {showDate && (
        <div className="w-14 shrink-0 pt-0.5 text-xs text-[var(--muted)]">
          {formatDateDMY(data.visitDate)}
          {data.editedBy && (
            <span className="ml-1" title={`Edited by ${data.editedBy}`}>
              ✎
            </span>
          )}
          {data.syncError && (
            <span className="ml-1 text-[var(--rust)]" title={`Sync issue: ${data.syncError}`}>
              ⚠
            </span>
          )}
        </div>
      )}

      {showPatient && (
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[var(--teal-light)] font-display text-xs font-semibold text-[var(--teal)]">
          {initials || '?'}
        </div>
      )}

      <div className="min-w-0 flex-1">
        {showPatient && (
          <Link to="/patients/$patientId" params={{ patientId: data.patientId }} className="font-display text-sm font-medium text-[var(--ink)] hover:underline">
            {data.patientName} <span className="text-xs font-normal text-[var(--muted)]">{data.mrno}</span>
          </Link>
        )}
        <div className="text-xs text-[var(--muted)]" style={{ whiteSpace: 'normal' }}>
          {secondaryParts.map((part, i) => (
            <span key={i}>
              {i > 0 && ' · '}
              {part}
              {i === 1 && data.sessionIndex && data.packageTotal && (
                <span className="ml-1 align-middle">
                  <PackageThread sessionIndex={data.sessionIndex} packageTotal={data.packageTotal} />
                </span>
              )}
            </span>
          ))}
        </div>
      </div>

      <div className="flex shrink-0 flex-col items-end gap-1">
        <div className="font-num text-sm text-[var(--ink)]">{formatINR(data.billPaise)}</div>
        {data.paymentState === 'uninvoiced' ? (
          <button
            type="button"
            className="rounded-full bg-[var(--rust-light)] px-2.5 py-1 text-xs font-medium text-[var(--rust)] hover:opacity-80"
            onClick={onInvoice}
          >
            {chip.label(formatINR(data.billPaise))}
          </button>
        ) : (
          <Pill tone={chip.tone}>{chip.label(formatINR(data.billPaise))}</Pill>
        )}
        {data.invoiceId ? (
          <Link to="/invoices/$invoiceId/print" params={{ invoiceId: data.invoiceId }} className="text-xs text-[var(--teal)] hover:underline">
            Invoiced
          </Link>
        ) : data.billPaise > 0 ? (
          <span className="text-xs text-[var(--muted)]">Not invoiced</span>
        ) : null}
      </div>

      {hasMenu && (
        <div className="relative shrink-0">
          <button
            type="button"
            aria-label="Row actions"
            className="rounded-md p-1 text-[var(--muted)] hover:bg-[var(--paper)]"
            onClick={() => setMenuOpen((o) => !o)}
          >
            ⋮
          </button>
          {menuOpen && (
            <>
              <div className="fixed inset-0 z-10" onClick={() => setMenuOpen(false)} />
              <div className="absolute right-0 top-full z-20 mt-1 min-w-32 rounded-md border border-[var(--border)] bg-[var(--surface)] py-1 shadow-lg">
                {data.canRepeat && (
                  <Link
                    to="/visits/new"
                    search={{ repeatVisitId: data.visitId }}
                    className="block w-full px-3 py-1.5 text-left text-xs text-[var(--ink)] hover:bg-[var(--paper)]"
                    onClick={() => setMenuOpen(false)}
                  >
                    Repeat
                  </Link>
                )}
                <button
                  type="button"
                  className="block w-full px-3 py-1.5 text-left text-xs text-[var(--ink)] hover:bg-[var(--paper)]"
                  onClick={() => {
                    setMenuOpen(false);
                    onEdit();
                  }}
                >
                  Edit
                </button>
                {data.canSplit && onSplit && (
                  <button
                    type="button"
                    className="block w-full px-3 py-1.5 text-left text-xs text-[var(--ink)] hover:bg-[var(--paper)]"
                    onClick={() => {
                      setMenuOpen(false);
                      onSplit();
                    }}
                  >
                    {data.hasSplit ? 'Edit split' : 'Split'}
                  </button>
                )}
                {data.canDelete && (
                  <button
                    type="button"
                    className="block w-full px-3 py-1.5 text-left text-xs text-[var(--rust)] hover:bg-[var(--rust-light)]"
                    onClick={() => {
                      setMenuOpen(false);
                      onDelete();
                    }}
                  >
                    Delete
                  </button>
                )}
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}
