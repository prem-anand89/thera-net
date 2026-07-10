import { useMemo, useState } from 'react';
import { Link, useParams } from '@tanstack/react-router';
import { useLiveQuery } from 'dexie-react-hooks';
import { repos, patientActivityService, dashboardService } from '@/services';
import { useClinic } from '@/app/clinicContext';
import { Pill, btnPrimary } from '@/components/ui';
import type { ActivityKind } from '@/services/patientActivityService';
import { formatDateDMY } from '@/domain/fiscalYear';
import { REFERRING_SOURCE_LABELS } from '@/domain/types';

const KIND_LABELS: Record<ActivityKind, string> = {
  visit: 'Visit',
  consultation_note: 'Note',
};

const KIND_TONES: Record<ActivityKind, 'green' | 'amber' | 'slate'> = {
  visit: 'green',
  consultation_note: 'slate',
};

/**
 * Patient Hub — the patient-centric home of the app. One patient's identity,
 * care plan, latest clinical note, and a unified visit/documentation
 * activity feed, all on one page.
 */
export function PatientProfilePage() {
  const clinic = useClinic();
  const { patientId } = useParams({ strict: false }) as { patientId: string };
  const [daysBack, setDaysBack] = useState<number | undefined>(undefined);

  const patient = useLiveQuery(() => repos.patients.get(patientId), [patientId]);
  const activity = useLiveQuery(
    () => patientActivityService.getActivityForPatient(clinic.id, patientId, daysBack),
    [clinic.id, patientId, daysBack]
  );
  const notes = useLiveQuery(
    () => repos.consultationNotes.list(clinic.id, patientId),
    [clinic.id, patientId]
  );
  const openPackages = useLiveQuery(() => dashboardService.openPackages(clinic.id), [clinic.id]);

  const latestNote = useMemo(() => sortByUpdated(notes)[0], [notes]);
  const patientPackages = useMemo(
    () => (openPackages ?? []).filter((p) => p.patientId === patientId),
    [openPackages, patientId]
  );

  if (!patient) {
    return (
      <div className="rounded-[10px] border border-[var(--border)] bg-[var(--surface)] p-8 text-sm text-[var(--muted)]">
        Patient not found (or not yet synced).
      </div>
    );
  }

  const initials = patient.name
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? '')
    .join('');

  const meta = [
    patient.age != null ? `${patient.age} yrs` : null,
    patient.sex,
    patient.phone,
  ].filter(Boolean);

  const referral = patient.referringSource
    ? [REFERRING_SOURCE_LABELS[patient.referringSource], patient.referringSourceDetail]
        .filter(Boolean)
        .join(' — ')
    : null;

  return (
    <div className="space-y-4">
      <Link to="/patients" className="text-xs font-medium text-[var(--muted)] hover:text-[var(--ink)]">
        ← All patients
      </Link>

      {/* Patient identity header */}
      <section className="rounded-[10px] border border-[var(--border)] bg-[var(--surface)] p-5">
        <div className="flex flex-wrap items-start gap-4">
          <div className="flex h-13 w-13 shrink-0 items-center justify-center rounded-xl bg-[var(--teal-light)] font-display text-lg font-semibold text-[var(--teal)]">
            {initials || '?'}
          </div>
          <div className="min-w-[12rem] flex-1">
            <h1 className="font-display text-xl font-semibold text-[var(--ink)]">{patient.name}</h1>
            <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-sm text-[var(--muted)]">
              <span>
                <span className="text-[var(--muted)]/70">MRN</span>{' '}
                <span className="font-num">{patient.mrno}</span>
              </span>
              {meta.length > 0 && <span className="font-num">{meta.join(' · ')}</span>}
              {referral && (
                <span>
                  <span className="text-[var(--muted)]/70">Ref</span> {referral}
                </span>
              )}
            </div>
            <div className="mt-2.5 flex flex-wrap gap-1.5">
              {patient.primaryCondition && (
                <span className="rounded-full bg-[var(--teal-light)] px-2.5 py-0.5 text-xs font-medium text-[var(--teal)]">
                  {patient.primaryCondition}
                </span>
              )}
              {patient.mrnoSource === 'auto' && <Pill tone="slate">walk-in</Pill>}
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Link to="/visits/new" className={btnPrimary}>
              New visit
            </Link>
          </div>
        </div>
      </section>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_20rem]">
        {/* Main column */}
        <div className="space-y-4">
          <SectionLabel>Recent activity</SectionLabel>
          <section className="rounded-[10px] border border-[var(--border)] bg-[var(--surface)] px-4 py-2">
            <div className="mb-1 flex flex-wrap gap-1.5 pt-2 text-xs">
              {[
                { label: 'Today', days: 1 },
                { label: 'This week', days: 7 },
                { label: 'This month', days: 30 },
                { label: 'All time', days: undefined },
              ].map((preset) => (
                <button
                  key={preset.label}
                  onClick={() => setDaysBack(preset.days)}
                  className={`rounded-full px-3 py-1 ${
                    daysBack === preset.days
                      ? 'bg-[var(--teal)] text-white'
                      : 'bg-[var(--paper)] text-[var(--muted)] hover:bg-[var(--border)]'
                  }`}
                >
                  {preset.label}
                </button>
              ))}
            </div>
            {!activity || activity.length === 0 ? (
              <p className="py-4 text-sm text-[var(--muted)]">No activity in this window.</p>
            ) : (
              <ul>
                {activity.map((item) => (
                  <li
                    key={`${item.kind}:${item.id}`}
                    className="grid grid-cols-[6rem_1fr] gap-3 border-t border-[var(--border)] py-2.5 first:border-t-0"
                  >
                    <span className="font-num pt-0.5 text-xs text-[var(--muted)]">
                      {formatDateDMY(item.at.slice(0, 10))}
                    </span>
                    <span className="flex flex-wrap items-center gap-2 text-sm text-[var(--ink)]">
                      <Pill tone={KIND_TONES[item.kind]}>{KIND_LABELS[item.kind]}</Pill>
                      {item.summary}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>

        {/* Side column */}
        <div className="space-y-4">
          <SideCard title="Care plan">
            {patientPackages.length === 0 ? (
              <p className="text-sm text-[var(--muted)]">No open package.</p>
            ) : (
              <ul className="space-y-3">
                {patientPackages.map((p) => {
                  const pct = Math.min(100, Math.round((p.sessionsLogged / p.packageTotal) * 100));
                  return (
                    <li key={p.packageGroupId}>
                      <div className="flex items-center justify-between text-sm font-medium text-[var(--ink)]">
                        <span>{p.serviceName}</span>
                        {p.stale && <Pill tone="amber">⚠ Stale</Pill>}
                      </div>
                      <div className="my-1.5 h-2 overflow-hidden rounded-full bg-[var(--paper)]">
                        <span
                          className="block h-full rounded-full bg-[var(--teal)]"
                          style={{ width: `${pct}%` }}
                        />
                      </div>
                      <div className="font-num flex justify-between text-xs text-[var(--muted)]">
                        <span>
                          {p.sessionsLogged} of {p.packageTotal} sessions
                        </span>
                        <span>last {formatDateDMY(p.lastVisitOn)}</span>
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </SideCard>

          <SideCard
            title="Latest note"
            action={
              latestNote ? (
                <span
                  className={`rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${
                    latestNote.status === 'completed'
                      ? 'bg-[var(--moss-light)] text-[var(--moss)]'
                      : 'bg-[var(--paper)] text-[var(--muted)]'
                  }`}
                >
                  {latestNote.status}
                </span>
              ) : undefined
            }
          >
            {!latestNote ? (
              <p className="text-sm text-[var(--muted)]">No consultation note yet.</p>
            ) : (
              <div className="space-y-2 text-sm text-[var(--ink)]">
                <p className="leading-relaxed">
                  {latestNote.notesText?.trim() || <span className="text-[var(--muted)]">No text recorded.</span>}
                </p>
                <div className="font-num flex flex-wrap gap-x-3 text-xs text-[var(--muted)]">
                  <span>{formatDateDMY(latestNote.updatedAt.slice(0, 10))}</span>
                  {latestNote.authorizedSessionCount != null && (
                    <span>{latestNote.authorizedSessionCount} sessions authorized</span>
                  )}
                </div>
              </div>
            )}
          </SideCard>
        </div>
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------- */

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div className="px-0.5 text-[11px] font-bold uppercase tracking-wider text-[var(--muted)]/80">
      {children}
    </div>
  );
}

function SideCard({
  title,
  action,
  children,
}: {
  title: string;
  action?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-[10px] border border-[var(--border)] bg-[var(--surface)] p-4">
      <div className="mb-2.5 flex items-center justify-between">
        <h3 className="font-display text-sm font-semibold text-[var(--ink)]">{title}</h3>
        {action}
      </div>
      {children}
    </section>
  );
}

/* -------------------------------------------------------------------------- */

function sortByUpdated<T extends { updatedAt: string }>(rows: T[] | undefined): T[] {
  return [...(rows ?? [])].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}
