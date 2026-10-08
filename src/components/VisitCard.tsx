import type { ReactNode } from 'react';
import { Pill, PackageThread, TherapistPill } from '@/components/ui';
import { formatINR, type Paise } from '@/domain/money';
import { formatDateDM } from '@/domain/fiscalYear';
import { toLocalDateStr } from '@/domain/schedule';
import { isPackageContinuation, paymentActions, paymentBadge } from '@/domain/paymentState';
import { useVisitColumnPrefs } from '@/app/useVisitColumnPrefs';
import type { PatientProfileBackTarget } from '@/app/router';

import type { VisitCardData, VisitSelectionProps } from './visit/types';
import { treatmentsDisplayText, patientIdentityLine } from './visit/formatters';
import { PatientNameBlock } from './visit/VisitPatientBlock';
import { SharedSplitLine } from './visit/VisitSharedSplit';
import { PAYMENT_CHIP } from './visit/VisitPaymentDisplay';
import { VisitNoteLink, VisitFeedbackLink } from './visit/VisitNotesFeedback';
import { RowActionsMenu } from './visit/VisitRowActions';
import { VisitTable } from './visit/VisitTable';

// Re-export extracted types and components that other files import from here
export type { VisitCardData, VisitSelectionProps };
export { PAYMENT_CHIP, treatmentsDisplayText, patientIdentityLine, VisitNoteLink, VisitFeedbackLink };

/** Label + value rows for mobile cards — same field order as the optional table columns. */
export function CardDetailRow({
  label,
  children,
  clamp,
}: {
  label: string;
  children: ReactNode;
  clamp?: boolean;
}) {
  return (
    <div className="flex gap-2 text-xs leading-snug">
      <span className="w-[4.75rem] shrink-0 font-medium text-[var(--muted)]">{label}</span>
      <span className={`min-w-0 flex-1 text-[var(--ink)] ${clamp ? 'line-clamp-2' : ''}`}>
        {children}
      </span>
    </div>
  );
}

function VisitCardDetails({ data }: { data: VisitCardData }) {
  const hasSession = Boolean(data.sessionIndex && data.packageTotal);
  const hasDetails =
    data.serviceName ||
    data.therapistName ||
    data.condition ||
    data.treatmentNotes ||
    data.treatmentNames.length > 0 ||
    hasSession;
  if (!hasDetails) return null;

  return (
    <div className="mt-1.5 space-y-1">
      {data.therapistName && (
        <CardDetailRow label="Therapist">
          <span className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-0.5">
            <TherapistPill>{data.therapistName}</TherapistPill>
            {data.hasSplit && data.sharedPct != null && (
              <SharedSplitLine
                pct={data.sharedPct}
                name={data.sharedTherapistName ?? 'colleague'}
              />
            )}
          </span>
        </CardDetailRow>
      )}
      {data.condition && <CardDetailRow label="Condition">{data.condition}</CardDetailRow>}
      {(data.treatmentNames.length > 0 || data.treatmentNotes) && (
        <CardDetailRow label="Treatments" clamp>
          {treatmentsDisplayText(data.treatmentNames, data.treatmentNotes)}
        </CardDetailRow>
      )}
      {data.serviceName && <CardDetailRow label="Service">{data.serviceName}</CardDetailRow>}
      {hasSession && (
        <CardDetailRow label="Session">
          <span className="inline-flex items-center gap-1.5">
            <PackageThread sessionIndex={data.sessionIndex!} packageTotal={data.packageTotal!} />
            <span className="font-num text-[var(--muted)]">
              {data.sessionIndex}/{data.packageTotal}
            </span>
          </span>
        </CardDetailRow>
      )}
    </div>
  );
}

export function SharedVisitCard({
  data,
  showDate,
  showPatient,
  boxed = false,
  onInvoice,
  onTakePayment,
  onEditPatient,
  onEdit,
  onSplit,
  onDelete,
  onAskForFeedback,
  onResendFeedback,
  onAskForGoogleReview,
  canInvoice = true,
  backTo,
}: {
  data: VisitCardData;
  showDate: boolean;
  showPatient: boolean;
  /** Renders as its own bordered/shadowed card (the flat "Seen today" list)
   *  rather than a plain row (used inside an already-boxed date group, or a
   *  divide-y list a caller owns) — avoids nesting a box inside a box. */
  boxed?: boolean;
  onInvoice: () => void;
  onTakePayment?: () => void;
  onEditPatient?: () => void;
  onEdit?: () => void;
  onSplit?: () => void;
  onDelete: () => void;
  onAskForFeedback?: () => void;
  onResendFeedback?: () => void;
  onAskForGoogleReview?: () => void;
  canInvoice?: boolean;
  backTo?: PatientProfileBackTarget;
}) {
  const initials = showPatient
    ? data.patientName
        .split(/\s+/)
        .slice(0, 2)
        .map((w) => w[0]?.toUpperCase() ?? '')
        .join('')
    : '';

  const bill = formatINR(data.billPaise);
  const actions = canInvoice ? paymentActions(data.paymentState) : [];
  const badge = paymentBadge({
    state: data.paymentState,
    billPaise: data.billPaise,
    collectedPaise: data.collectedPaise,
    visitDate: data.visitDate,
    issuedAt: data.issuedAt,
    isPackageSession: isPackageContinuation(data.sessionIndex, data.packageTotal),
  });
  const showCollect = canInvoice && actions.includes('take_payment');
  // Same freeze-on-invoice signal PaymentStatusDisplay's table cell shows —
  // added here for parity: this hand-rolled card block never carried it,
  // which was a pre-existing gap between the two, not a deliberate choice.
  const billingLocked = Boolean(data.invoiceId) && data.paymentState !== 'paid';

  const content = (
    <>
      <div className="flex items-start justify-between gap-2">
        <div className="flex min-w-0 flex-1 items-start gap-2.5">
          {showPatient && (
            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[var(--teal-light)] font-display text-[11px] font-semibold text-[var(--teal)]">
              {initials || '?'}
            </div>
          )}
          <div className="min-w-0 flex-1">
            {showPatient && (
              <PatientNameBlock data={data} onEditPatient={onEditPatient} backTo={backTo} />
            )}
            {showDate && (
              <div className={`text-xs text-[var(--muted)] ${showPatient ? 'mt-0.5' : ''}`}>
                {formatDateDM(data.visitDate)}
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
          </div>
        </div>
        <div className="flex shrink-0 items-start gap-0.5">
          {data.paymentState !== 'zero_session' && (
            <span className="font-num text-sm font-semibold tabular-nums text-[var(--ink)]">
              {bill}
            </span>
          )}
          <RowActionsMenu
            data={data}
            onEdit={onEdit}
            onSplit={onSplit}
            onDelete={onDelete}
            onInvoice={onInvoice}
            canInvoice={canInvoice}
          />
        </div>
      </div>

      <VisitCardDetails data={data} />

      <div className="mt-2.5 flex flex-wrap items-center justify-between gap-2 border-t border-[var(--border)] pt-2.5">
        {showCollect ? (
          <button
            type="button"
            className={`rounded-full px-2.5 py-1 text-xs font-medium text-white hover:opacity-90 ${
              badge.kind === 'overdue' ? 'bg-[var(--rust)]' : 'bg-[var(--amber)]'
            }`}
            onClick={onTakePayment}
            title={badge.title}
          >
            Collect {formatINR(data.billPaise - data.collectedPaise)}
          </button>
        ) : (
          <div className="flex items-center gap-1">
            {billingLocked && (
              <span className="text-xs" title="Billing locked — this visit is invoiced">
                🔒
              </span>
            )}
            <Pill tone={PAYMENT_CHIP[badge.kind].tone}>
              <span title={badge.title}>{badge.label}</span>
            </Pill>
          </div>
        )}
        <div className="flex flex-wrap items-center justify-end gap-1.5">
          {!canInvoice && paymentActions(data.paymentState).length > 0 && (
            <Pill tone="slate">Ask billing</Pill>
          )}
          {data.packageInvoicePending && (
            <Pill tone="amber">
              <span title="This session isn't on the package's invoice yet — amend the invoice to include it.">
                Not invoiced
              </span>
            </Pill>
          )}
          <VisitNoteLink data={data} inline backTo={backTo} />
          <VisitFeedbackLink
            data={data}
            onAskForFeedback={onAskForFeedback}
            onResendFeedback={onResendFeedback}
            onAskForGoogleReview={onAskForGoogleReview}
          />
        </div>
      </div>
    </>
  );

  return boxed ? (
    <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-3 shadow-sm">
      {content}
    </div>
  ) : (
    <div className="py-3">{content}</div>
  );
}

interface DateGroupedRows {
  label: string;
  rows: VisitCardData[];
  totalBillPaise: Paise;
}

/** Same today/this-week/this-month/last-month/earlier grouping the card
 *  view has always used — table mode drops the group headers in favor of
 *  a plain Date column, which is where a table naturally carries that
 *  same information. */
export function groupRowsByDate(rows: VisitCardData[], today: Date): DateGroupedRows[] {
  // Local Y/M/D, not toISOString(): that converts to UTC, which in IST puts
  // local midnight on the 1st into the previous day and files the last day of
  // the previous month under "This month".
  const toIso = toLocalDateStr;
  const todayStr = toIso(today);
  const startOfWeek = new Date(today);
  startOfWeek.setDate(today.getDate() - today.getDay());
  const startOfWeekStr = toIso(startOfWeek);
  const startOfMonthStr = toIso(new Date(today.getFullYear(), today.getMonth(), 1));
  const startOfLastMonthStr = toIso(new Date(today.getFullYear(), today.getMonth() - 1, 1));
  const endOfLastMonthStr = toIso(new Date(today.getFullYear(), today.getMonth(), 0));

  const buckets: Record<string, VisitCardData[]> = {
    today: [],
    'this-week': [],
    'this-month': [],
    'last-month': [],
    earlier: [],
  };
  for (const row of rows) {
    if (row.visitDate === todayStr) buckets.today.push(row);
    else if (row.visitDate >= startOfWeekStr && row.visitDate < todayStr)
      buckets['this-week'].push(row);
    else if (row.visitDate >= startOfMonthStr && row.visitDate < startOfWeekStr)
      buckets['this-month'].push(row);
    else if (row.visitDate >= startOfLastMonthStr && row.visitDate <= endOfLastMonthStr)
      buckets['last-month'].push(row);
    else buckets.earlier.push(row);
  }

  const labels: Record<string, string> = {
    today: 'Today',
    'this-week': 'This week',
    'this-month': 'This month',
    'last-month': 'Last month',
    earlier: 'Earlier',
  };
  const order = ['today', 'this-week', 'this-month', 'last-month', 'earlier'];
  const result: DateGroupedRows[] = [];
  for (const key of order) {
    if (buckets[key].length === 0) continue;
    result.push({
      label: labels[key],
      rows: buckets[key],
      totalBillPaise: buckets[key].reduce((sum, r) => sum + r.billPaise, 0),
    });
  }
  return result;
}

/**
 * Below tab: card list (grouped by date if `groupByDate` is set).
 * At tab: and up, a table with a per-user Columns picker.
 */
export function ResponsiveVisitList({
  rows,
  showDate,
  showPatient,
  groupByDate = false,
  onInvoice,
  onTakePayment,
  onEditPatient,
  onEdit,
  onSplit,
  onDelete,
  onAskForFeedback,
  onResendFeedback,
  onAskForGoogleReview,
  canInvoice = true,
  selection,
  backTo,
}: {
  rows: VisitCardData[];
  showDate: boolean;
  showPatient: boolean;
  groupByDate?: boolean;
  onInvoice: (row: VisitCardData) => void;
  onTakePayment?: (row: VisitCardData) => void;
  onEditPatient?: (row: VisitCardData) => void;
  onEdit?: (row: VisitCardData) => void;
  onSplit?: (row: VisitCardData) => void;
  onDelete: (row: VisitCardData) => void;
  onAskForFeedback?: (row: VisitCardData) => void;
  onResendFeedback?: (row: VisitCardData) => void;
  onAskForGoogleReview?: (row: VisitCardData) => void;
  canInvoice?: boolean;
  /** Row checkboxes for bulk actions (e.g. Patient Profile's "select
   *  visits, issue one invoice"). Only wired up in the flat (non-grouped)
   *  card list and the table — grouped mode has no caller that needs it. */
  selection?: VisitSelectionProps;
  /** Where the patient name link's "← Back" should return to. Omit when
   *  showPatient is false, or when this list is the patient's own profile. */
  backTo?: PatientProfileBackTarget;
}) {
  const { prefs, setPref } = useVisitColumnPrefs();

  return (
    <>
      <div className="tab:hidden">
        {groupByDate ? (
          groupRowsByDate(rows, new Date()).map((group) => (
            <div
              key={group.label}
              className="mb-4 rounded-2xl border border-[var(--border)] bg-[var(--surface)] shadow-sm last:mb-0"
            >
              <div className="border-b border-[var(--border)] px-4 py-3 text-sm font-semibold text-[var(--ink)]">
                {group.label} ({group.rows.length} visit{group.rows.length === 1 ? '' : 's'})
                <span className="ml-4 text-xs font-normal text-[var(--muted)]">
                  {formatINR(group.totalBillPaise)}
                </span>
              </div>
              <div className="divide-y divide-[var(--border)] px-4">
                {group.rows.map((row) => (
                  <SharedVisitCard
                    key={row.visitId}
                    data={row}
                    showDate={showDate}
                    showPatient={showPatient}
                    onInvoice={() => onInvoice(row)}
                    onTakePayment={onTakePayment ? () => onTakePayment(row) : undefined}
                    onEditPatient={onEditPatient ? () => onEditPatient(row) : undefined}
                    onEdit={onEdit ? () => onEdit(row) : undefined}
                    onSplit={onSplit ? () => onSplit(row) : undefined}
                    onDelete={() => onDelete(row)}
                    onAskForFeedback={onAskForFeedback ? () => onAskForFeedback(row) : undefined}
                    onResendFeedback={onResendFeedback ? () => onResendFeedback(row) : undefined}
                    onAskForGoogleReview={
                      onAskForGoogleReview ? () => onAskForGoogleReview(row) : undefined
                    }
                    canInvoice={canInvoice}
                    backTo={backTo}
                  />
                ))}
              </div>
            </div>
          ))
        ) : (
          /* Flat list inside a SectionCard — use dividers, not a card per row,
           * so we don't nest a box inside a box and waste horizontal space. */
          <div className="-mx-5 divide-y divide-[var(--border)]">
            {rows.map((row) => (
              <div key={row.visitId} className="flex items-start gap-2 px-5">
                {selection && selection.isSelectable(row) && (
                  <input
                    type="checkbox"
                    checked={selection.selectedIds.has(row.visitId)}
                    onChange={() => selection.onToggle(row.visitId)}
                    className="mt-4 shrink-0 cursor-pointer"
                    aria-label={`Select visit on ${formatDateDM(row.visitDate)}`}
                  />
                )}
                <div className="min-w-0 flex-1">
                  <SharedVisitCard
                    data={row}
                    showDate={showDate}
                    showPatient={showPatient}
                    onInvoice={() => onInvoice(row)}
                    onTakePayment={onTakePayment ? () => onTakePayment(row) : undefined}
                    onEditPatient={onEditPatient ? () => onEditPatient(row) : undefined}
                    onEdit={onEdit ? () => onEdit(row) : undefined}
                    onSplit={onSplit ? () => onSplit(row) : undefined}
                    onDelete={() => onDelete(row)}
                    onAskForFeedback={onAskForFeedback ? () => onAskForFeedback(row) : undefined}
                    onResendFeedback={onResendFeedback ? () => onResendFeedback(row) : undefined}
                    onAskForGoogleReview={
                      onAskForGoogleReview ? () => onAskForGoogleReview(row) : undefined
                    }
                    canInvoice={canInvoice}
                    backTo={backTo}
                  />
                </div>
              </div>
            ))}
          </div>
        )}
        {rows.length === 0 && (
          <p className="py-8 text-center text-sm text-[var(--muted)]">No visits to show.</p>
        )}
      </div>

      <div className="hidden tab:block">
        <VisitTable
          rows={rows}
          showDate={showDate}
          showPatient={showPatient}
          columnPrefs={prefs}
          onColumnPrefsChange={setPref}
          onInvoice={onInvoice}
          onTakePayment={onTakePayment}
          onEditPatient={onEditPatient}
          onEdit={onEdit}
          onSplit={onSplit}
          onDelete={onDelete}
          onAskForFeedback={onAskForFeedback}
          onResendFeedback={onResendFeedback}
          onAskForGoogleReview={onAskForGoogleReview}
          canInvoice={canInvoice}
          selection={selection}
          backTo={backTo}
        />
      </div>
    </>
  );
}
