import { useMemo } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { repos, dashboardService } from '@/services';
import { formatINR } from '@/domain/money';
import { formatDateDMY } from '@/domain/fiscalYear';
import { REFERRING_SOURCE_LABELS, type Patient } from '@/domain/types';
import { Pill, SectionCard, StatTile } from '@/components/ui';

/**
 * At-a-glance summary of one patient, shown above the Visits table when it's
 * filtered to a single patient. Lifetime figures are computed from the
 * patient's full visit history (not the currently-filtered/date-limited set).
 */
export function PatientOverview({ patient }: { patient: Patient }) {
  const allVisits = useLiveQuery(
    () => repos.visits.list({ clinicId: patient.clinicId, patientId: patient.id }),
    [patient.clinicId, patient.id]
  );
  const openPackages = useLiveQuery(
    () => dashboardService.openPackages(patient.clinicId),
    [patient.clinicId]
  );

  const stats = useMemo(() => {
    const visits = allVisits ?? [];
    const dates = visits.map((v) => v.visitDate).sort();
    return {
      count: visits.length,
      firstSeen: dates[0] ?? null,
      lastSeen: dates.at(-1) ?? null,
      billedPaise: visits.reduce((sum, v) => sum + v.actualBillPaise, 0),
    };
  }, [allVisits]);

  const patientPackages = (openPackages ?? []).filter((p) => p.patientId === patient.id);

  const referral = patient.referringSource
    ? [REFERRING_SOURCE_LABELS[patient.referringSource], patient.referringSourceDetail]
        .filter(Boolean)
        .join(' — ')
    : null;

  return (
    <SectionCard title="Patient overview">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="font-display text-base font-semibold text-[var(--ink)]">
            {patient.name}{' '}
            <span className="font-num text-sm font-normal text-[var(--muted)]">{patient.mrno}</span>
            {patient.mrnoSource === 'auto' && (
              <span className="ml-1.5">
                <Pill tone="slate">walk-in</Pill>
              </span>
            )}
          </div>
          <div className="mt-1 text-xs text-[var(--muted)]">
            {[
              patient.age != null ? `${patient.age}y` : null,
              patient.sex,
              patient.phone,
              patient.primaryCondition,
            ]
              .filter(Boolean)
              .join(' · ') || '—'}
          </div>
          {referral && (
            <div className="mt-1 text-xs text-[var(--muted)]">Referred by: {referral}</div>
          )}
        </div>
      </div>

      <div className="mt-4 flex flex-wrap gap-3">
        <StatTile label="Total visits" value={stats.count} />
        <StatTile label="Lifetime billed" value={formatINR(stats.billedPaise)} />
        <StatTile label="First seen" value={stats.firstSeen ? formatDateDMY(stats.firstSeen) : '—'} />
        <StatTile label="Last seen" value={stats.lastSeen ? formatDateDMY(stats.lastSeen) : '—'} />
        <StatTile label="Open packages" value={patientPackages.length} />
      </div>

      {patientPackages.length > 0 && (
        <ul className="mt-3 space-y-1 text-xs text-[var(--muted)]">
          {patientPackages.map((p) => (
            <li key={p.packageGroupId}>
              <span className="font-medium text-[var(--ink)]">{p.serviceName}</span> — session{' '}
              {p.sessionsLogged} of {p.packageTotal}, last visit {formatDateDMY(p.lastVisitOn)}
              {p.stale && (
                <span className="ml-1.5">
                  <Pill tone="amber">⚠ Stale</Pill>
                </span>
              )}
            </li>
          ))}
        </ul>
      )}
    </SectionCard>
  );
}
