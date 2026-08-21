import { useState, type ReactNode } from 'react';
import { Link } from '@tanstack/react-router';
import { VISIT_COLUMN_LABELS, VISIT_OPTIONAL_COLUMN_ORDER, type UUID, type VisitColumnKey } from '@/domain/types';
import type { Paise } from '@/domain/money';
import { formatINR } from '@/domain/money';
import { formatDateDM } from '@/domain/fiscalYear';
import type { VisitPaymentState } from '@/domain/paymentState';
import { paymentActions, paymentStatusPhrase, paymentStatusShortPhrase } from '@/domain/paymentState';
import { Pill, PackageThread, KebabMenu, menuItem, menuItemDestructive, th, thNum, td, tdNum, TherapistPill } from '@/components/ui';
import { useVisitColumnPrefs } from '@/app/useVisitColumnPrefs';
import type { PatientProfileBackTarget } from '@/app/router';

export const PAYMENT_CHIP: Record<
  VisitPaymentState,
  { tone: 'green' | 'amber' | 'slate'; label: string }
> = {
  paid: { tone: 'green', label: paymentStatusPhrase('paid') },
  collected_no_receipt: { tone: 'green', label: paymentStatusPhrase('collected_no_receipt') },
  partially_collected: { tone: 'amber', label: paymentStatusPhrase('partially_collected') },
  outstanding: { tone: 'amber', label: paymentStatusPhrase('outstanding') },
  uninvoiced: { tone: 'amber', label: paymentStatusPhrase('uninvoiced') },
  zero_session: { tone: 'slate', label: paymentStatusPhrase('zero_session') },
};

/** Combines catalog treatment picks with the free-text add-on into one
 *  display string for the single "Treatments" column/cell — e.g. "Manual
 *  Therapy, Exercise Therapy — FM An/Re S,S". Either half can be absent. */
export function treatmentsDisplayText(treatmentNames: string[], treatmentNotes: string | null): string {
  const parts = [];
  if (treatmentNames.length) parts.push(treatmentNames.join(', '));
  if (treatmentNotes) parts.push(treatmentNotes);
  return parts.join(' — ') || '—';
}

/** ID · age · sex under the name, matching New visit's Patient panel. */
export function patientIdentityLine(
  mrno: string,
  age?: number | null,
  sex?: 'M' | 'F' | 'Other' | null
): string {
  const parts = [mrno];
  if (age != null) parts.push(`${age}y`);
  if (sex) parts.push(sex);
  return parts.join(' · ');
}

function PatientNameBlock({
  data,
  onEditPatient,
  backTo,
}: {
  data: VisitCardData;
  onEditPatient?: () => void;
  /** Where the patient profile's own "← Back" link should return to —
   *  set by whichever list is rendering this row (Ledger, Workspace).
   *  Omitted where clicking through doesn't leave the current page in
   *  any meaningful sense (e.g. Patient Profile's own visit history). */
  backTo?: PatientProfileBackTarget;
}) {
  return (
    <div className="min-w-0">
      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
        <Link
          to="/patients/$patientId"
          params={{ patientId: data.patientId }}
          search={backTo ? { from: backTo } : undefined}
          className="font-display text-sm font-medium text-[var(--ink)] hover:underline"
        >
          {data.patientName}
        </Link>
        {onEditPatient && (
          <button
            type="button"
            className="text-[var(--muted)] hover:text-[var(--ink)]"
            aria-label="Edit patient"
            title="Edit patient"
            onClick={onEditPatient}
          >
            ✎
          </button>
        )}
      </div>
      <div className="text-xs text-[var(--muted)]">{patientIdentityLine(data.mrno, data.age, data.sex)}</div>
    </div>
  );
}

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
  age?: number | null;
  sex?: 'M' | 'F' | 'Other' | null;
  condition: string | null;
  serviceName: string;
  sessionIndex: number | null;
  packageTotal: number | null;
  therapistName: string;
  treatmentNotes: string | null;
  /** Resolved treatment_catalog names for this visit's "Treatments performed" — pre-resolved, not raw ids. */
  treatmentNames: string[];
  billPaise: Paise;
  paymentState: VisitPaymentState;
  invoiceId: UUID | null;
  /** Set when someone other than the original author last touched this row. */
  editedBy?: string | null;
  syncError?: string | null;
  canRepeat: boolean;
  canEdit?: boolean;
  canSplit?: boolean;
  hasSplit?: boolean;
  canDelete: boolean;
  /** True when this visit is flagged for a clinical note that hasn't been completed yet. */
  needsNote?: boolean;
  /**
   * Whether this viewer can open the note editor for this visit's patient
   * at all (mirrors `usePermissions().canViewClinicalNotes` — false for
   * front desk). Independent of `needsNote`: `needsNote` only lights up
   * when the clinic has clinicalDocsEnabled *and* the visit predates a
   * completed note, so a clinic that has it off, or a visit whose note is
   * already done, previously had no notes entry point at all outside
   * Patient Profile.
   */
  canViewNotes?: boolean;
  /** Set once this visit's note is completed — routes the row action to
   *  view it instead of starting a new one. Unset for a draft-in-progress
   *  note too (drafts don't populate this field, same gap `needsNote`'s
   *  own "+ Note" link already has) — both route to /notes/new. */
  consultationNoteId?: UUID | null;
}

/** Row actions kebab — Repeat / Edit visit / Split / Delete. Note lives on
 *  the status cell as + Note so it is not listed twice. */
function RowActionsMenu({
  data,
  onEdit,
  onSplit,
  onDelete,
}: {
  data: VisitCardData;
  onEdit?: () => void;
  onSplit?: () => void;
  onDelete: () => void;
}) {
  const hasMenu =
    data.canRepeat ||
    (data.canEdit && onEdit) ||
    (data.canSplit && onSplit) ||
    data.canDelete;
  if (!hasMenu) return null;

  return (
    <KebabMenu>
      {(close) => (
        <>
          {data.canRepeat && (
            <Link
              to="/visits/new"
              search={{ repeatVisitId: data.visitId }}
              className={menuItem}
              onClick={close}
            >
              Repeat
            </Link>
          )}
          {data.canEdit && onEdit && (
            <button
              type="button"
              className={menuItem}
              onClick={() => {
                close();
                onEdit();
              }}
            >
              Edit visit
            </button>
          )}
          {data.canSplit && onSplit && (
            <button
              type="button"
              className={menuItem}
              onClick={() => {
                close();
                onSplit();
              }}
            >
              {data.hasSplit ? 'Edit split' : 'Split revenue'}
            </button>
          )}
          {data.canDelete && (
            <button
              type="button"
              className={menuItemDestructive}
              onClick={() => {
                close();
                onDelete();
              }}
            >
              Delete
            </button>
          )}
        </>
      )}
    </KebabMenu>
  );
}

/** Bill amount + payment-status chip/action + invoiced link + note nudge —
 *  shared between the card's vertical stack and the table's status cell. */
function PaymentStatusDisplay({
  data,
  onInvoice,
  onTakePayment,
  canInvoice,
  showAmount = true,
  compact = false,
}: {
  data: VisitCardData;
  onInvoice: () => void;
  onTakePayment?: () => void;
  canInvoice: boolean;
  /** False in the table, where Bill is already its own column. */
  showAmount?: boolean;
  /** Table cells: short label, horizontal layout — avoids tall rows on iPad portrait. */
  compact?: boolean;
}) {
  const chip = PAYMENT_CHIP[data.paymentState];
  const bill = formatINR(data.billPaise);
  const actions = canInvoice ? paymentActions(data.paymentState) : [];
  const statusLabel = compact ? paymentStatusShortPhrase(data.paymentState) : chip.label;
  const statusTitle = compact ? paymentStatusPhrase(data.paymentState) : undefined;

  // Billing fields freeze the moment a visit is invoiced (see
  // EditVisitModal's `frozen` check), independent of whether it's since
  // been collected — but only 'outstanding'/'partially_collected' chips
  // read ambiguously about that ("Due"/"Partial" say nothing about billing
  // being locked). 'paid' already says "Invoiced" in its own label.
  const billingLocked = Boolean(data.invoiceId) && data.paymentState !== 'paid';

  if (compact) {
    return (
      <div className="flex max-w-[8.5rem] flex-wrap items-center gap-1">
        {billingLocked && (
          <span className="text-[10px]" title="Billing locked — this visit is invoiced">
            🔒
          </span>
        )}
        <Pill tone={chip.tone}>
          <span className="whitespace-nowrap" title={statusTitle}>
            {statusLabel}
          </span>
        </Pill>
        {canInvoice && actions.includes('take_payment') && (
          <button
            type="button"
            className="whitespace-nowrap rounded-full bg-[var(--rust-light)] px-2 py-0.5 text-[10px] font-medium text-[var(--rust)] hover:opacity-80"
            onClick={onTakePayment}
          >
            Pay
          </button>
        )}
        {canInvoice && actions.includes('issue_invoice') && (
          <button
            type="button"
            className="whitespace-nowrap rounded-full bg-[var(--teal-light)] px-2 py-0.5 text-[10px] font-medium text-[var(--teal)] hover:opacity-80"
            onClick={onInvoice}
          >
            Invoice
          </button>
        )}
        {!canInvoice && paymentActions(data.paymentState).length > 0 && (
          <Pill tone="slate">Ask billing</Pill>
        )}
      </div>
    );
  }

  return (
    <div className="flex shrink-0 flex-col items-end gap-1">
      {showAmount && data.paymentState !== 'zero_session' && (
        <div className="font-num text-sm text-[var(--ink)]">{bill}</div>
      )}
      <div className="flex items-center gap-1">
        {billingLocked && (
          <span className="text-xs" title="Billing locked — this visit is invoiced">
            🔒
          </span>
        )}
        <Pill tone={chip.tone}>{chip.label}</Pill>
      </div>
      {canInvoice && actions.length > 0 && (
        <div className="flex flex-wrap justify-end gap-1">
          {actions.includes('take_payment') && (
            <button
              type="button"
              className="rounded-full bg-[var(--rust-light)] px-2.5 py-1 text-xs font-medium text-[var(--rust)] hover:opacity-80"
              onClick={onTakePayment}
            >
              Take payment
            </button>
          )}
          {actions.includes('issue_invoice') && (
            <button
              type="button"
              className="rounded-full bg-[var(--teal-light)] px-2.5 py-1 text-xs font-medium text-[var(--teal)] hover:opacity-80"
              onClick={onInvoice}
            >
              Issue invoice
            </button>
          )}
        </div>
      )}
      {!canInvoice && paymentActions(data.paymentState).length > 0 && (
        <Pill tone="slate">Ask billing</Pill>
      )}
      {data.needsNote && (
        <Link
          to="/patients/$patientId/notes/new"
          params={{ patientId: data.patientId }}
          search={{ visitId: data.visitId }}
          className="text-xs font-medium text-[var(--amber)] hover:underline"
          title="Clinical note not started for this visit"
        >
          + Note
        </Link>
      )}
    </div>
  );
}

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
      <span className={`min-w-0 flex-1 text-[var(--ink)] ${clamp ? 'line-clamp-2' : ''}`}>{children}</span>
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
          <TherapistPill>{data.therapistName}</TherapistPill>
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

  const chip = PAYMENT_CHIP[data.paymentState];
  const bill = formatINR(data.billPaise);
  const actions = canInvoice ? paymentActions(data.paymentState) : [];

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
            {showPatient && <PatientNameBlock data={data} onEditPatient={onEditPatient} backTo={backTo} />}
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
            <span className="font-num text-sm font-semibold tabular-nums text-[var(--ink)]">{bill}</span>
          )}
          <RowActionsMenu data={data} onEdit={onEdit} onSplit={onSplit} onDelete={onDelete} />
        </div>
      </div>

      <VisitCardDetails data={data} />

      <div className="mt-2.5 flex flex-wrap items-center justify-between gap-2 border-t border-[var(--border)] pt-2.5">
        <Pill tone={chip.tone}>{chip.label}</Pill>
        <div className="flex flex-wrap items-center justify-end gap-1.5">
          {actions.includes('take_payment') && (
            <button
              type="button"
              className="rounded-full bg-[var(--teal)] px-2.5 py-1 text-xs font-medium text-white hover:bg-[var(--teal-strong)]"
              onClick={onTakePayment}
            >
              Take payment
            </button>
          )}
          {actions.includes('issue_invoice') && (
            <button
              type="button"
              className="rounded-full border border-[var(--border)] px-2.5 py-1 text-xs font-medium text-[var(--ink)] hover:bg-[var(--paper)]"
              onClick={onInvoice}
            >
              Issue invoice
            </button>
          )}
          {!canInvoice && paymentActions(data.paymentState).length > 0 && <Pill tone="slate">Ask billing</Pill>}
          {data.needsNote && (
            <Link
              to="/patients/$patientId/notes/new"
              params={{ patientId: data.patientId }}
              search={{ visitId: data.visitId }}
              className="text-xs font-medium text-[var(--amber)] hover:underline"
              title="Clinical note not started for this visit"
            >
              + Note
            </Link>
          )}
        </div>
      </div>
    </>
  );

  return boxed ? (
    <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-3 shadow-sm">{content}</div>
  ) : (
    <div className="py-3">{content}</div>
  );
}

/** Opt-in row checkboxes for bulk actions (currently: Patient Profile's
 *  "select visits, issue one invoice" flow) — shared between the card list
 *  and the table so the feature works at every breakpoint. */
export interface VisitSelectionProps {
  selectedIds: Set<UUID>;
  onToggle: (visitId: UUID) => void;
  isSelectable: (row: VisitCardData) => boolean;
}

/** Table rendering of the same VisitCardData rows the card uses — the
 *  Columns picker and every action here reads from the same data shape and
 *  callbacks as SharedVisitCard, so Seen Today and Ledger can share this
 *  one implementation rather than maintaining two column sets. */
function VisitTable({
  rows,
  showDate,
  showPatient,
  columnPrefs,
  onColumnPrefsChange,
  onInvoice,
  onTakePayment,
  onEditPatient,
  onEdit,
  onSplit,
  onDelete,
  canInvoice,
  selection,
  backTo,
}: {
  rows: VisitCardData[];
  showDate: boolean;
  showPatient: boolean;
  columnPrefs: Record<VisitColumnKey, boolean>;
  onColumnPrefsChange: (key: VisitColumnKey, visible: boolean) => void;
  onInvoice: (row: VisitCardData) => void;
  onTakePayment?: (row: VisitCardData) => void;
  onEditPatient?: (row: VisitCardData) => void;
  onEdit?: (row: VisitCardData) => void;
  onSplit?: (row: VisitCardData) => void;
  onDelete: (row: VisitCardData) => void;
  canInvoice: boolean;
  selection?: VisitSelectionProps;
  backTo?: PatientProfileBackTarget;
}) {
  const [pickerOpen, setPickerOpen] = useState(false);

  return (
    <div>
      <div className="flex justify-end pb-2">
        <div className="relative">
          <button
            type="button"
            className="rounded-md px-2 py-1 text-xs text-[var(--muted)] hover:bg-[var(--paper)]"
            onClick={() => setPickerOpen((o) => !o)}
          >
            Columns ▾
          </button>
          {pickerOpen && (
            <>
              <div className="fixed inset-0 z-10" onClick={() => setPickerOpen(false)} />
              <div className="absolute right-0 top-full z-20 mt-1 min-w-40 rounded-md border border-[var(--border)] bg-[var(--surface)] p-2 shadow-lg">
                {VISIT_OPTIONAL_COLUMN_ORDER.map((key) => (
                  <label key={key} className="flex items-center gap-2 px-1 py-1 text-xs text-[var(--ink)]">
                    <input
                      type="checkbox"
                      checked={columnPrefs[key]}
                      onChange={(e) => onColumnPrefsChange(key, e.target.checked)}
                    />
                    {VISIT_COLUMN_LABELS[key]}
                  </label>
                ))}
              </div>
            </>
          )}
        </div>
      </div>

      {/* overflow-y-visible is deliberate, not decorative: setting only
          overflow-x leaves overflow-y at its browser-computed default of
          'auto' too (per the CSS overflow spec), which silently turns this
          into a vertical clipping container — cutting off the row-actions
          dropdown on the last row instead of letting it render past the
          table's edge. */}
      <div className="overflow-x-auto overflow-y-visible">
        <table className="min-w-full divide-y divide-[var(--border)]">
          <thead className="bg-[var(--paper)]">
            <tr>
              {selection && <th className={th}></th>}
              {showDate && <th className={th}>Date</th>}
              {showPatient && <th className={th}>Patient</th>}
              {VISIT_OPTIONAL_COLUMN_ORDER.map(
                (key) => columnPrefs[key] && <th key={key} className={th}>{VISIT_COLUMN_LABELS[key]}</th>
              )}
              <th className={thNum}>Bill</th>
              <th className={th}>Status</th>
              <th className={th}></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[var(--border)]">
            {rows.map((row, i) => (
              <tr
                key={row.visitId}
                className={`hover:bg-[var(--teal-light)] ${i % 2 === 1 ? 'bg-[var(--paper)]' : ''}`}
              >
                {selection && (
                  <td className={td}>
                    {selection.isSelectable(row) && (
                      <input
                        type="checkbox"
                        checked={selection.selectedIds.has(row.visitId)}
                        onChange={() => selection.onToggle(row.visitId)}
                        className="cursor-pointer"
                        aria-label={`Select visit on ${formatDateDM(row.visitDate)}`}
                      />
                    )}
                  </td>
                )}
                {showDate && (
                  <td className={td}>
                    {formatDateDM(row.visitDate)}
                    {row.editedBy && (
                      <span className="ml-1 text-[var(--muted)]" title={`Edited by ${row.editedBy}`}>
                        ✎
                      </span>
                    )}
                    {row.syncError && (
                      <span className="ml-1 text-[var(--rust)]" title={`Sync issue: ${row.syncError}`}>
                        ⚠
                      </span>
                    )}
                  </td>
                )}
                {showPatient && (
                  <td className={td}>
                    <PatientNameBlock
                      data={row}
                      onEditPatient={onEditPatient ? () => onEditPatient(row) : undefined}
                      backTo={backTo}
                    />
                  </td>
                )}
                {VISIT_OPTIONAL_COLUMN_ORDER.map((key) => {
                  if (!columnPrefs[key]) return null;
                  switch (key) {
                    case 'service':
                      return (
                        <td key={key} className={td}>
                          <div>{row.serviceName}</div>
                          {row.sessionIndex && row.packageTotal && (
                            <div className="mt-1 flex items-center gap-1.5 text-xs text-[var(--muted)]">
                              <PackageThread sessionIndex={row.sessionIndex} packageTotal={row.packageTotal} />
                              <span className="font-num">
                                {row.sessionIndex}/{row.packageTotal}
                              </span>
                            </div>
                          )}
                        </td>
                      );
                    case 'therapist':
                      return (
                        <td key={key} className={td}>
                          <TherapistPill>{row.therapistName}</TherapistPill>
                        </td>
                      );
                    case 'condition':
                      return (
                        <td key={key} className={td}>
                          {row.condition ?? '—'}
                        </td>
                      );
                    case 'treatments':
                      return (
                        <td key={key} className={td}>
                          {treatmentsDisplayText(row.treatmentNames, row.treatmentNotes)}
                        </td>
                      );
                  }
                })}
                <td className={tdNum}>{formatINR(row.billPaise)}</td>
                <td className={td}>
                  <PaymentStatusDisplay
                    data={row}
                    onInvoice={() => onInvoice(row)}
                    onTakePayment={onTakePayment ? () => onTakePayment(row) : undefined}
                    canInvoice={canInvoice}
                    showAmount={false}
                    compact
                  />
                </td>
                <td className={td}>
                  <RowActionsMenu
                    data={row}
                    onEdit={onEdit ? () => onEdit(row) : undefined}
                    onSplit={onSplit ? () => onSplit(row) : undefined}
                    onDelete={() => onDelete(row)}
                  />
                </td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr>
                <td
                  colSpan={
                    (selection ? 1 : 0) +
                    (showDate ? 1 : 0) +
                    (showPatient ? 1 : 0) +
                    (VISIT_OPTIONAL_COLUMN_ORDER.filter((key) => columnPrefs[key]).length) +
                    3
                  }
                  className="px-3 py-8 text-center text-sm text-[var(--muted)]"
                >
                  No visits to show.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
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
function groupRowsByDate(rows: VisitCardData[], today: Date): DateGroupedRows[] {
  const toIso = (d: Date) => d.toISOString().slice(0, 10);
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
    else if (row.visitDate >= startOfWeekStr && row.visitDate < todayStr) buckets['this-week'].push(row);
    else if (row.visitDate >= startOfMonthStr && row.visitDate < startOfWeekStr) buckets['this-month'].push(row);
    else if (row.visitDate >= startOfLastMonthStr && row.visitDate <= endOfLastMonthStr) buckets['last-month'].push(row);
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
                <span className="ml-4 text-xs font-normal text-[var(--muted)]">{formatINR(group.totalBillPaise)}</span>
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
                    canInvoice={canInvoice}
                    backTo={backTo}
                  />
                </div>
              </div>
            ))}
          </div>
        )}
        {rows.length === 0 && <p className="py-8 text-center text-sm text-[var(--muted)]">No visits to show.</p>}
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
          canInvoice={canInvoice}
          selection={selection}
          backTo={backTo}
        />
      </div>
    </>
  );
}
