import { useMemo, useState } from 'react';
import { initialsFor } from '@/app/accountInitials';
import { formatINR } from '@/domain/money';
import { publicTherapistPhotoUrl } from '@/lib/supabase';
import type { Utilisation } from '@/domain/utilisation';
import type { TherapistStatus } from '@/domain/therapistStatus';

export const STATUS_LABEL: Record<TherapistStatus, string> = {
  strong: 'Strong',
  steady: 'Steady',
  attention: 'Needs attention',
  insufficient: 'Not enough data',
};

export const STATUS_STYLE: Record<TherapistStatus, string> = {
  strong: 'bg-[var(--teal-light)] text-[var(--teal-strong)]',
  steady: 'bg-[var(--paper)] text-[var(--ink)]',
  attention: 'bg-[var(--rust)]/10 text-[var(--rust)]',
  insufficient: 'bg-[var(--paper)] text-[var(--muted)]',
};

function PractitionerAvatar({ name, photoPath }: { name: string; photoPath?: string | null }) {
  const [hasError, setHasError] = useState(false);
  const photoUrl = photoPath ? publicTherapistPhotoUrl(photoPath) : null;

  if (photoUrl && !hasError) {
    return (
      <img
        src={photoUrl}
        alt=""
        onError={() => setHasError(true)}
        className="h-9 w-9 shrink-0 rounded-full object-cover ring-1 ring-[var(--border)]"
      />
    );
  }

  return (
    <div
      aria-hidden="true"
      className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[var(--teal-light)] font-display text-xs font-semibold text-[var(--teal-strong)] ring-1 ring-[var(--border)]"
    >
      {initialsFor(name)}
    </div>
  );
}

export type PractitionerPerformanceRow = {
  therapistId: string;
  name: string;
  photoPath?: string | null;
  utilisation: Utilisation;
  visitCount: number;
  revenuePaise: number;
  priorRatio?: number | null;
  status?: TherapistStatus;
  reason?: string;
};

type SortKey = 'name' | 'utilisation' | 'revenue' | 'visits';
type SortOrder = 'asc' | 'desc';

export function PractitionerPerformanceTable({
  rows,
  onSelectTherapist,
  selectedTherapistId,
}: {
  rows: PractitionerPerformanceRow[];
  onSelectTherapist?: (id: string | null) => void;
  selectedTherapistId?: string | null;
}) {
  const [sortKey, setSortKey] = useState<SortKey>('utilisation');
  const [sortOrder, setSortOrder] = useState<SortOrder>('desc');

  const handleHeaderClick = (key: SortKey) => {
    if (sortKey === key) {
      setSortOrder(sortOrder === 'asc' ? 'desc' : 'asc');
    } else {
      setSortKey(key);
      setSortOrder('desc');
    }
  };

  const totals = useMemo(() => {
    const totalRevenue = rows.reduce((s, r) => s + r.revenuePaise, 0);
    const totalVisits = rows.reduce((s, r) => s + r.visitCount, 0);
    const totalWorkedMinutes = rows.reduce((s, r) => s + (r.utilisation.workedMinutes ?? 0), 0);
    const totalAvailableMinutes = rows.reduce((s, r) => s + (r.utilisation.availableMinutes ?? 0), 0);
    const avgRatio = totalAvailableMinutes > 0 ? totalWorkedMinutes / totalAvailableMinutes : null;
    return {
      revenuePaise: totalRevenue,
      visitCount: totalVisits,
      avgRatio,
    };
  }, [rows]);

  const sortedRows = useMemo(() => {
    const list = [...rows];
    list.sort((a, b) => {
      let cmp = 0;
      switch (sortKey) {
        case 'name':
          cmp = a.name.localeCompare(b.name);
          break;
        case 'utilisation': {
          const ratioA = a.utilisation.ratio ?? -1;
          const ratioB = b.utilisation.ratio ?? -1;
          cmp = ratioA - ratioB;
          break;
        }
        case 'revenue':
          cmp = a.revenuePaise - b.revenuePaise;
          break;
        case 'visits':
          cmp = a.visitCount - b.visitCount;
          break;
      }
      return sortOrder === 'asc' ? cmp : -cmp;
    });
    return list;
  }, [rows, sortKey, sortOrder]);

  const renderSortIndicator = (key: SortKey) => {
    if (sortKey !== key) {
      return <span className="opacity-0 group-hover:opacity-40 transition-opacity">↕</span>;
    }
    return <span>{sortOrder === 'asc' ? '▲' : '▼'}</span>;
  };

  const hasClinicHoursFallback = rows.some((r) => r.utilisation.usesClinicHours);

  return (
    <div className="overflow-hidden rounded-2xl border border-[var(--border)] bg-[var(--surface)] shadow-xs">
      <div className="overflow-x-auto overscroll-x-contain">
        <table className="min-w-full divide-y divide-[var(--border)] text-sm">
          <thead className="bg-[var(--paper)] text-[11px] font-semibold uppercase tracking-wider text-[var(--muted)]">
            <tr>
              <th scope="col" className="px-4 py-3 text-left">
                <button
                  type="button"
                  onClick={() => handleHeaderClick('name')}
                  className="group inline-flex items-center gap-1 font-semibold hover:text-[var(--ink)] focus:outline-hidden"
                >
                  Practitioner {renderSortIndicator('name')}
                </button>
              </th>
              <th scope="col" className="px-4 py-3 text-left">
                <button
                  type="button"
                  onClick={() => handleHeaderClick('utilisation')}
                  className="group inline-flex items-center gap-1 font-semibold hover:text-[var(--ink)] focus:outline-hidden"
                >
                  Utilisation Rate {renderSortIndicator('utilisation')}
                </button>
              </th>
              <th scope="col" className="px-4 py-3 text-right">
                <button
                  type="button"
                  onClick={() => handleHeaderClick('revenue')}
                  className="group inline-flex items-center gap-1 font-semibold hover:text-[var(--ink)] focus:outline-hidden ml-auto"
                >
                  Revenue {renderSortIndicator('revenue')}
                </button>
              </th>
              <th scope="col" className="px-4 py-3 text-right">
                <button
                  type="button"
                  onClick={() => handleHeaderClick('visits')}
                  className="group inline-flex items-center gap-1 font-semibold hover:text-[var(--ink)] focus:outline-hidden ml-auto"
                >
                  Visits {renderSortIndicator('visits')}
                </button>
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[var(--border)] bg-[var(--surface)]">
            {sortedRows.map((row) => {
              const ratio = row.utilisation.ratio;
              const roundedPct = ratio != null ? Math.round(ratio * 100) : 0;
              const deltaPts =
                ratio != null && row.priorRatio != null
                  ? Math.round((ratio - row.priorRatio) * 100)
                  : null;

              // Color token for progress bar
              const barColor =
                ratio == null
                  ? 'bg-[var(--muted)]'
                  : ratio >= 0.7
                    ? 'bg-[var(--teal)]'
                    : ratio >= 0.5
                      ? 'bg-[#d97706]'
                      : 'bg-[var(--rust)]';

              const isSelected = selectedTherapistId === row.therapistId;

              return (
                <tr
                  key={row.therapistId}
                  onClick={() => onSelectTherapist?.(row.therapistId)}
                  className={`transition-colors ${
                    isSelected
                      ? 'bg-[var(--teal-light)]/25'
                      : 'hover:bg-[var(--paper)]/50'
                  } ${onSelectTherapist ? 'cursor-pointer' : ''}`}
                >
                  {/* Practitioner info with avatar & status */}
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-3">
                      <PractitionerAvatar name={row.name} photoPath={row.photoPath} />
                      <div>
                        <div
                          data-testid="therapist-name"
                          className="font-medium text-[var(--ink)]"
                        >
                          {row.name}
                        </div>
                        {row.status && (
                          <div className="mt-0.5 flex items-center gap-1.5">
                            <span
                              className={`inline-block rounded-full px-2 py-0.5 text-[10px] font-semibold ${
                                STATUS_STYLE[row.status]
                              }`}
                            >
                              {STATUS_LABEL[row.status]}
                            </span>
                            {row.reason && (
                              <span className="hidden sm:inline text-[11px] text-[var(--muted)]">
                                · {row.reason}
                              </span>
                            )}
                          </div>
                        )}
                      </div>
                    </div>
                  </td>

                  {/* Utilisation progress bar + percentage */}
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-3">
                      <div
                        role="progressbar"
                        aria-valuenow={roundedPct}
                        aria-valuemin={0}
                        aria-valuemax={100}
                        className="h-2 w-20 sm:w-28 rounded-full bg-[var(--paper)] overflow-hidden shrink-0"
                      >
                        <div
                          className={`h-full rounded-full transition-all ${barColor}`}
                          style={{ width: `${Math.min(100, Math.max(3, roundedPct))}%` }}
                        />
                      </div>
                      <div className="flex flex-col">
                        <span className="font-num text-xs font-semibold text-[var(--ink)]">
                          {ratio != null ? `${roundedPct}%` : '—'}
                          {ratio != null && row.utilisation.usesClinicHours ? '*' : ''}
                        </span>
                        {deltaPts != null && (
                          <span
                            className={`font-num text-[10px] ${
                              deltaPts >= 0 ? 'text-[var(--teal)]' : 'text-[var(--rust)]'
                            }`}
                          >
                            {deltaPts >= 0 ? `+${deltaPts}` : deltaPts} pts
                          </span>
                        )}
                      </div>
                    </div>
                  </td>

                  {/* Formatted revenue */}
                  <td className="font-num px-4 py-3 text-right font-medium text-[var(--ink)]">
                    {formatINR(row.revenuePaise)}
                  </td>

                  {/* Visit count */}
                  <td className="font-num px-4 py-3 text-right text-[var(--ink)]">
                    {row.visitCount}
                  </td>
                </tr>
              );
            })}
          </tbody>
          {rows.length > 0 && (
            <tfoot className="border-t-2 border-[var(--border)] bg-[var(--paper)] font-semibold text-sm">
              <tr>
                <td className="px-4 py-3 font-semibold text-[var(--ink)]">
                  Clinic Total
                </td>
                <td className="px-4 py-3">
                  <span className="font-num text-xs font-semibold text-[var(--ink)]">
                    {totals.avgRatio != null ? `${Math.round(totals.avgRatio * 100)}% clinic avg` : '—'}
                  </span>
                </td>
                <td className="font-num px-4 py-3 text-right font-bold text-[var(--ink)]">
                  {formatINR(totals.revenuePaise)}
                </td>
                <td className="font-num px-4 py-3 text-right font-bold text-[var(--ink)]">
                  {totals.visitCount}
                </td>
              </tr>
            </tfoot>
          )}
        </table>
      </div>

      {hasClinicHoursFallback && (
        <div className="border-t border-[var(--border)] bg-[var(--paper)]/40 px-4 py-2 text-[11px] text-[var(--muted)]">
          * No personal working hours configured. Standard clinic booking hours were used as available time.
        </div>
      )}
    </div>
  );
}
