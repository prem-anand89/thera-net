import { useState } from 'react';
import { Link } from '@tanstack/react-router';
import { VISIT_COLUMN_LABELS, type UUID, type VisitColumnKey } from '@/domain/types';
import type { Paise } from '@/domain/money';
import { formatINR } from '@/domain/money';
import { formatDateDMY } from '@/domain/fiscalYear';
import type { VisitPaymentState } from '@/domain/paymentState';
import { paymentActions, paymentStatusLine } from '@/domain/paymentState';
import { Pill, PackageThread, th, thNum, td, tdNum } from '@/components/ui';
import { useVisitColumnPrefs } from '@/app/useVisitColumnPrefs';

export const PAYMENT_CHIP: Record<
  VisitPaymentState,
  { tone: 'green' | 'amber' | 'slate'; label: (bill: string) => string }
> = {
  paid: { tone: 'green', label: (bill) => paymentStatusLine('paid', bill) },
  collected_no_receipt: { tone: 'green', label: (bill) => paymentStatusLine('collected_no_receipt', bill) },
  outstanding: { tone: 'amber', label: (bill) => paymentStatusLine('outstanding', bill) },
  uninvoiced: { tone: 'amber', label: (bill) => paymentStatusLine('uninvoiced', bill) },
  zero_session: { tone: 'slate', label: () => paymentStatusLine('zero_session', '') },
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

/** Row actions kebab menu — shared between the card and table renderings so
 *  Repeat/Edit patient/Split/Delete never drift into two implementations. */
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
  const hasMenu =
    data.canRepeat ||
    (data.canEdit && onEdit) ||
    data.canViewNotes ||
    (data.canSplit && onSplit) ||
    data.canDelete;
  if (!hasMenu) return null;

  return (
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
            {data.canViewNotes && (
              <Link
                to={data.consultationNoteId ? '/patients/$patientId/notes/$noteId' : '/patients/$patientId/notes/new'}
                params={data.consultationNoteId ? { patientId: data.patientId, noteId: data.consultationNoteId } : { patientId: data.patientId }}
                search={data.consultationNoteId ? undefined : { visitId: data.visitId }}
                className="block w-full px-3 py-1.5 text-left text-xs text-[var(--ink)] hover:bg-[var(--paper)]"
                onClick={() => setMenuOpen(false)}
              >
                {data.consultationNoteId ? 'View note' : 'Add note'}
              </Link>
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
  );
}

/** Bill amount + payment-status chip/action + invoiced link + note nudge —
 *  shared between the card's vertical stack and the table's status cell. */
function PaymentStatusDisplay({
  data,
  onInvoice,
  onTakePayment,
  canInvoice,
}: {
  data: VisitCardData;
  onInvoice: () => void;
  onTakePayment?: () => void;
  canInvoice: boolean;
}) {
  const chip = PAYMENT_CHIP[data.paymentState];
  const bill = formatINR(data.billPaise);
  const actions = canInvoice ? paymentActions(data.paymentState) : [];
  return (
    <div className="flex shrink-0 flex-col items-end gap-1">
      <div className="font-num text-sm text-[var(--ink)]">{bill}</div>
      <Pill tone={chip.tone}>{chip.label(bill)}</Pill>
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

  const secondaryParts = [
    data.condition,
    `${data.serviceName}${data.sessionIndex && data.packageTotal ? ` (${data.sessionIndex}/${data.packageTotal})` : ''}`,
    data.therapistName,
    data.treatmentNotes,
  ].filter(Boolean);

  const nameBlock = (
    <div className="min-w-0 flex-1">
      {showPatient && (
        <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
          <Link to="/patients/$patientId" params={{ patientId: data.patientId }} className="font-display text-sm font-medium text-[var(--ink)] hover:underline">
            {data.patientName} <span className="text-xs font-normal text-[var(--muted)]">{data.mrno}</span>
          </Link>
          {onEditPatient && (
            <button type="button" className="text-xs font-medium text-[var(--teal)] hover:underline" onClick={onEditPatient}>
              Edit patient
            </button>
          )}
        </div>
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
  );

  return (
    // Below sm:, date + avatar + name share one row and payment info +
    // actions share a second, full-width row — cramming all five into one
    // flex row left the name/details column with almost no space on a
    // narrow phone, forcing every word onto its own line. sm: and up
    // (still card view below tab:, e.g. a wider phone or small tablet)
    // reverts to the original single-row layout via sm:contents, which has
    // room for it.
    <div className="flex flex-col gap-2 py-3 sm:flex-row sm:items-start sm:gap-3">
      <div className="flex items-start gap-3">
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

        <div className="min-w-0 flex-1 sm:hidden">{nameBlock}</div>
      </div>

      <div className="hidden sm:contents">{nameBlock}</div>

      <div className="flex items-center justify-between gap-2 sm:contents">
        <PaymentStatusDisplay data={data} onInvoice={onInvoice} onTakePayment={onTakePayment} canInvoice={canInvoice} />
        <RowActionsMenu data={data} onEdit={onEdit} onSplit={onSplit} onDelete={onDelete} />
      </div>
    </div>
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

      <div className="overflow-x-auto">
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
            {rows.map((row) => (
              <tr key={row.visitId} className="hover:bg-[var(--paper)]">
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
                    <Link to="/patients/$patientId" params={{ patientId: row.patientId }} className="font-display hover:underline">
                      {row.patientName}
                    </Link>{' '}
                    <span className="text-xs text-[var(--muted)]">{row.mrno}</span>
                    {onEditPatient && (
                      <button
                        type="button"
                        className="ml-2 text-xs font-medium text-[var(--teal)] hover:underline"
                        onClick={() => onEditPatient(row)}
                      >
                        Edit patient
                      </button>
                    )}
                  </td>
                )}
                {columnPrefs.therapist && <td className={td}>{row.therapistName}</td>}
                {columnPrefs.condition && <td className={td}>{row.condition ?? '—'}</td>}
                {columnPrefs.treatment && <td className={td}>{row.treatmentNotes ?? '—'}</td>}
                {columnPrefs.service && (
                  <td className={td}>
                    {row.serviceName}
                    {row.sessionIndex && row.packageTotal && (
                      <span className="ml-1.5">
                        <PackageThread sessionIndex={row.sessionIndex} packageTotal={row.packageTotal} />
                      </span>
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
          <div className="divide-y divide-[var(--border)]">
            {rows.map((row) => (
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
