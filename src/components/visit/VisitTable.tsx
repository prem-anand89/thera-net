import { useState, type CSSProperties } from 'react';
import {
  VISIT_COLUMN_LABELS,
  VISIT_OPTIONAL_COLUMN_ORDER,
  type VisitColumnKey,
} from '@/domain/types';
import { formatINR } from '@/domain/money';
import { formatDateDM } from '@/domain/fiscalYear';
import { PackageThread, th, thNum, td, tdNum, TherapistPill } from '@/components/ui';
import type { PatientProfileBackTarget } from '@/app/router';

import type { VisitCardData, VisitSelectionProps } from './types';
import { treatmentsDisplayText } from './formatters';
import { PatientNameBlock } from './VisitPatientBlock';
import { SharedSplitLine } from './VisitSharedSplit';
import { PaymentStatusDisplay } from './VisitPaymentDisplay';
import { NoteCell } from './VisitNotesFeedback';
import { RowActionsMenu } from './VisitRowActions';

/** Every visit-table `<td>` shares the row's `--td-bg` (set on `<tr>`)
 *  so sticky cells stripe and hover the same as the rest of the row. */
const VISIT_ROW_CELL_BG = 'bg-[var(--td-bg)] group-hover:bg-[var(--teal-light)]';

/** Table rendering of the same VisitCardData rows the card uses — the
 *  Columns picker and every action here reads from the same data shape and
 *  callbacks as SharedVisitCard, so Seen Today and Ledger can share this
 *  one implementation rather than maintaining two column sets. */
export function VisitTable({
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
  onAskForFeedback,
  onResendFeedback,
  onAskForGoogleReview,
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
  onAskForFeedback?: (row: VisitCardData) => void;
  onResendFeedback?: (row: VisitCardData) => void;
  onAskForGoogleReview?: (row: VisitCardData) => void;
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
                  <label
                    key={key}
                    className="flex items-center gap-2 px-1 py-1 text-xs text-[var(--ink)]"
                  >
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
                (key) =>
                  columnPrefs[key] && (
                    <th key={key} className={th}>
                      {VISIT_COLUMN_LABELS[key]}
                    </th>
                  )
              )}
              <th className={thNum}>Bill</th>
              {/* Sticky, not just another scrolling column — with 4 optional
                  columns on by default this table routinely runs wider than
                  the viewport (min-width: full at every breakpoint down to
                  `tab:`), and Status is the one thing worth seeing without
                  scrolling all the way over: whether a visit still needs
                  collecting. Its own background (matching the row's
                  alternating/hover state below) is required, not
                  decorative — a sticky cell with no opaque bg lets the
                  columns scrolling underneath show through. */}
              <th
                className={`sticky right-0 z-[1] border-l border-[var(--border)] bg-[var(--paper)] ${th}`}
              >
                Status
              </th>
              <th className={th}>Actions</th>
              <th className={th}></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[var(--border)]">
            {rows.map((row, i) => (
              <tr
                key={row.visitId}
                className="group align-top bg-[var(--td-bg)] hover:bg-[var(--teal-light)]"
                style={
                  { '--td-bg': i % 2 === 1 ? 'var(--paper)' : 'var(--surface)' } as CSSProperties
                }
              >
                {selection && (
                  <td className={`${td} ${VISIT_ROW_CELL_BG}`}>
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
                  <td className={`${td} ${VISIT_ROW_CELL_BG}`}>
                    {formatDateDM(row.visitDate)}
                    {row.editedBy && (
                      <span
                        className="ml-1 text-[var(--muted)]"
                        title={`Edited by ${row.editedBy}`}
                      >
                        ✎
                      </span>
                    )}
                    {row.syncError && (
                      <span
                        className="ml-1 text-[var(--rust)]"
                        title={`Sync issue: ${row.syncError}`}
                      >
                        ⚠
                      </span>
                    )}
                  </td>
                )}
                {showPatient && (
                  <td className={`${td} ${VISIT_ROW_CELL_BG}`}>
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
                        <td key={key} className={`${td} ${VISIT_ROW_CELL_BG}`}>
                          <div>{row.serviceName}</div>
                          {row.sessionIndex && row.packageTotal && (
                            <div className="mt-1 flex items-center gap-1.5 text-xs text-[var(--muted)]">
                              <PackageThread
                                sessionIndex={row.sessionIndex}
                                packageTotal={row.packageTotal}
                              />
                              <span className="font-num">
                                {row.sessionIndex}/{row.packageTotal}
                              </span>
                            </div>
                          )}
                        </td>
                      );
                    case 'therapist':
                      return (
                        <td key={key} className={`${td} ${VISIT_ROW_CELL_BG}`}>
                          <div className="flex min-w-0 flex-col gap-0.5">
                            <TherapistPill>{row.therapistName}</TherapistPill>
                            {row.hasSplit && row.sharedPct != null && (
                              <SharedSplitLine
                                pct={row.sharedPct}
                                name={row.sharedTherapistName ?? 'colleague'}
                              />
                            )}
                          </div>
                        </td>
                      );
                    case 'condition':
                      return (
                        <td key={key} className={`${td} ${VISIT_ROW_CELL_BG}`}>
                          {row.condition ?? '—'}
                        </td>
                      );
                    case 'treatments':
                      return (
                        <td key={key} className={`${td} ${VISIT_ROW_CELL_BG}`}>
                          <div className="max-w-[200px]">
                            {treatmentsDisplayText(row.treatmentNames, row.treatmentNotes)}
                          </div>
                        </td>
                      );
                  }
                })}
                <td className={`${tdNum} ${VISIT_ROW_CELL_BG}`}>{formatINR(row.billPaise)}</td>
                <td
                  className={`sticky right-0 z-[1] border-l border-[var(--border)] align-top ${td} ${VISIT_ROW_CELL_BG}`}
                >
                  <PaymentStatusDisplay
                    data={row}
                    onTakePayment={onTakePayment ? () => onTakePayment(row) : undefined}
                    canInvoice={canInvoice}
                  />
                </td>
                <td className={`${td} ${VISIT_ROW_CELL_BG}`}>
                  <NoteCell
                    data={row}
                    backTo={backTo}
                    onAskForFeedback={onAskForFeedback ? () => onAskForFeedback(row) : undefined}
                    onResendFeedback={onResendFeedback ? () => onResendFeedback(row) : undefined}
                    onAskForGoogleReview={
                      onAskForGoogleReview ? () => onAskForGoogleReview(row) : undefined
                    }
                  />
                </td>
                <td className={`${td} ${VISIT_ROW_CELL_BG}`}>
                  <RowActionsMenu
                    data={row}
                    onEdit={onEdit ? () => onEdit(row) : undefined}
                    onSplit={onSplit ? () => onSplit(row) : undefined}
                    onDelete={() => onDelete(row)}
                    onInvoice={() => onInvoice(row)}
                    canInvoice={canInvoice}
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
                    VISIT_OPTIONAL_COLUMN_ORDER.filter((key) => columnPrefs[key]).length +
                    4
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
