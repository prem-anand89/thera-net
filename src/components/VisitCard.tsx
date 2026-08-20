import { useRef, useState } from 'react';
import { Link } from '@tanstack/react-router';
import { VISIT_COLUMN_LABELS, type UUID, type VisitColumnKey } from '@/domain/types';
import type { Paise } from '@/domain/money';
import { formatINR } from '@/domain/money';
import { formatDateDMY } from '@/domain/fiscalYear';
import type { VisitPaymentState } from '@/domain/paymentState';
import { paymentActions, paymentStatusPhrase } from '@/domain/paymentState';
import { Pill, PackageThread, th, thNum, td, tdNum } from '@/components/ui';
import { useVisitColumnPrefs } from '@/app/useVisitColumnPrefs';

export const PAYMENT_CHIP: Record<
  VisitPaymentState,
  { tone: 'green' | 'amber' | 'slate'; label: string }
> = {
  paid: { tone: 'green', label: paymentStatusPhrase('paid') },
  collected_no_receipt: { tone: 'green', label: paymentStatusPhrase('collected_no_receipt') },
  outstanding: { tone: 'amber', label: paymentStatusPhrase('outstanding') },
  uninvoiced: { tone: 'amber', label: paymentStatusPhrase('uninvoiced') },
  zero_session: { tone: 'slate', label: paymentStatusPhrase('zero_session') },
};

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
}: {
  data: VisitCardData;
  onEditPatient?: () => void;
}) {
  return (
    <div className="min-w-0">
      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
        <Link
          to="/patients/$patientId"
          params={{ patientId: data.patientId }}
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
  const [menuOpen, setMenuOpen] = useState(false);
  const [openUpward, setOpenUpward] = useState(false);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const hasMenu =
    data.canRepeat ||
    (data.canEdit && onEdit) ||
    (data.canSplit && onSplit) ||
    data.canDelete;
  if (!hasMenu) return null;

  function toggleMenu() {
    if (!menuOpen && buttonRef.current) {
      // Flip the menu above the button whenever there isn't room to open
      // downward within the viewport — a kebab near the bottom of a short
      // list otherwise opens off-screen, forcing a scroll to see it.
      const rect = buttonRef.current.getBoundingClientRect();
      const estimatedMenuHeight = 170;
      setOpenUpward(window.innerHeight - rect.bottom < estimatedMenuHeight);
    }
    setMenuOpen((o) => !o);
  }

  return (
    <div className="relative shrink-0">
      <button
        ref={buttonRef}
        type="button"
        aria-label="Row actions"
        className="rounded-md p-1 text-[var(--muted)] hover:bg-[var(--paper)]"
        onClick={toggleMenu}
      >
        ⋮
      </button>
      {menuOpen && (
        <>
          <div className="fixed inset-0 z-10" onClick={() => setMenuOpen(false)} />
          <div
            className={`absolute right-0 z-20 min-w-32 rounded-md border border-[var(--border)] bg-[var(--surface)] py-1 shadow-lg ${
              openUpward ? 'bottom-full mb-1' : 'top-full mt-1'
            }`}
          >
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
            {data.canEdit && onEdit && (
              <button
                type="button"
                className="block w-full px-3 py-1.5 text-left text-xs text-[var(--ink)] hover:bg-[var(--paper)]"
                onClick={() => {
                  setMenuOpen(false);
                  onEdit();
                }}
              >
                Edit visit
              </button>
            )}
            {data.canSplit && onSplit && (
              <button
                type="button"
                className="block w-full px-3 py-1.5 text-left text-xs text-[var(--ink)] hover:bg-[var(--paper)]"
                onClick={() => {
                  setMenuOpen(false);
                  onSplit();
                }}
              >
                {data.hasSplit ? 'Edit split' : 'Split revenue'}
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
}: {
  data: VisitCardData;
  onInvoice: () => void;
  onTakePayment?: () => void;
  canInvoice: boolean;
  /** False in the table, where Bill is already its own column. */
  showAmount?: boolean;
}) {
  const chip = PAYMENT_CHIP[data.paymentState];
  const bill = formatINR(data.billPaise);
  const actions = canInvoice ? paymentActions(data.paymentState) : [];
  return (
    <div className="flex shrink-0 flex-col items-end gap-1">
      {showAmount && data.paymentState !== 'zero_session' && (
        <div className="font-num text-sm text-[var(--ink)]">{bill}</div>
      )}
      <Pill tone={chip.tone}>{chip.label}</Pill>
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
  const sessionLabel =
    data.sessionIndex && data.packageTotal ? `${data.sessionIndex} of ${data.packageTotal} sessions` : null;
  const therapistLine = [data.therapistName, data.condition].filter(Boolean).join(' · ');

  const content = (
    <>
      <div className="flex items-start justify-between gap-2">
        <div className="flex min-w-0 items-start gap-3">
          {showPatient && (
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[var(--teal-light)] font-display text-xs font-semibold text-[var(--teal)]">
              {initials || '?'}
            </div>
          )}
          <div className="min-w-0">
            {showPatient && <PatientNameBlock data={data} onEditPatient={onEditPatient} />}
            {showDate && (
              <div className={`text-xs text-[var(--muted)] ${showPatient ? 'mt-0.5' : ''}`}>
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
          </div>
        </div>
        <RowActionsMenu data={data} onEdit={onEdit} onSplit={onSplit} onDelete={onDelete} />
      </div>

      {(data.serviceName || sessionLabel) && (
        <div className="mt-2 flex flex-wrap items-center gap-1.5">
          {data.serviceName && <Pill tone="slate">{data.serviceName}</Pill>}
          {sessionLabel && <Pill tone="slate">{sessionLabel}</Pill>}
        </div>
      )}

      {(therapistLine || data.treatmentNotes) && (
        <div className="mt-2 text-xs text-[var(--muted)]">
          {therapistLine && (
            <div className="flex items-center gap-1.5">
              <span aria-hidden>👤</span>
              <span>{therapistLine}</span>
            </div>
          )}
          {data.treatmentNotes && <div className="mt-0.5">{data.treatmentNotes}</div>}
        </div>
      )}

      <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          {data.paymentState !== 'zero_session' && (
            <span className="font-num text-sm font-medium text-[var(--ink)]">{bill}</span>
          )}
          <Pill tone={chip.tone}>{chip.label}</Pill>
        </div>
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
    <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-3.5 shadow-sm">{content}</div>
  ) : (
    <div className="py-3">{content}</div>
  );
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
                {(Object.keys(VISIT_COLUMN_LABELS) as VisitColumnKey[]).map((key) => (
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
              {showDate && <th className={th}>Date</th>}
              {showPatient && <th className={th}>Patient</th>}
              {columnPrefs.therapist && <th className={th}>Therapist</th>}
              {columnPrefs.condition && <th className={th}>Condition</th>}
              {columnPrefs.treatment && <th className={th}>Treatment</th>}
              {columnPrefs.service && <th className={th}>Service</th>}
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
                {showDate && (
                  <td className={td}>
                    {formatDateDMY(row.visitDate)}
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
                    <PatientNameBlock data={row} onEditPatient={onEditPatient ? () => onEditPatient(row) : undefined} />
                  </td>
                )}
                {columnPrefs.therapist && <td className={td}>{row.therapistName}</td>}
                {columnPrefs.condition && <td className={td}>{row.condition ?? '—'}</td>}
                {columnPrefs.treatment && <td className={td}>{row.treatmentNotes ?? '—'}</td>}
                {columnPrefs.service && (
                  <td className={td}>
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
                )}
                <td className={tdNum}>{formatINR(row.billPaise)}</td>
                <td className={td}>
                  <PaymentStatusDisplay
                    data={row}
                    onInvoice={() => onInvoice(row)}
                    onTakePayment={onTakePayment ? () => onTakePayment(row) : undefined}
                    canInvoice={canInvoice}
                    showAmount={false}
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
                    (showDate ? 1 : 0) +
                    (showPatient ? 1 : 0) +
                    (columnPrefs.therapist ? 1 : 0) +
                    (columnPrefs.condition ? 1 : 0) +
                    (columnPrefs.treatment ? 1 : 0) +
                    (columnPrefs.service ? 1 : 0) +
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
 * Below tab: the existing card list (grouped by date if `groupByDate` is
 * set — Ledger wants that, Workspace's flat "Seen today" doesn't). At tab:
 * and up, a table with a per-user Columns picker, backed by the same rows
 * and callbacks. One column config for both surfaces, per the callers
 * simply handing over normalized VisitCardData instead of each maintaining
 * its own rendering.
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
                  />
                ))}
              </div>
            </div>
          ))
        ) : (
          <div className="space-y-2">
            {rows.map((row) => (
              <SharedVisitCard
                key={row.visitId}
                data={row}
                showDate={showDate}
                showPatient={showPatient}
                boxed={true}
                onInvoice={() => onInvoice(row)}
                onTakePayment={onTakePayment ? () => onTakePayment(row) : undefined}
                onEditPatient={onEditPatient ? () => onEditPatient(row) : undefined}
                onEdit={onEdit ? () => onEdit(row) : undefined}
                onSplit={onSplit ? () => onSplit(row) : undefined}
                onDelete={() => onDelete(row)}
                canInvoice={canInvoice}
              />
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
        />
      </div>
    </>
  );
}
