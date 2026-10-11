import { useMemo, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { repos } from '@/services';
import { useClinic } from '@/app/clinicContext';
import { SectionCard } from '@/components/ui';
import { UTILISATION_COLOR } from '@/components/chartColors';
import { minutesOfDay, toLocalDateStr } from '@/domain/schedule';
import { utilisationBuckets, type UtilisationGranularity } from '@/domain/utilisationPeriods';
import { clinicUtilisationReport, type BucketReport } from '@/domain/utilisationReport';
import { STATUS_THRESHOLDS, therapistStatus, type TherapistStatus } from '@/domain/therapistStatus';

const GRANULARITIES: { key: UtilisationGranularity; label: string }[] = [
  { key: 'month', label: 'Monthly' },
  { key: 'quarter', label: 'Quarterly' },
  { key: 'year', label: 'Annual' },
];

const STATUS_LABEL: Record<TherapistStatus, string> = {
  strong: 'Strong',
  steady: 'Steady',
  attention: 'Needs attention',
  insufficient: 'Not enough data',
};
const STATUS_STYLE: Record<TherapistStatus, string> = {
  strong: 'bg-[var(--teal-light)] text-[var(--teal-strong)]',
  steady: 'bg-[var(--paper)] text-[var(--ink)]',
  attention: 'bg-[var(--rust)]/10 text-[var(--rust)]',
  insufficient: 'bg-[var(--paper)] text-[var(--muted)]',
};

const pct = (r: number | null) => (r == null ? '—' : `${Math.round(r * 100)}%`);

/**
 * Clinic-wide utilisation (work logged ÷ time made available) by month,
 * fiscal quarter or fiscal year, with each therapist's figure and a status
 * for the selected period, so an admin can spot strong and lagging
 * therapists. Admin-only; the caller gates it.
 */
export function ClinicUtilisationCard() {
  const clinic = useClinic();
  const [granularity, setGranularity] = useState<UtilisationGranularity>('month');

  const report = useLiveQuery(async () => {
    const buckets = utilisationBuckets(granularity, clinic.fyStartMonth);
    if (buckets.length === 0) return [];
    const [visits, therapists, closedDates] = await Promise.all([
      repos.visits.list({ clinicId: clinic.id, from: buckets[0].from, to: buckets[buckets.length - 1].to }),
      repos.therapists.list(clinic.id, true),
      repos.clinicClosedDates.listByClinic(clinic.id),
    ]);
    const now = new Date();
    return clinicUtilisationReport({
      buckets,
      therapists: therapists.map((t) => ({ id: t.id, name: t.name, active: t.active !== false, workingHours: t.workingHours })),
      visits,
      clinicHours: { startHour: clinic.bookingStartHour ?? 9, endHour: clinic.bookingEndHour ?? 17 },
      closedWeekdays: clinic.closedWeekdays,
      closedDates,
      slotMinutes: clinic.slotDurationMinutes || 30,
      asOf: { date: toLocalDateStr(now), minutes: minutesOfDay(now.toISOString()) },
    });
  }, [clinic.id, clinic.fyStartMonth, clinic.bookingStartHour, clinic.bookingEndHour, clinic.closedWeekdays, clinic.slotDurationMinutes, granularity]);

  return <ClinicUtilisationView report={report} granularity={granularity} onGranularityChange={setGranularity} />;
}

export function ClinicUtilisationView({
  report,
  granularity,
  onGranularityChange,
}: {
  report: BucketReport[] | undefined;
  granularity: UtilisationGranularity;
  onGranularityChange: (g: UtilisationGranularity) => void;
}) {
  const [selectedKey, setSelectedKey] = useState<string | null>(null);

  const activeIndex = useMemo(() => {
    if (!report?.length) return -1;
    const i = report.findIndex((b) => b.bucket.key === selectedKey);
    return i >= 0 ? i : report.length - 1;
  }, [report, selectedKey]);
  const active = activeIndex >= 0 ? report?.[activeIndex] : undefined;
  const previous = activeIndex > 0 ? report?.[activeIndex - 1] : undefined;

  const tableRows = useMemo(() => {
    if (!active) return [];
    return active.rows
      .map((row) => {
        const prior = previous?.rows.find((r) => r.therapistId === row.therapistId)?.utilisation.ratio ?? null;
        const verdict = therapistStatus({
          utilisation: row.utilisation.ratio,
          clinicUtilisation: active.clinicRatio,
          previousUtilisation: prior,
          visitCount: row.visitCount,
        });
        return { row, prior, ...verdict };
      })
      .sort((a, b) => (b.row.utilisation.ratio ?? -1) - (a.row.utilisation.ratio ?? -1));
  }, [active, previous]);

  const hasAnyData = report?.some((b) => b.clinicRatio != null && b.clinicRatio > 0) ?? false;
  const target = STATUS_THRESHOLDS.strongAt;

  return (
    <SectionCard title="Clinic utilisation">
      <p className="mb-3 text-xs text-[var(--muted)]">
        Work logged ÷ time made available. Each visit counts as one clinic slot, so walk-ins are included.
      </p>
      <div className="mb-3 flex flex-wrap gap-1.5" role="group" aria-label="Utilisation period">
        {GRANULARITIES.map((g) => (
          <button
            key={g.key}
            type="button"
            aria-pressed={granularity === g.key}
            onClick={() => {
              onGranularityChange(g.key);
              setSelectedKey(null);
            }}
            className="min-h-9 rounded-full border px-3 py-1 text-xs font-medium"
            style={{
              background: granularity === g.key ? 'var(--teal-light)' : 'var(--paper)',
              borderColor: granularity === g.key ? 'transparent' : 'var(--border)',
              color: granularity === g.key ? 'var(--teal)' : 'var(--muted)',
            }}
          >
            {g.label}
          </button>
        ))}
      </div>

      {!report && <p className="py-6 text-center text-sm text-[var(--muted)]">Loading…</p>}
      {report && !hasAnyData && (
        <p className="py-6 text-center text-sm text-[var(--muted)]">No visits logged in these periods yet.</p>
      )}

      {report && hasAnyData && (
        <>
          <div className="overflow-x-auto overscroll-x-contain">
            <div style={{ minWidth: `${report.length * 44}px` }}>
              <div
                role="group"
                aria-label="Clinic utilisation by period"
                className="relative grid h-44 items-stretch gap-1.5 border-b border-[var(--border)] pt-5"
                style={{ gridTemplateColumns: `repeat(${report.length}, minmax(0, 1fr))` }}
              >
                <div
                  className="pointer-events-none absolute inset-x-0 border-t border-dashed border-[var(--muted)]/60"
                  style={{ bottom: `${target * 100 * (1 - 20 / 176)}%` }}
                >
                  <span className="absolute right-0 -top-4 bg-[var(--surface)] px-1 text-[10px] text-[var(--muted)]">
                    Target {Math.round(target * 100)}%
                  </span>
                </div>
                {report.map((b, i) => {
                  const ratio = b.clinicRatio ?? 0;
                  const selected = i === activeIndex;
                  return (
                    <button
                      key={b.bucket.key}
                      type="button"
                      aria-pressed={selected}
                      aria-label={`${b.bucket.label}: ${pct(b.clinicRatio)} utilisation`}
                      onClick={() => setSelectedKey(b.bucket.key)}
                      className="flex min-h-11 items-end justify-center"
                    >
                      <div
                        className="relative w-full max-w-10 rounded-t"
                        style={{
                          height: `${Math.max(2, Math.min(100, ratio * 100))}%`,
                          background: UTILISATION_COLOR,
                          opacity: selected ? 1 : 0.5,
                        }}
                      >
                        <span className="font-num absolute -top-4 left-1/2 -translate-x-1/2 text-[10px] text-[var(--ink)]">
                          {b.clinicRatio != null ? pct(b.clinicRatio) : ''}
                        </span>
                      </div>
                    </button>
                  );
                })}
              </div>
              <div className="grid gap-1.5 pt-1" style={{ gridTemplateColumns: `repeat(${report.length}, minmax(0, 1fr))` }}>
                {report.map((b, i) => (
                  <span
                    key={b.bucket.key}
                    className={`truncate text-center text-[10px] ${i === activeIndex ? 'font-semibold text-[var(--ink)]' : 'text-[var(--muted)]'}`}
                  >
                    {b.bucket.label}
                  </span>
                ))}
              </div>
            </div>
          </div>

          {active && (
            <div className="mt-5 border-t border-[var(--border)] pt-4">
              <p className="text-[11px] font-semibold uppercase tracking-wide text-[var(--muted)]">{active.bucket.label}</p>
              <h3 className="font-display text-sm font-semibold text-[var(--ink)]">
                Therapists · clinic {pct(active.clinicRatio)}
              </h3>
              <div className="mt-2 overflow-x-auto overscroll-x-contain rounded-lg border border-[var(--border)]">
                <table className="min-w-full divide-y divide-[var(--border)] text-sm">
                  <thead className="bg-[var(--paper)] text-[11px] uppercase tracking-wide text-[var(--muted)]">
                    <tr>
                      <th className="px-3 py-2 text-left font-semibold">Therapist</th>
                      <th className="px-3 py-2 text-right font-semibold">Utilisation</th>
                      <th className="px-3 py-2 text-right font-semibold">vs last period</th>
                      <th className="px-3 py-2 text-right font-semibold">Visits</th>
                      <th className="px-3 py-2 text-left font-semibold">Status</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[var(--border)]">
                    {tableRows.map(({ row, prior, status, reason }) => {
                      const ratio = row.utilisation.ratio;
                      const delta = ratio != null && prior != null ? Math.round((ratio - prior) * 100) : null;
                      return (
                        <tr key={row.therapistId}>
                          <td className="px-3 py-2.5">{row.name}</td>
                          <td className="font-num px-3 py-2.5 text-right" title={row.utilisation.usesClinicHours ? 'Based on clinic hours — no personal hours set' : undefined}>
                            {pct(ratio)}
                            {ratio != null && row.utilisation.usesClinicHours ? '*' : ''}
                          </td>
                          <td className="font-num px-3 py-2.5 text-right">
                            {delta == null ? '—' : `${delta > 0 ? '+' : ''}${delta} pts`}
                          </td>
                          <td className="font-num px-3 py-2.5 text-right">{row.visitCount}</td>
                          <td className="px-3 py-2.5">
                            <span className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_STYLE[status]}`}>
                              {STATUS_LABEL[status]}
                            </span>
                            <span className="mt-0.5 block text-[11px] text-[var(--muted)]">{reason}</span>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
                {tableRows.some((r) => r.row.utilisation.usesClinicHours) && (
                  <p className="border-t border-[var(--border)] px-3 py-2 text-xs text-[var(--muted)]">
                    * No personal working hours set, so clinic booking hours were used as available time.
                  </p>
                )}
              </div>
              <p className="mt-2 text-xs text-[var(--muted)]">
                Strong: {Math.round(STATUS_THRESHOLDS.strongAt * 100)}%+ and at or above the clinic. Needs attention: under{' '}
                {Math.round(STATUS_THRESHOLDS.lowBelow * 100)}%, {Math.round(STATUS_THRESHOLDS.gapBelowClinic * 100)}+ points under the clinic, or a{' '}
                {Math.round(STATUS_THRESHOLDS.dropFromPrevious * 100)}+ point drop while below it. Time spent per visit isn't measured yet,
                so long treatments and short reviews count the same.
              </p>
            </div>
          )}
        </>
      )}
    </SectionCard>
  );
}
