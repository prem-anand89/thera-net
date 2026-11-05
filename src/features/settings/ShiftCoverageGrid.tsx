import { useMemo, useState } from 'react';
import { SectionCard, btnPrimary } from '@/components/ui';
import {
  WEEKDAY_META,
  WEEKDAY_ORDER,
  buildCoverage,
  calculateDailyCoverage,
  calculateWeeklyTotal,
  describeSchedule,
  formatDayRanges,
  getTemplatePalette,
  uncoveredSessions,
} from './shiftUtils';
import { ShiftSheet } from './ShiftSheet';
import type { Clinic, ShiftTemplate, Therapist, TherapistShiftAssignment } from '@/domain/types';

export type ShiftCoverageGridProps = {
  therapists: Therapist[];
  templates: ShiftTemplate[];
  approvedAssignments: TherapistShiftAssignment[];
  clinic: Clinic;
};

/**
 * "Weekly shifts": who works which days. A table from the tablet width (`tab:`), one card per therapist below it.
 * Tapping a therapist (row or card) opens their hours sheet; "+ Assign shift" assigns one shift type to several people.
 */
export function ShiftCoverageGrid({ therapists, templates, approvedAssignments, clinic }: ShiftCoverageGridProps) {
  const activeTherapists = useMemo(() => therapists.filter((t) => t.active !== false), [therapists]);
  const [sheet, setSheet] = useState<{ therapistId: string | null } | null>(null);
  const closedDays = useMemo(() => new Set(clinic.closedWeekdays ?? []), [clinic.closedWeekdays]);

  const coverageMap = useMemo(
    () => buildCoverage(activeTherapists, approvedAssignments, templates, clinic),
    [activeTherapists, approvedAssignments, templates, clinic]
  );
  // Days where a two-session clinic has a session no one covers ("Evening gap").
  const gaps = useMemo(
    () =>
      WEEKDAY_ORDER.flatMap((day) => {
        if (closedDays.has(day)) return [];
        const missing = uncoveredSessions(day, coverageMap, clinic);
        return missing.length > 0 && activeTherapists.length > 0 ? [{ day, missing }] : [];
      }),
    [coverageMap, clinic, closedDays, activeTherapists.length]
  );

  // Phones: "Mon–Sat evening · Sun morning", one phrase per session, however many days.
  const gapSummary = (['Morning', 'Evening'] as const)
    .map((session) => ({ session, days: gaps.filter((g) => g.missing.includes(session)).map((g) => g.day) }))
    .filter((x) => x.days.length > 0)
    .map((x) => `${formatDayRanges(x.days)} ${x.session.toLowerCase()}`)
    .join(' · ');

  return (
    <SectionCard
      id="settings-card-team-weekly-shifts"
      title="Weekly shifts"
      action={
        <button
          type="button"
          onClick={() => setSheet({ therapistId: null })}
          className={`${btnPrimary} min-h-9 px-3 text-sm`}
          disabled={activeTherapists.length === 0}
        >
          + Assign shift
        </button>
      }
    >
      <div data-testid="shift-coverage-grid">
        <p className="mb-3 text-xs text-[var(--muted)]">Who works which days. Tap a therapist to change their shifts.</p>

        {activeTherapists.length === 0 ? (
          <p className="py-4 text-sm text-[var(--muted)]">No active team members yet.</p>
        ) : (
          <>
            {/* Tablet and up: a table, the whole row opens the therapist's sheet. */}
            <div className="hidden overflow-x-auto rounded-xl border border-[var(--border)] bg-[var(--surface)] tab:block">
              <table className="w-full table-fixed border-collapse text-left text-xs" role="grid">
                <thead>
                  <tr className="border-b border-[var(--border)] bg-[var(--paper)]">
                    <th className="sticky left-0 top-0 z-30 w-[24%] min-w-[150px] border-r border-[var(--border)] bg-[var(--paper)] px-3 py-2 font-semibold text-[var(--ink)]">
                      Therapist
                    </th>
                    {WEEKDAY_ORDER.map((day) => (
                      <th key={day} className="sticky top-0 z-10 w-[9%] min-w-[50px] bg-[var(--paper)] px-1 py-1.5 text-center font-semibold text-[var(--ink)]">
                        <div className="text-hint leading-tight">{WEEKDAY_META[day].short}</div>
                        {closedDays.has(day) && <div className="text-caption font-normal leading-tight text-[var(--muted)]">Closed</div>}
                      </th>
                    ))}
                    <th className="sticky right-0 top-0 z-30 w-[8%] min-w-[60px] border-l border-[var(--border)] bg-[var(--paper)] px-2.5 py-2 text-right font-semibold text-[var(--ink)]">
                      <div className="text-hint leading-tight">Total</div>
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[var(--border)]">
                  {activeTherapists.map((therapist) => {
                    const dayMap = coverageMap.get(therapist.id);
                    const weekly = calculateWeeklyTotal(therapist.id, coverageMap);
                    return (
                      <tr
                        key={therapist.id}
                        className="group cursor-pointer transition-colors hover:bg-[var(--paper)]/60"
                        onClick={() => setSheet({ therapistId: therapist.id })}
                      >
                        <td className="sticky left-0 z-20 border-r border-[var(--border)] bg-[var(--surface)] px-2.5 py-1.5 group-hover:bg-[var(--paper)]">
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              setSheet({ therapistId: therapist.id });
                            }}
                            aria-label={`Edit ${therapist.name}'s schedule`}
                            className="flex w-full items-center gap-1.5 text-left"
                          >
                            <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: therapist.color ?? 'var(--teal)' }} aria-hidden />
                            <span className="min-w-0 flex-1 break-words text-hint font-medium text-[var(--ink)]">{therapist.name}</span>
                            <span aria-hidden className="hidden shrink-0 text-caption text-[var(--muted)] opacity-0 transition-opacity group-hover:opacity-100 desktop:inline">
                              Edit ›
                            </span>
                          </button>
                        </td>
                        {WEEKDAY_ORDER.map((weekday) => {
                          const cell = dayMap?.get(weekday);
                          if (!cell) return <td key={weekday} className="p-1 text-center text-[var(--muted)]">-</td>;
                          return (
                            <td key={weekday} className="p-0.5 text-center">
                              <div
                                title={cell.tooltip}
                                aria-label={`${therapist.name}, ${WEEKDAY_META[weekday]?.full}: ${cell.label}`}
                                className="flex min-h-[38px] w-full flex-col items-center justify-center rounded-lg p-1"
                              >
                                {cell.type === 'template' && (
                                  <div className="flex w-full flex-col items-center gap-0.5">
                                    {cell.templates.map(({ template }) => {
                                      const pal = getTemplatePalette(template.id);
                                      return (
                                        <span
                                          key={template.id}
                                          className={`inline-block w-full break-words rounded border px-1 py-0.5 text-center text-caption font-semibold leading-tight ${pal.bg} ${pal.text} ${pal.border}`}
                                        >
                                          {template.name}
                                        </span>
                                      );
                                    })}
                                  </div>
                                )}
                                {cell.type === 'custom' && (
                                  <span className="inline-block w-full truncate whitespace-nowrap rounded border border-[var(--border)] bg-[var(--paper)] px-1 py-0.5 text-center text-caption font-medium text-[var(--ink)]">
                                    {cell.label}
                                  </span>
                                )}
                                {cell.type === 'off' && (
                                  <span className="inline-block w-full truncate rounded border border-dashed border-[var(--border)] px-1 py-0.5 text-center text-caption font-medium text-[var(--muted)]">
                                    Off
                                  </span>
                                )}
                                {cell.type === 'clinic_closed' && (
                                  <span className="inline-block w-full truncate rounded border border-dashed border-[var(--border)]/70 bg-[var(--paper)]/30 px-1 py-0.5 text-center text-caption font-medium text-[var(--muted)]/60">
                                    Closed
                                  </span>
                                )}
                                {cell.type === 'clinic_default' && (
                                  <span className="inline-block w-full truncate rounded px-1 py-0.5 text-center text-caption font-medium text-[var(--muted)]">
                                    {cell.label}
                                  </span>
                                )}
                              </div>
                            </td>
                          );
                        })}
                        <td className="sticky right-0 z-20 border-l border-[var(--border)] bg-[var(--surface)] px-2 py-1.5 text-right group-hover:bg-[var(--paper)]">
                          <div className="flex flex-col items-end leading-tight">
                            <span className="text-xs font-semibold text-[var(--ink)]">{weekly.totalHours}h</span>
                            <span className="text-caption text-[var(--muted)]">{weekly.isAllDefault ? 'Clinic hours' : `${weekly.shiftsCount} days`}</span>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
                <tfoot>
                  <tr className="border-t-2 border-[var(--border)] bg-[var(--paper)]/90 text-xs font-semibold text-[var(--ink)]">
                    <td className="sticky left-0 z-20 border-r border-[var(--border)] bg-[var(--paper)] px-3 py-1.5 text-caption font-medium text-[var(--muted)]">
                      On shift
                    </td>
                    {WEEKDAY_ORDER.map((weekday) => {
                      const isClosed = closedDays.has(weekday);
                      const daily = calculateDailyCoverage(weekday, coverageMap, isClosed);
                      const gap = gaps.find((g) => g.day === weekday);
                      return (
                        <td key={weekday} className="p-1 text-center">
                          {isClosed ? (
                            <span className="text-caption text-[var(--muted)]">Closed</span>
                          ) : daily.staffCount === 0 ? (
                            <span className="inline-block rounded border border-[var(--amber)]/30 bg-[var(--amber-light)]/40 px-1 py-0.5 text-caption font-semibold text-[var(--amber-strong)]">
                              No one
                            </span>
                          ) : (
                            <div className="flex flex-col items-center leading-tight">
                              <span className="text-caption font-semibold text-[var(--teal)]">
                                {daily.staffCount} staff
                              </span>
                              <span className="text-caption text-[var(--muted)]">{daily.capacityHours}h total</span>
                              {gap && (
                                <span className="mt-0.5 rounded bg-[var(--amber-light)]/50 px-1 text-caption font-semibold text-[var(--amber-strong)]">
                                  {gap.missing.join(' + ')} gap
                                </span>
                              )}
                            </div>
                          )}
                        </td>
                      );
                    })}
                    <td className="sticky right-0 z-20 border-l border-[var(--border)] bg-[var(--paper)] px-2.5 py-1.5 text-right text-hint font-normal text-[var(--muted)]">—</td>
                  </tr>
                </tfoot>
              </table>
            </div>

            {/* Phones: one card per therapist, the whole card opens the sheet. */}
            <div className="space-y-2.5 tab:hidden">
              {gaps.length > 0 && (
                <p className="rounded-lg bg-[var(--amber-light)]/50 px-3 py-2 text-xs text-[var(--amber-strong)]" data-testid="gap-note">
                  No one on shift: {gapSummary}.
                </p>
              )}
              {activeTherapists.map((therapist) => {
                const dayMap = coverageMap.get(therapist.id);
                const weekly = calculateWeeklyTotal(therapist.id, coverageMap);
                const desc = describeSchedule(
                  therapist,
                  approvedAssignments.filter((a) => a.therapistId === therapist.id),
                  templates,
                  clinic
                );
                return (
                  <button
                    key={therapist.id}
                    type="button"
                    aria-label={`Edit ${therapist.name}'s schedule`}
                    onClick={() => setSheet({ therapistId: therapist.id })}
                    className="block w-full rounded-xl border border-[var(--border)] bg-[var(--surface)] p-3 text-left active:bg-[var(--paper)]"
                  >
                    <span className="flex items-start justify-between gap-2">
                      <span className="flex min-w-0 items-center gap-2">
                        <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: therapist.color ?? 'var(--teal)' }} aria-hidden />
                        <span className="break-words text-sm font-semibold text-[var(--ink)]">{therapist.name}</span>
                      </span>
                      <span className="shrink-0 text-xs font-semibold text-[var(--ink)]">{weekly.totalHours}h / wk</span>
                    </span>
                    <span className="mt-0.5 block text-xs text-[var(--muted)]">{desc.summary}</span>
                    <span className="mt-2 grid grid-cols-7 gap-1" aria-hidden="true">
                      {WEEKDAY_ORDER.map((weekday) => {
                        const cell = dayMap?.get(weekday);
                        const state = cell && cell.workingMinutes > 0 ? 'on' : cell?.type === 'clinic_closed' ? 'closed' : 'off';
                        return (
                          <span key={weekday} className="flex flex-col items-center gap-1 text-[11px] text-[var(--muted)]">
                            {WEEKDAY_META[weekday].short.slice(0, 1)}
                            <span
                              className={`h-2.5 w-2.5 rounded-full ${
                                state === 'on' ? 'bg-[var(--teal)]' : state === 'closed' ? 'bg-[var(--border)]' : 'border border-[var(--muted)]'
                              }`}
                            />
                          </span>
                        );
                      })}
                    </span>
                  </button>
                );
              })}
            </div>
          </>
        )}
      </div>

      {sheet && <ShiftSheet open therapistId={sheet.therapistId} onClose={() => setSheet(null)} />}
    </SectionCard>
  );
}
