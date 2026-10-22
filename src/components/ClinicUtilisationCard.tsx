import { useMemo, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { repos } from '@/services';
import { useClinic } from '@/app/clinicContext';
import { SectionCard } from '@/components/ui';
import { minutesOfDay, toLocalDateStr } from '@/domain/schedule';
import {
  utilisationBuckets,
  type UtilisationGranularity,
} from '@/domain/utilisationPeriods';
import {
  clinicUtilisationReport,
  type BucketReport,
} from '@/domain/utilisationReport';
import { loadUtilisationVisits } from '@/services/utilisationVisits';
import { PerformanceFilterBar } from './PerformanceFilterBar';
import { UtilisationTrendCard } from './UtilisationTrendCard';
import { CapacityHoursCard } from './CapacityHoursCard';

/**
 * Modern Splose-inspired clinic performance & utilisation overview.
 * Integrates top filter bar (granularity, practitioner, compare switch),
 * twin hero KPI cards (Utilisation Trend line + Revenue Volume bars),
 * and practitioner performance table with inline progress bars.
 */
export function ClinicUtilisationCard() {
  const clinic = useClinic();
  const [granularity, setGranularity] = useState<UtilisationGranularity>('ytd');

  const report = useLiveQuery(async () => {
    const buckets = utilisationBuckets(granularity, clinic.fyStartMonth);
    if (buckets.length === 0) return [];
    const [visits, therapists, closedDates] = await Promise.all([
      repos.visits.list({
        clinicId: clinic.id,
        from: buckets[0].from,
        to: buckets[buckets.length - 1].to,
      }),
      repos.therapists.list(clinic.id, true),
      repos.clinicClosedDates.listByClinic(clinic.id),
    ]);
    const slotMinutes = clinic.slotDurationMinutes || 30;
    const range = { from: buckets[0].from, to: buckets[buckets.length - 1].to };
    const withLines = await loadUtilisationVisits(clinic.id, visits, range, slotMinutes, repos);
    const now = new Date();
    return clinicUtilisationReport({
      buckets,
      therapists: therapists.map((t) => ({
        id: t.id,
        name: t.name,
        active: t.active !== false,
        workingHours: t.workingHours,
        photoPath: (t as unknown as { photoPath?: string | null }).photoPath,
      })),
      visits: withLines,
      clinicHours: {
        startHour: clinic.bookingStartHour ?? 9,
        endHour: clinic.bookingEndHour ?? 17,
      },
      closedWeekdays: clinic.closedWeekdays,
      closedDates,
      slotMinutes,
      asOf: { date: toLocalDateStr(now), minutes: minutesOfDay(now.toISOString()) },
    });
  }, [
    clinic.id,
    clinic.fyStartMonth,
    clinic.bookingStartHour,
    clinic.bookingEndHour,
    clinic.closedWeekdays,
    clinic.slotDurationMinutes,
    granularity,
  ]);

  return (
    <ClinicUtilisationView
      report={report}
      granularity={granularity}
      onGranularityChange={setGranularity}
    />
  );
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
  const [compareMode, setCompareMode] = useState<boolean>(false);
  const [selectedPractitionerId, setSelectedPractitionerId] = useState<string | null>(null);

  const activeIndex = useMemo(() => {
    if (!report?.length) return -1;
    const i = report.findIndex((b) => b.bucket.key === selectedKey);
    return i >= 0 ? i : report.length - 1;
  }, [report, selectedKey]);

  const active = activeIndex >= 0 ? report?.[activeIndex] : undefined;

  // Extract all distinct therapists across the reports for filter bar picker
  const allPractitioners = useMemo(() => {
    if (!report) return [];
    const map = new Map<string, string>();
    for (const b of report) {
      for (const r of b.rows) {
        if (!map.has(r.therapistId)) {
          map.set(r.therapistId, r.name);
        }
      }
    }
    return [...map.entries()].map(([id, name]) => ({ id, name }));
  }, [report]);

  const selectedPractitionerName = useMemo(() => {
    return allPractitioners.find((p) => p.id === selectedPractitionerId)?.name ?? null;
  }, [allPractitioners, selectedPractitionerId]);

  const displayedReports: BucketReport[] = useMemo(() => {
    if (!report) return [];
    if (!selectedPractitionerId) return report;

    const modified = report.map((b) => {
      const row = b.rows.find((r) => r.therapistId === selectedPractitionerId);
      return {
        ...b,
        clinicRatio: row?.utilisation.ratio ?? null,
        clinicWorkedMinutes: row?.utilisation.workedMinutes ?? 0,
        clinicAvailableMinutes: row?.utilisation.availableMinutes ?? 0,
        clinicRevenuePaise: row?.revenuePaise ?? 0,
        priorClinicRatio: null,
        priorClinicWorkedMinutes: null,
        priorClinicAvailableMinutes: null,
        priorClinicRevenuePaise: null,
      };
    });

    return modified.map((b, i) => {
      const prior = i > 0 ? modified[i - 1] : null;
      return {
        ...b,
        priorClinicRatio: prior ? prior.clinicRatio : null,
        priorClinicWorkedMinutes: prior ? prior.clinicWorkedMinutes : null,
        priorClinicAvailableMinutes: prior ? prior.clinicAvailableMinutes : null,
        priorClinicRevenuePaise: prior ? prior.clinicRevenuePaise : null,
      };
    });
  }, [report, selectedPractitionerId]);

  const hasAnyData =
    report?.some(
      (b) => (b.clinicRatio != null && b.clinicRatio > 0) || b.clinicRevenuePaise > 0
    ) ?? false;

  return (
    <SectionCard title="Clinic utilisation">
      <p className="mb-4 text-xs text-[var(--muted)]">
        Capacity utilisation and clinical work hours across time periods. Filter by practitioner or compare against previous intervals.
      </p>

      {!report && <p className="py-8 text-center text-sm text-[var(--muted)]">Loading…</p>}
      {report && !hasAnyData && (
        <p className="py-8 text-center text-sm text-[var(--muted)]">
          No visits logged in these periods yet.
        </p>
      )}

      {report && hasAnyData && active && (
        <div className="space-y-4">
          <PerformanceFilterBar
            activePeriodLabel={active.bucket.label}
            granularity={granularity}
            onGranularityChange={(g) => {
              onGranularityChange(g);
              setSelectedKey(null);
            }}
            practitioners={allPractitioners}
            selectedPractitionerId={selectedPractitionerId}
            onPractitionerChange={setSelectedPractitionerId}
            compareMode={compareMode}
            onCompareModeChange={setCompareMode}
          />

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <UtilisationTrendCard
              reports={displayedReports}
              activeIndex={activeIndex}
              onSelectBucket={(i) => setSelectedKey(report[i]?.bucket.key ?? null)}
              compareMode={compareMode}
              title={selectedPractitionerName ? `${selectedPractitionerName} Utilisation` : 'Utilisation'}
              subtitle={
                selectedPractitionerName
                  ? `${selectedPractitionerName} work hours vs capacity`
                  : 'Percentage of available time utilised'
              }
            />
            <CapacityHoursCard
              reports={displayedReports}
              activeIndex={activeIndex}
              onSelectBucket={(i) => setSelectedKey(report[i]?.bucket.key ?? null)}
              compareMode={compareMode}
              title={selectedPractitionerName ? `${selectedPractitionerName} Work Hours` : 'Capacity & Work Hours'}
              subtitle={
                selectedPractitionerName
                  ? `${selectedPractitionerName} work hours vs available capacity`
                  : 'Work hours vs available capacity'
              }
            />
          </div>
        </div>
      )}
    </SectionCard>
  );
}
