import { useMemo } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { repos } from '@/services';
import { useClinic } from '@/app/clinicContext';
import { SectionCard } from '@/components/ui';
import { formatAmount } from '@/domain/money';
import { monthDateRange, monthName } from '@/domain/fiscalYear';
import { offersLocationChoice } from '@/domain/careLocations';
import { locationSplit, locationSplitLabel } from '@/domain/careLocationSplit';

/**
 * Visits and billed for one month, by place (Clinic / Home visit) and therapist. Counting only: it never changes
 * who earns what. Shown only when the clinic sees patients in more than one place.
 */
export function CareLocationSplitCard({ year, month }: { year: number; month: number }) {
  const clinic = useClinic();
  const on = offersLocationChoice(clinic);
  const visits = useLiveQuery(async () => {
    if (!on) return [];
    return repos.visits.list({ clinicId: clinic.id, ...monthDateRange({ year, month }) });
  }, [clinic.id, on, year, month]);
  const therapists = useLiveQuery(() => repos.therapists.list(clinic.id, true), [clinic.id]);
  const names = useMemo(() => new Map((therapists ?? []).map((t) => [t.id, t.name])), [therapists]);
  const split = useMemo(() => locationSplit(visits ?? []), [visits]);

  if (!on) return null;
  const visitsLabel = (n: number) => `${n} ${n === 1 ? 'visit' : 'visits'}`;
  const cols = split.places.length > 0 ? split.places : (['clinic', 'home'] as const);
  return (
    <SectionCard id="reports-by-place" title={`By place · ${monthName(month)} ${year}`}>
      {visits === undefined ? (
        <p className="text-sm text-[var(--muted)]">Loading…</p>
      ) : visits.length === 0 ? (
        <p className="text-sm text-[var(--muted)]">No visits this month.</p>
      ) : (
        <>
          {/* A phone has no room for a four-column table: one block per therapist, a line per place. */}
          <ul className="divide-y divide-[var(--border)] text-sm sm:hidden">
            {[
              ...split.rows.map((r) => ({
                key: r.therapistId,
                name: names.get(r.therapistId) ?? 'Therapist',
                places: r.places,
                total: r.total,
                bold: false,
              })),
              {
                key: 'all',
                name: 'All',
                places: split.totals,
                total: split.totals.all,
                bold: true,
              },
            ].map((r) => (
              <li key={r.key} className="py-2">
                <div
                  className={`flex justify-between gap-2 ${r.bold ? 'font-semibold' : 'font-medium'}`}
                >
                  <span className="min-w-0 truncate">{r.name}</span>
                  <span className="tabular-nums">{formatAmount(r.total.billedPaise)}</span>
                </div>
                <dl className="mt-0.5 space-y-0.5 text-xs text-[var(--muted)]">
                  {cols
                    .filter((l) => r.places[l])
                    .map((l) => (
                      <div key={l} className="flex justify-between gap-2">
                        <dt>{locationSplitLabel(l)}</dt>
                        <dd className="tabular-nums">
                          {formatAmount(r.places[l]?.billedPaise ?? 0)} ·{' '}
                          {visitsLabel(r.places[l]?.visits ?? 0)}
                        </dd>
                      </div>
                    ))}
                </dl>
              </li>
            ))}
          </ul>
          <div className="hidden overflow-x-auto sm:block">
            <table className="w-full min-w-[420px] text-sm">
              <thead>
                <tr className="text-left text-xs uppercase tracking-wide text-[var(--muted)]">
                  <th className="py-2 pr-3 font-semibold">Therapist</th>
                  {cols.map((l) => (
                    <th key={l} className="py-2 px-2 text-right font-semibold">
                      {locationSplitLabel(l)}
                    </th>
                  ))}
                  <th className="py-2 pl-2 text-right font-semibold">Total</th>
                </tr>
              </thead>
              <tbody>
                {split.rows.map((r) => (
                  <tr key={r.therapistId} className="border-t border-[var(--border)]">
                    <td className="py-2 pr-3">{names.get(r.therapistId) ?? 'Therapist'}</td>
                    {cols.map((l) => (
                      <td key={l} className="py-2 px-2 text-right tabular-nums">
                        {r.places[l] ? (
                          <>
                            {formatAmount(r.places[l].billedPaise)}
                            <span className="block text-xs text-[var(--muted)]">
                              {visitsLabel(r.places[l].visits)}
                            </span>
                          </>
                        ) : (
                          <span className="text-[var(--muted)]">–</span>
                        )}
                      </td>
                    ))}
                    <td className="py-2 pl-2 text-right font-semibold tabular-nums">
                      {formatAmount(r.total.billedPaise)}
                      <span className="block text-xs font-normal text-[var(--muted)]">
                        {visitsLabel(r.total.visits)}
                      </span>
                    </td>
                  </tr>
                ))}
                <tr className="border-t border-[var(--ink)] font-semibold">
                  <td className="py-2 pr-3">All</td>
                  {cols.map((l) => (
                    <td key={l} className="py-2 px-2 text-right tabular-nums">
                      {formatAmount(split.totals[l]?.billedPaise ?? 0)}
                      <span className="block text-xs font-normal text-[var(--muted)]">
                        {visitsLabel(split.totals[l]?.visits ?? 0)}
                      </span>
                    </td>
                  ))}
                  <td className="py-2 pl-2 text-right tabular-nums">
                    {formatAmount(split.totals.all.billedPaise)}
                    <span className="block text-xs font-normal text-[var(--muted)]">
                      {visitsLabel(split.totals.all.visits)}
                    </span>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </>
      )}
      <p className="mt-3 text-xs text-[var(--muted)]">
        Billed amounts only. Visits saved before locations were added count as Clinic.
      </p>
    </SectionCard>
  );
}
