import { useMemo, useState } from 'react';
import {
  WEEKDAY_META,
  WEEKDAY_ORDER,
  buildCoverage,
  calculateDailyCoverage,
  calculateWeeklyTotal,
  getTemplatePalette,
} from './shiftUtils';
import { AssignShiftDialog } from './AssignShiftDialog';
import type {
  Clinic,
  ShiftTemplate,
  Therapist,
  TherapistShiftAssignment,
} from '@/domain/types';

export type ShiftCoverageGridProps = {
  therapists: Therapist[];
  templates: ShiftTemplate[];
  approvedAssignments: TherapistShiftAssignment[];
  pendingAssignments: TherapistShiftAssignment[];
  clinic: Clinic;
};

export function ShiftCoverageGrid({
  therapists,
  templates,
  approvedAssignments,
  pendingAssignments,
  clinic,
}: ShiftCoverageGridProps) {
  const activeTherapists = useMemo(
    () => therapists.filter((t) => t.active !== false),
    [therapists]
  );

  const [dialogState, setDialogState] = useState<{
    isOpen: boolean;
    therapistId?: string | null;
    weekday?: number | null;
  }>({ isOpen: false });

  const closedDays = useMemo(
    () => new Set(clinic.closedWeekdays ?? []),
    [clinic.closedWeekdays]
  );

  const defaultHourLabel = useMemo(() => {
    const start = clinic.bookingStartHour ?? 9;
    const end = clinic.bookingEndHour ?? 18;
    const start12 = start % 12 || 12;
    const end12 = end % 12 || 12;
    return `Default (${start12}–${end12})`;
  }, [clinic.bookingStartHour, clinic.bookingEndHour]);

  // Build the complete coverage matrix
  const coverageMap = useMemo(
    () => buildCoverage(activeTherapists, approvedAssignments, templates, clinic),
    [activeTherapists, approvedAssignments, templates, clinic]
  );

  // Open assign dialog directly pre-filled with therapist and weekday
  function handleCellClick(therapistId: string, weekday: number) {
    setDialogState({
      isOpen: true,
      therapistId,
      weekday,
    });
  }

  function handleOpenGeneralAssign() {
    setDialogState({
      isOpen: true,
      therapistId: null,
      weekday: null,
    });
  }

  return (
    <div className="space-y-3" data-testid="shift-coverage-grid">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="font-display text-lg font-semibold text-[var(--ink)]">
            Weekly coverage
          </h2>
          <p className="text-xs text-[var(--muted)]">
            Click any cell to assign or update staff shifts.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={handleOpenGeneralAssign}
            className="inline-flex min-h-10 items-center justify-center rounded-xl bg-[var(--teal)] px-4 text-xs font-semibold text-white shadow-sm hover:opacity-90 transition disabled:opacity-50"
            disabled={activeTherapists.length === 0}
          >
            + Assign shift…
          </button>
        </div>
      </div>

      {/* =========================================================================
          DESKTOP COVERAGE TABLE (md and above)
          ========================================================================= */}
      <div className="hidden md:block overflow-x-auto rounded-2xl border border-[var(--border)] bg-[var(--surface)] shadow-sm">
        <table className="w-full text-left border-collapse text-xs" role="grid">
          <thead>
            <tr className="border-b border-[var(--border)] bg-[var(--paper)]">
              <th className="sticky top-0 left-0 z-30 bg-[var(--paper)] p-3 font-semibold text-[var(--ink)] w-44 border-r border-[var(--border)] shadow-[2px_0_4px_-2px_rgba(0,0,0,0.06)]">
                Staff Member
              </th>
              {WEEKDAY_ORDER.map((day) => {
                const meta = WEEKDAY_META[day];
                const isClosed = closedDays.has(day);
                return (
                  <th
                    key={day}
                    className="sticky top-0 z-10 bg-[var(--paper)] p-2.5 text-center font-semibold text-[var(--ink)] min-w-[100px]"
                  >
                    <div>{meta.short}</div>
                    {isClosed && (
                      <div className="text-[10px] font-normal text-[var(--muted)]">Closed</div>
                    )}
                  </th>
                );
              })}
              <th className="sticky top-0 right-0 z-30 bg-[var(--paper)] p-3 text-right font-semibold text-[var(--ink)] w-36 border-l border-[var(--border)] shadow-[-2px_0_4px_-2px_rgba(0,0,0,0.06)]">
                Weekly Total
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[var(--border)]">
            {activeTherapists.length === 0 ? (
              <tr>
                <td colSpan={9} className="p-8 text-center text-sm text-[var(--muted)]">
                  No active team members found.
                </td>
              </tr>
            ) : (
              activeTherapists.map((therapist) => {
                const dayMap = coverageMap.get(therapist.id);
                const weekly = calculateWeeklyTotal(therapist.id, coverageMap);

                return (
                  <tr
                    key={therapist.id}
                    className="group hover:bg-[var(--paper)]/50 transition-colors"
                  >
                    {/* Therapist Name - Sticky Left */}
                    <td className="sticky left-0 z-20 bg-[var(--surface)] group-hover:bg-[var(--paper)] p-3 border-r border-[var(--border)] shadow-[2px_0_4px_-2px_rgba(0,0,0,0.06)]">
                      <div className="flex items-center gap-2">
                        <span
                          className="h-2.5 w-2.5 shrink-0 rounded-full"
                          style={{ background: therapist.color ?? '#2c5f63' }}
                          aria-hidden
                        />
                        <span className="font-medium text-[var(--ink)] truncate max-w-[140px]">
                          {therapist.name}
                        </span>
                      </div>
                    </td>

                    {/* Day Cells */}
                    {WEEKDAY_ORDER.map((weekday) => {
                      const cell = dayMap?.get(weekday);
                      if (!cell) {
                        return <td key={weekday} className="p-2 text-center text-[var(--muted)]">-</td>;
                      }

                      return (
                        <td key={weekday} className="p-1.5 text-center">
                          <button
                            type="button"
                            onClick={() => handleCellClick(therapist.id, weekday)}
                            title={cell.tooltip}
                            aria-label={`${therapist.name}, ${WEEKDAY_META[weekday]?.full}: ${cell.label}`}
                            className="group/btn flex w-full flex-col items-center justify-center rounded-xl p-2 transition hover:ring-2 hover:ring-[var(--teal)] focus-visible:ring-2 focus-visible:ring-[var(--teal)] min-h-[52px]"
                          >
                            {cell.type === 'template' && (
                              <div className="flex flex-col gap-1 w-full items-center">
                                {cell.templates.map(({ template }) => {
                                  const pal = getTemplatePalette(template.id);
                                  return (
                                    <span
                                      key={template.id}
                                      className={`inline-block truncate rounded-lg border px-2 py-1 text-[11px] font-semibold ${pal.bg} ${pal.text} ${pal.border} w-full text-center shadow-xs`}
                                    >
                                      {template.name}
                                    </span>
                                  );
                                })}
                              </div>
                            )}

                            {cell.type === 'custom' && (
                              <span className="inline-block truncate rounded-lg border border-[var(--border)] bg-[var(--paper)] px-2 py-1 text-[11px] font-medium text-[var(--ink)] w-full text-center">
                                Custom
                              </span>
                            )}

                            {cell.type === 'off' && (
                              <span className="inline-block truncate rounded-lg border border-dashed border-[var(--border)] px-2 py-0.5 text-[10px] font-medium text-[var(--muted)] w-full text-center">
                                Off
                              </span>
                            )}

                            {cell.type === 'clinic_closed' && (
                              <span className="inline-block truncate rounded-lg border border-dashed border-[var(--border)]/70 px-2 py-0.5 text-[10px] font-medium text-[var(--muted)]/60 w-full text-center">
                                Closed
                              </span>
                            )}

                            {cell.type === 'clinic_default' && (
                              <span className="inline-block truncate rounded-lg border border-transparent px-2 py-0.5 text-[10px] font-normal text-[var(--muted)] group-hover/btn:bg-[var(--paper)] w-full text-center">
                                {defaultHourLabel}
                              </span>
                            )}
                          </button>
                        </td>
                      );
                    })}

                    {/* Weekly Total Badge - Sticky Right */}
                    <td className="sticky right-0 z-20 bg-[var(--surface)] group-hover:bg-[var(--paper)] p-3 text-right border-l border-[var(--border)] shadow-[-2px_0_4px_-2px_rgba(0,0,0,0.06)]">
                      <span
                        className={`inline-flex items-center rounded-full px-2.5 py-1 text-[11px] font-bold ${
                          weekly.isAllDefault
                            ? 'bg-[var(--paper)] text-[var(--muted)]'
                            : 'bg-[var(--teal-light)] text-[var(--teal)]'
                        }`}
                      >
                        {weekly.label}
                      </span>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>

          {/* Daily Clinic Coverage Footer */}
          {activeTherapists.length > 0 && (
            <tfoot>
              <tr className="border-t-2 border-[var(--border)] bg-[var(--paper)]/80 text-[11px] font-semibold text-[var(--ink)]">
                <td className="sticky left-0 z-20 bg-[var(--paper)] p-3 border-r border-[var(--border)] shadow-[2px_0_4px_-2px_rgba(0,0,0,0.06)]">
                  Clinic Daily Capacity
                </td>
                {WEEKDAY_ORDER.map((weekday) => {
                  const isClosed = closedDays.has(weekday);
                  const daily = calculateDailyCoverage(weekday, coverageMap, isClosed);
                  return (
                    <td key={weekday} className="p-2 text-center">
                      {isClosed ? (
                        <span className="text-[var(--muted)]">Closed</span>
                      ) : daily.staffCount === 0 ? (
                        <div className="flex flex-col items-center rounded-lg bg-[var(--amber-light)]/40 px-1.5 py-0.5 border border-[var(--amber)]/30">
                          <span className="font-bold text-[var(--amber-strong)]">0 on duty</span>
                          <span className="text-[10px] font-medium text-[var(--amber-strong)]">
                            No coverage
                          </span>
                        </div>
                      ) : (
                        <div className="flex flex-col items-center">
                          <span className="text-[var(--teal)]">{daily.staffCount} on duty</span>
                          <span className="text-[10px] font-normal text-[var(--muted)]">
                            {daily.capacityHours}h capacity
                          </span>
                        </div>
                      )}
                    </td>
                  );
                })}
                <td className="sticky right-0 z-20 bg-[var(--paper)] p-3 text-right border-l border-[var(--border)] shadow-[-2px_0_4px_-2px_rgba(0,0,0,0.06)] text-[var(--muted)] font-normal">
                  —
                </td>
              </tr>
            </tfoot>
          )}
        </table>
      </div>

      {/* =========================================================================
          MOBILE VIEW (Cards with 7-chip day strip)
          ========================================================================= */}
      <div className="space-y-3 md:hidden">
        {activeTherapists.map((therapist) => {
          const dayMap = coverageMap.get(therapist.id);
          const weekly = calculateWeeklyTotal(therapist.id, coverageMap);

          return (
            <div
              key={therapist.id}
              className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-4 space-y-3 shadow-xs"
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span
                    className="h-3 w-3 rounded-full"
                    style={{ background: therapist.color ?? '#2c5f63' }}
                    aria-hidden
                  />
                  <h3 className="font-semibold text-sm text-[var(--ink)]">{therapist.name}</h3>
                </div>
                <span className="rounded-full bg-[var(--teal-light)] px-2.5 py-0.5 text-xs font-bold text-[var(--teal)]">
                  {weekly.label}
                </span>
              </div>

              <div className="grid grid-cols-7 gap-1">
                {WEEKDAY_ORDER.map((weekday) => {
                  const cell = dayMap?.get(weekday);
                  const meta = WEEKDAY_META[weekday];

                  return (
                    <button
                      key={weekday}
                      type="button"
                      onClick={() => handleCellClick(therapist.id, weekday)}
                      className="flex flex-col items-center justify-center rounded-xl border border-[var(--border)] p-1.5 text-center min-h-[46px] hover:border-[var(--teal)]"
                    >
                      <span className="text-[10px] font-bold text-[var(--muted)]">
                        {meta.short}
                      </span>
                      <span className="text-[9px] font-medium text-[var(--ink)] truncate w-full">
                        {cell ? (cell.type === 'template' ? cell.label.split(' ')[0] : cell.label) : '-'}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>

      {/* Direct Cell / Assign Shift Dialog */}
      {dialogState.isOpen && (
        <AssignShiftDialog
          isOpen={dialogState.isOpen}
          onClose={() => setDialogState({ isOpen: false })}
          initialTherapistId={dialogState.therapistId}
          initialWeekday={dialogState.weekday}
          therapists={activeTherapists}
          templates={templates}
          approvedAssignments={approvedAssignments}
          pendingAssignments={pendingAssignments}
          clinic={clinic}
        />
      )}
    </div>
  );
}
