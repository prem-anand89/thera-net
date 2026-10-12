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
  }>({ isOpen: false });

  const closedDays = useMemo(
    () => new Set(clinic.closedWeekdays ?? []),
    [clinic.closedWeekdays]
  );

  // Short, compact label e.g. "9–5" instead of verbose "Default (9–5)"
  const defaultHourLabel = useMemo(() => {
    const start = clinic.bookingStartHour ?? 9;
    const end = clinic.bookingEndHour ?? 17;
    const start12 = start % 12 || 12;
    const end12 = end % 12 || 12;
    return `${start12}–${end12}`;
  }, [clinic.bookingStartHour, clinic.bookingEndHour]);

  // Build the complete coverage matrix
  const coverageMap = useMemo(
    () => buildCoverage(activeTherapists, approvedAssignments, templates, clinic),
    [activeTherapists, approvedAssignments, templates, clinic]
  );

  // Open assign dialog pre-filled with therapist to edit their schedule
  function handleEditTherapist(therapistId: string) {
    setDialogState({
      isOpen: true,
      therapistId,
    });
  }

  function handleOpenGeneralAssign() {
    setDialogState({
      isOpen: true,
      therapistId: null,
    });
  }

  return (
    <div className="space-y-3" data-testid="shift-coverage-grid">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="font-display text-base sm:text-lg font-semibold text-[var(--ink)]">
            Weekly coverage
          </h2>
          <p className="text-xs text-[var(--muted)]">
            Click Edit next to any team member to update their schedule.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={handleOpenGeneralAssign}
            className="inline-flex min-h-9 items-center justify-center rounded-xl bg-[var(--teal)] px-3.5 text-xs font-semibold text-white shadow-sm hover:opacity-90 transition disabled:opacity-50"
            disabled={activeTherapists.length === 0}
          >
            + Assign shift…
          </button>
        </div>
      </div>

      {/* =========================================================================
          DESKTOP COVERAGE TABLE (md and above)
          Tight, fixed-layout table that fits 100% width with zero horizontal scroll.
          ========================================================================= */}
      <div className="hidden md:block overflow-x-auto rounded-xl border border-[var(--border)] bg-[var(--surface)] shadow-2xs">
        <table className="table-fixed w-full text-left border-collapse text-xs" role="grid">
          <thead>
            <tr className="border-b border-[var(--border)] bg-[var(--paper)]">
              {/* Staff Member column (22%) */}
              <th className="sticky top-0 left-0 z-30 bg-[var(--paper)] px-3 py-2 font-semibold text-[var(--ink)] w-[22%] min-w-[130px] border-r border-[var(--border)] shadow-[2px_0_4px_-2px_rgba(0,0,0,0.06)]">
                Staff Member
              </th>

              {/* 7 Days columns (10% each = 70% total) */}
              {WEEKDAY_ORDER.map((day) => {
                const meta = WEEKDAY_META[day];
                const isClosed = closedDays.has(day);
                return (
                  <th
                    key={day}
                    className="sticky top-0 z-10 bg-[var(--paper)] px-1 py-1.5 text-center font-semibold text-[var(--ink)] w-[10%] min-w-[50px]"
                  >
                    <div className="text-[11px] leading-tight">{meta.short}</div>
                    {isClosed && (
                      <div className="text-[9.5px] font-normal text-[var(--muted)] leading-tight">Closed</div>
                    )}
                  </th>
                );
              })}

              {/* Weekly Total column (8%) */}
              <th className="sticky top-0 right-0 z-30 bg-[var(--paper)] px-2.5 py-2 text-right font-semibold text-[var(--ink)] w-[8%] min-w-[60px] border-l border-[var(--border)] shadow-[-2px_0_4px_-2px_rgba(0,0,0,0.06)]">
                <div className="text-[11px] leading-tight">Total</div>
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[var(--border)]">
            {activeTherapists.length === 0 ? (
              <tr>
                <td colSpan={9} className="p-8 text-center text-xs text-[var(--muted)]">
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
                    <td className="sticky left-0 z-20 bg-[var(--surface)] group-hover:bg-[var(--paper)] px-2.5 py-1.5 border-r border-[var(--border)] shadow-[2px_0_4px_-2px_rgba(0,0,0,0.06)]">
                      <div className="flex items-center justify-between gap-1.5">
                        <div className="flex items-center gap-1.5 min-w-0">
                          <span
                            className="h-2 w-2 shrink-0 rounded-full"
                            style={{ background: therapist.color ?? '#2c5f63' }}
                            aria-hidden
                          />
                          <span className="font-medium text-[11.5px] text-[var(--ink)] truncate max-w-[80px]" title={therapist.name}>
                            {therapist.name}
                          </span>
                        </div>
                        <button
                          type="button"
                          onClick={() => handleEditTherapist(therapist.id)}
                          className="rounded border border-[var(--border)] bg-[var(--surface)] px-1.5 py-0.5 text-[10.5px] font-medium text-[var(--teal)] hover:border-[var(--teal)] hover:bg-[var(--paper)] transition shrink-0"
                          title={`Edit ${therapist.name}'s schedule`}
                          aria-label={`Edit ${therapist.name}'s schedule`}
                        >
                          Edit
                        </button>
                      </div>
                    </td>

                    {/* Day Cells (Read-only indicators) */}
                    {WEEKDAY_ORDER.map((weekday) => {
                      const cell = dayMap?.get(weekday);
                      if (!cell) {
                        return <td key={weekday} className="p-1 text-center text-[var(--muted)]">-</td>;
                      }

                      return (
                        <td key={weekday} className="p-0.5 text-center">
                          <div
                            title={cell.tooltip}
                            aria-label={`${therapist.name}, ${WEEKDAY_META[weekday]?.full}: ${cell.label}`}
                            className="flex w-full flex-col items-center justify-center rounded-lg p-1 min-h-[38px]"
                          >
                            {cell.type === 'template' && (
                              <div className="flex flex-col gap-0.5 w-full items-center">
                                {cell.templates.map(({ template }) => {
                                  const pal = getTemplatePalette(template.id);
                                  return (
                                    <span
                                      key={template.id}
                                      className={`inline-block truncate rounded border px-1 py-0.5 text-[10px] font-semibold leading-tight ${pal.bg} ${pal.text} ${pal.border} w-full text-center`}
                                    >
                                      {template.name}
                                    </span>
                                  );
                                })}
                              </div>
                            )}

                            {cell.type === 'custom' && (
                              <span className="inline-block truncate rounded border border-[var(--border)] bg-[var(--paper)] px-1 py-0.5 text-[9.5px] font-medium text-[var(--ink)] w-full text-center">
                                Custom
                              </span>
                            )}

                            {cell.type === 'off' && (
                              <span className="inline-block truncate rounded border border-dashed border-[var(--border)] px-1 py-0.5 text-[9.5px] font-medium text-[var(--muted)] w-full text-center">
                                Off
                              </span>
                            )}

                            {cell.type === 'clinic_closed' && (
                              <span className="inline-block truncate rounded border border-dashed border-[var(--border)]/70 bg-[var(--paper)]/30 px-1 py-0.5 text-[9.5px] font-medium text-[var(--muted)]/60 w-full text-center">
                                Closed
                              </span>
                            )}

                            {cell.type === 'clinic_default' && (
                              <span className="inline-block truncate rounded px-1 py-0.5 text-[10.5px] font-medium text-[var(--muted)] w-full text-center">
                                {defaultHourLabel}
                              </span>
                            )}
                          </div>
                        </td>
                      );
                    })}

                    {/* Weekly Total - Compact Stacked (Hours + Label) */}
                    <td className="sticky right-0 z-20 bg-[var(--surface)] group-hover:bg-[var(--paper)] px-2 py-1.5 text-right border-l border-[var(--border)] shadow-[-2px_0_4px_-2px_rgba(0,0,0,0.06)]">
                      <div className="flex flex-col items-end leading-tight">
                        <span className="font-bold text-xs text-[var(--ink)]">
                          {weekly.totalHours}h
                        </span>
                        <span className="text-[9.5px] text-[var(--muted)]">
                          {weekly.isAllDefault ? 'Default' : `${weekly.shiftsCount} shifts`}
                        </span>
                      </div>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>

          {/* Daily Clinic Coverage Footer */}
          {activeTherapists.length > 0 && (
            <tfoot>
              <tr className="border-t-2 border-[var(--border)] bg-[var(--paper)]/90 text-xs font-semibold text-[var(--ink)]">
                <td className="sticky left-0 z-20 bg-[var(--paper)] px-3 py-1.5 border-r border-[var(--border)] shadow-[2px_0_4px_-2px_rgba(0,0,0,0.06)] font-medium text-[10.5px] text-[var(--muted)]">
                  Daily capacity
                </td>
                {WEEKDAY_ORDER.map((weekday) => {
                  const isClosed = closedDays.has(weekday);
                  const daily = calculateDailyCoverage(weekday, coverageMap, isClosed);
                  return (
                    <td key={weekday} className="p-1 text-center">
                      {isClosed ? (
                        <span className="text-[10px] text-[var(--muted)]">Closed</span>
                      ) : daily.staffCount === 0 ? (
                        <div className="flex flex-col items-center rounded bg-[var(--amber-light)]/40 px-1 py-0.5 border border-[var(--amber)]/30 leading-tight">
                          <span className="font-bold text-[10px] text-[var(--amber-strong)]">0 staff</span>
                        </div>
                      ) : (
                        <div className="flex flex-col items-center leading-tight">
                          <span className="text-[10.5px] font-semibold text-[var(--teal)]">{daily.staffCount} staff</span>
                          <span className="text-[9.5px] font-normal text-[var(--muted)]">
                            {daily.capacityHours}h
                          </span>
                        </div>
                      )}
                    </td>
                  );
                })}
                <td className="sticky right-0 z-20 bg-[var(--paper)] px-2.5 py-1.5 text-right border-l border-[var(--border)] shadow-[-2px_0_4px_-2px_rgba(0,0,0,0.06)] text-[var(--muted)] font-normal text-[11px]">
                  —
                </td>
              </tr>
            </tfoot>
          )}
        </table>
      </div>

      {/* =========================================================================
          MOBILE VIEW (Refined Staff Cards with 7-Day Quick Strip)
          Touch-friendly, compact, clear day-by-day status.
          ========================================================================= */}
      <div className="space-y-2.5 md:hidden">
        {activeTherapists.length === 0 ? (
          <div className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-6 text-center text-xs text-[var(--muted)]">
            No active team members found.
          </div>
        ) : (
          activeTherapists.map((therapist) => {
            const dayMap = coverageMap.get(therapist.id);
            const weekly = calculateWeeklyTotal(therapist.id, coverageMap);

            return (
              <div
                key={therapist.id}
                className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-3 space-y-2 shadow-2xs"
              >
                {/* Header: Therapist Name + Edit Button + Total Hours Badge */}
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-1.5">
                    <span
                      className="h-2.5 w-2.5 rounded-full"
                      style={{ background: therapist.color ?? '#2c5f63' }}
                      aria-hidden
                    />
                    <h3 className="font-semibold text-xs text-[var(--ink)] truncate max-w-[140px]">
                      {therapist.name}
                    </h3>
                    <button
                      type="button"
                      onClick={() => handleEditTherapist(therapist.id)}
                      className="rounded border border-[var(--border)] bg-[var(--surface)] px-1.5 py-0.5 text-[10.5px] font-medium text-[var(--teal)] hover:border-[var(--teal)] hover:bg-[var(--paper)] transition"
                      aria-label={`Edit ${therapist.name}'s schedule`}
                    >
                      Edit
                    </button>
                  </div>
                  <span className="rounded-full bg-[var(--teal-light)] px-2 py-0.5 text-[10.5px] font-bold text-[var(--teal)]">
                    {weekly.totalHours}h {weekly.isAllDefault ? '• Default' : `• ${weekly.shiftsCount} shifts`}
                  </span>
                </div>

                {/* 7-Day Quick Strip (Read-only indicators) */}
                <div className="grid grid-cols-7 gap-1">
                  {WEEKDAY_ORDER.map((weekday) => {
                    const cell = dayMap?.get(weekday);
                    const meta = WEEKDAY_META[weekday];

                    let pillContent = defaultHourLabel;
                    let pillStyle = 'border-transparent text-[var(--muted)] bg-transparent';

                    if (cell) {
                      if (cell.type === 'template' && cell.templates.length > 0) {
                        const pal = getTemplatePalette(cell.templates[0].template.id);
                        pillContent = cell.templates[0].template.name.slice(0, 6);
                        pillStyle = `${pal.bg} ${pal.text} ${pal.border}`;
                      } else if (cell.type === 'custom') {
                        pillContent = 'Cust';
                        pillStyle = 'border-[var(--border)] bg-[var(--paper)] text-[var(--ink)]';
                      } else if (cell.type === 'off') {
                        pillContent = 'Off';
                        pillStyle = 'border-dashed border-[var(--border)] text-[var(--muted)]';
                      } else if (cell.type === 'clinic_closed') {
                        pillContent = 'Close';
                        pillStyle = 'border-dashed border-[var(--border)]/70 text-[var(--muted)]/60 bg-[var(--paper)]/40';
                      }
                    }

                    return (
                      <div
                        key={weekday}
                        title={cell?.tooltip}
                        className="flex flex-col items-center justify-center rounded-lg border border-[var(--border)]/80 p-1 text-center min-h-[44px]"
                      >
                        <span className="text-[9.5px] font-bold text-[var(--muted)] leading-none mb-1">
                          {meta.short}
                        </span>
                        <span className={`inline-block truncate rounded px-1 py-0.5 text-[9px] font-semibold leading-tight w-full border ${pillStyle}`}>
                          {pillContent}
                        </span>
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })
        )}
      </div>

      {/* Assign Shift Dialog */}
      {dialogState.isOpen && (
        <AssignShiftDialog
          key={dialogState.therapistId ?? 'all'}
          isOpen={dialogState.isOpen}
          onClose={() => setDialogState({ isOpen: false })}
          initialTherapistId={dialogState.therapistId}
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
