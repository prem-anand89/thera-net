import { notify } from '@/components/notify';
import { useMemo, useState } from 'react';
import { Link } from '@tanstack/react-router';
import { formatDateDMY } from '@/domain/fiscalYear';
import { feedbackService } from '@/services';
import type { NoReturnReasonItem } from '@/domain/types';
import type { SingleVisitPatientRow } from '@/services/dashboardService';
import { SectionCard, Pill } from '@/components/ui';
import { ShowMoreFooter, useShowMore } from '@/components/ShowMore';

type TriageFilter = 'all' | 'needs_review' | 'logged' | 'closed';

export interface SingleVisitPatientsCardProps {
  patients: SingleVisitPatientRow[] | undefined;
  noReturnReasons: NoReturnReasonItem[] | undefined;
  onSetPatientReason: (patientId: string, reasonId: string) => Promise<void>;
  onToggleReasonActive: (item: NoReturnReasonItem) => Promise<void>;
  onAddReason: (name: string, isClosed: boolean) => Promise<void>;
  enablePatientComms?: boolean;
  clinicId: string;
  clinicName: string;
  sectionRefCallback?: (el: HTMLDivElement | null) => void;
  /** Controls collapsible state. If omitted, uses defaultExpanded. */
  expanded?: boolean;
  onExpandedChange?: (expanded: boolean) => void;
  defaultExpanded?: boolean;
}

export function SingleVisitPatientsCard({
  patients,
  noReturnReasons,
  onSetPatientReason,
  onToggleReasonActive,
  onAddReason,
  enablePatientComms = false,
  clinicId,
  clinicName,
  sectionRefCallback,
  expanded: expandedProp,
  onExpandedChange,
  defaultExpanded = true,
}: SingleVisitPatientsCardProps) {
  const [internalExpanded, setInternalExpanded] = useState(defaultExpanded);
  const isExpanded = expandedProp !== undefined ? expandedProp : internalExpanded;
  const setIsExpanded = onExpandedChange ?? setInternalExpanded;

  const [filter, setFilter] = useState<TriageFilter>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [manageReasonsOpen, setManageReasonsOpen] = useState(false);
  const [reasonDraftName, setReasonDraftName] = useState('');
  const [reasonDraftClosed, setReasonDraftClosed] = useState(false);
  const [isSubmittingReason, setIsSubmittingReason] = useState(false);

  const allRows = useMemo(() => patients ?? [], [patients]);

  // Triage counts
  const counts = useMemo(() => {
    let needsReview = 0;
    let logged = 0;
    let closed = 0;
    for (const p of allRows) {
      if (!p.noReturnReasonId) {
        needsReview++;
      } else if (p.noReturnReasonClosed) {
        closed++;
      } else {
        logged++;
      }
    }
    return {
      all: allRows.length,
      needsReview,
      logged,
      closed,
    };
  }, [allRows]);

  // Filtered rows
  const filteredRows = useMemo(() => {
    let rows = allRows;

    // Apply triage status filter
    if (filter === 'needs_review') {
      rows = rows.filter((p) => !p.noReturnReasonId);
    } else if (filter === 'logged') {
      rows = rows.filter((p) => p.noReturnReasonId && !p.noReturnReasonClosed);
    } else if (filter === 'closed') {
      rows = rows.filter((p) => p.noReturnReasonClosed);
    }

    // Apply search filter
    const query = searchQuery.trim().toLowerCase();
    if (query) {
      rows = rows.filter((p) => {
        const nameMatch = p.patientName.toLowerCase().includes(query);
        const mrnoMatch = p.mrno.toLowerCase().includes(query);
        const condMatch = p.primaryCondition?.toLowerCase().includes(query) ?? false;
        const serviceMatch = p.serviceName.toLowerCase().includes(query);
        const reasonMatch = p.noReturnReasonName?.toLowerCase().includes(query) ?? false;
        return nameMatch || mrnoMatch || condMatch || serviceMatch || reasonMatch;
      });
    }

    return rows;
  }, [allRows, filter, searchQuery]);

  const list = useShowMore(filteredRows, `${filter}|${searchQuery}`, 5);

  async function handleAddReasonSubmit(e: React.FormEvent) {
    e.preventDefault();
    const name = reasonDraftName.trim();
    if (!name || isSubmittingReason) return;
    try {
      setIsSubmittingReason(true);
      await onAddReason(name, reasonDraftClosed);
      setReasonDraftName('');
      setReasonDraftClosed(false);
    } finally {
      setIsSubmittingReason(false);
    }
  }

  function getRecencyBadge(days: number) {
    if (days <= 30) {
      return (
        <span className="font-num rounded-md bg-[var(--surface)] px-1.5 py-0.5 text-[11px] font-medium text-[var(--muted)] border border-[var(--border)]">
          {days}d ago
        </span>
      );
    }
    if (days <= 60) {
      return (
        <span className="font-num rounded-md bg-[var(--amber-light)] px-1.5 py-0.5 text-[11px] font-medium text-[var(--amber)]">
          {days}d ago
        </span>
      );
    }
    return (
      <span className="font-num rounded-md bg-[var(--rust-light)] px-1.5 py-0.5 text-[11px] font-medium text-[var(--rust)]">
        {days}d ago
      </span>
    );
  }

  return (
    <div
      ref={sectionRefCallback}
      className="scroll-mt-28 md:scroll-mt-20"
    >
      <SectionCard
        title="Single-visit patients"
        action={
          allRows.length > 0 ? (
            <div className="shrink-0 rounded-lg border border-[var(--border)] bg-[var(--surface)] px-2.5 py-1 text-right">
              <div className="text-[9px] font-medium uppercase leading-tight tracking-wide text-[var(--muted)]">
                Single visits
              </div>
              <div className="font-num text-sm font-semibold leading-tight text-[var(--ink)]">
                {allRows.length}
              </div>
            </div>
          ) : undefined
        }
      >
        {/* Collapsed State: Executive Triage Summary */}
        {!isExpanded && allRows.length > 0 && (
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
            <div>
              <p className="text-xs text-[var(--muted)]">
                {allRows.length} patients with exactly 1 completed visit &gt; 14 days ago. Review retention or conduct outreach:
              </p>
              <div className="mt-2.5 flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={() => {
                    setFilter('needs_review');
                    setIsExpanded(true);
                  }}
                  className="inline-flex items-center gap-1.5 rounded-full border border-[var(--rust)]/30 bg-[var(--rust-light)] px-3 py-1 text-xs font-semibold text-[var(--rust)] shadow-2xs hover:bg-[var(--rust)] hover:text-white transition-colors cursor-pointer"
                  title="Filter to patients needing review"
                >
                  <span className="h-1.5 w-1.5 rounded-full bg-[var(--rust)]" aria-hidden="true" />
                  <span>{counts.needsReview} Need review</span>
                </button>

                <button
                  type="button"
                  onClick={() => {
                    setFilter('logged');
                    setIsExpanded(true);
                  }}
                  className="inline-flex items-center gap-1.5 rounded-full border border-[#d97706]/30 bg-[var(--amber-light)] px-3 py-1 text-xs font-semibold text-[#b45309] shadow-2xs hover:bg-[#d97706] hover:text-white transition-colors cursor-pointer"
                  title="Filter to patients with reason logged"
                >
                  <span className="h-1.5 w-1.5 rounded-full bg-[#d97706]" aria-hidden="true" />
                  <span>{counts.logged} Reason logged</span>
                </button>

                <button
                  type="button"
                  onClick={() => {
                    setFilter('closed');
                    setIsExpanded(true);
                  }}
                  className="inline-flex items-center gap-1.5 rounded-full border border-[var(--teal)]/30 bg-[var(--teal-light)] px-3 py-1 text-xs font-semibold text-[var(--teal-strong)] shadow-2xs hover:bg-[var(--teal)] hover:text-white transition-colors cursor-pointer"
                  title="Filter to resolved/closed dropouts"
                >
                  <span className="h-1.5 w-1.5 rounded-full bg-[var(--teal)]" aria-hidden="true" />
                  <span>{counts.closed} Resolved</span>
                </button>
              </div>
            </div>

            <div className="flex items-center gap-2 self-start sm:self-auto shrink-0">
              <button
                type="button"
                onClick={() => setIsExpanded(true)}
                className="inline-flex min-h-9 items-center gap-1.5 rounded-xl border border-[var(--border)] bg-[var(--paper)] px-3.5 py-1.5 text-xs font-semibold text-[var(--ink)] shadow-2xs hover:bg-[var(--surface)] hover:border-[var(--teal)] hover:text-[var(--teal)] transition-colors cursor-pointer"
              >
                <span>Review patients ({allRows.length})</span>
                <span aria-hidden="true">▾</span>
              </button>
            </div>
          </div>
        )}

        {/* Expanded State (or empty/loading states) */}
        {(isExpanded || allRows.length === 0 || patients === undefined) && (
          <div>
            {/* Helper copy & Manage reasons trigger */}
            {allRows.length > 0 && (
              <div className="mb-4 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2.5 pb-3 border-b border-[var(--border)]">
                <p className="text-xs text-[var(--muted)] leading-relaxed">
                  Patients with exactly one completed visit, more than 14 days ago. Review retention, call or send reminders, and categorize dropouts to improve clinic return rates.
                </p>
                <div className="flex items-center gap-3 self-start sm:self-auto shrink-0">
                  <button
                    type="button"
                    onClick={() => setManageReasonsOpen((o) => !o)}
                    className="text-xs font-semibold text-[var(--teal)] hover:text-[var(--teal-strong)] hover:underline transition-colors cursor-pointer"
                  >
                    {manageReasonsOpen ? 'Hide reason settings' : 'Manage reasons'}
                  </button>
                  <button
                    type="button"
                    onClick={() => setIsExpanded(false)}
                    className="inline-flex min-h-8 items-center gap-1.5 rounded-xl border border-[var(--border)] bg-[var(--paper)] px-3 py-1 text-xs font-semibold text-[var(--muted)] hover:text-[var(--ink)] shadow-2xs hover:bg-[var(--surface)] transition-colors cursor-pointer"
                  >
                    <span>Collapse list</span>
                    <span aria-hidden="true">▴</span>
                  </button>
                </div>
              </div>
            )}

        {/* Expandable Manage Reasons Panel */}
        {manageReasonsOpen && (
          <div className="mb-5 rounded-2xl border border-[var(--border)] bg-[var(--paper)] p-4 shadow-inner">
            <div className="mb-2.5 flex items-baseline justify-between">
              <h4 className="text-xs font-semibold uppercase tracking-wider text-[var(--ink)]">
                Non-return reasons catalog
              </h4>
              <span className="text-[11px] text-[var(--muted)]">
                Marking "Counts as closed" archives patients who completed care or relocated.
              </span>
            </div>

            <div className="mb-3.5 flex flex-wrap gap-1.5">
              {(noReturnReasons ?? []).map((r) => (
                <span
                  key={r.id}
                  className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs transition-all ${r.active
                      ? 'border-[var(--border)] bg-[var(--surface)] text-[var(--ink)]'
                      : 'border-[var(--border)] bg-[var(--paper)] text-[var(--muted)] opacity-50 line-through'
                    }`}
                >
                  <span className="font-medium">{r.name}</span>
                  {r.isClosed && (
                    <span className="rounded bg-[var(--moss-light)] px-1 py-0.2 text-[10px] font-semibold text-[var(--moss-strong)]">
                      closed
                    </span>
                  )}
                  <button
                    type="button"
                    onClick={() => void onToggleReasonActive(r)}
                    className="ml-0.5 rounded-full p-0.5 text-[var(--muted)] hover:bg-[var(--border)] hover:text-[var(--ink)]"
                    title={r.active ? 'Deactivate reason' : 'Reactivate reason'}
                  >
                    {r.active ? '✕' : '+'}
                  </button>
                </span>
              ))}
            </div>

            <form onSubmit={handleAddReasonSubmit} className="flex flex-wrap items-center gap-2.5">
              <input
                type="text"
                value={reasonDraftName}
                onChange={(e) => setReasonDraftName(e.target.value)}
                placeholder="New reason name (e.g. Relocated, Treatment complete)…"
                className="min-w-0 flex-1 rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3 py-1.5 text-xs text-[var(--ink)] focus:border-[var(--teal)] focus:outline-hidden"
              />
              <label className="flex items-center gap-1.5 text-xs text-[var(--muted)] cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={reasonDraftClosed}
                  onChange={(e) => setReasonDraftClosed(e.target.checked)}
                  className="rounded border-[var(--border)] text-[var(--teal)] focus:ring-[var(--teal)]"
                />
                Counts as closed
              </label>
              <button
                type="submit"
                disabled={!reasonDraftName.trim() || isSubmittingReason}
                className="rounded-xl bg-[var(--teal)] px-3.5 py-1.5 text-xs font-semibold text-white shadow-xs hover:bg-[var(--teal-strong)] disabled:opacity-40 transition-colors"
              >
                + Add reason
              </button>
            </form>
          </div>
        )}

        {/* Triage Status Chips & Search Bar */}
        <div className="mb-4 flex flex-col md:flex-row md:items-center md:justify-between gap-3">
          {/* Triage filter pills */}
          <div className="flex flex-wrap items-center gap-1.5">
            <button
              type="button"
              onClick={() => setFilter('all')}
              className={`rounded-full px-3 py-1 text-xs font-medium cursor-pointer transition-colors ${filter === 'all'
                  ? 'bg-[var(--ink)] text-white shadow-xs'
                  : 'bg-[var(--surface)] text-[var(--muted)] border border-[var(--border)] hover:bg-[var(--paper)]'
                }`}
            >
              All ({counts.all})
            </button>
            <button
              type="button"
              onClick={() => setFilter('needs_review')}
              className={`rounded-full px-3 py-1 text-xs font-medium cursor-pointer transition-colors ${filter === 'needs_review'
                  ? 'bg-[var(--rust)] text-white shadow-xs'
                  : 'bg-[var(--surface)] text-[var(--rust)] border border-[var(--rust)]/30 hover:bg-[var(--rust-light)]'
                }`}
            >
              Needs review ({counts.needsReview})
            </button>
            <button
              type="button"
              onClick={() => setFilter('logged')}
              className={`rounded-full px-3 py-1 text-xs font-medium cursor-pointer transition-colors ${filter === 'logged'
                  ? 'bg-[#d97706] text-white shadow-xs'
                  : 'bg-[var(--surface)] text-[#d97706] border border-[#d97706]/30 hover:bg-[var(--amber-light)]'
                }`}
            >
              Reason logged ({counts.logged})
            </button>
            <button
              type="button"
              onClick={() => setFilter('closed')}
              className={`rounded-full px-3 py-1 text-xs font-medium cursor-pointer transition-colors ${filter === 'closed'
                  ? 'bg-[var(--teal)] text-white shadow-xs'
                  : 'bg-[var(--surface)] text-[var(--teal-strong)] border border-[var(--teal)]/30 hover:bg-[var(--teal-light)]'
                }`}
            >
              Closed / Resolved ({counts.closed})
            </button>
          </div>

          {/* Search box */}
          <div className="relative w-full md:w-64">
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search patient, MRNO, condition…"
              className="w-full rounded-full border border-[var(--border)] bg-[var(--surface)] py-1.5 pl-8 pr-7 text-xs text-[var(--ink)] placeholder:text-[var(--muted)] focus:border-[var(--teal)] focus:outline-hidden"
            />
            <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-xs text-[var(--muted)] pointer-events-none">
              🔍
            </span>
            {searchQuery && (
              <button
                type="button"
                onClick={() => setSearchQuery('')}
                className="absolute right-2 top-1/2 -translate-y-1/2 rounded-full px-1 text-xs text-[var(--muted)] hover:text-[var(--ink)]"
              >
                ✕
              </button>
            )}
          </div>
        </div>

        {/* Content Table or Empty State */}
        {patients === undefined ? (
          <div className="py-8 text-center text-xs text-[var(--muted)]">Loading patients…</div>
        ) : allRows.length === 0 ? (
          <div className="py-10 text-center">
            <div className="text-2xl mb-1">🎉</div>
            <p className="text-sm font-medium text-[var(--ink)]">No single-visit dropouts</p>
            <p className="mt-1 text-xs text-[var(--muted)]">
              All patients with visits older than 14 days have returned or have ongoing care.
            </p>
          </div>
        ) : filteredRows.length === 0 ? (
          <div className="py-8 text-center text-xs text-[var(--muted)]">
            No patients match the current filter or search criteria.
          </div>
        ) : (
          <div className="overflow-hidden rounded-2xl border border-[var(--border)] bg-[var(--surface)] shadow-xs">
            {/* Desktop / Tablet Table */}
            <div className="hidden md:block overflow-x-auto overscroll-x-contain">
              <table className="min-w-full divide-y divide-[var(--border)] text-sm">
                <thead className="bg-[var(--paper)] text-[11px] font-semibold uppercase tracking-wider text-[var(--muted)]">
                  <tr>
                    <th scope="col" className="px-4 py-3 text-left">
                      Patient
                    </th>
                    <th scope="col" className="px-4 py-3 text-left">
                      Last Visit
                    </th>
                    <th scope="col" className="px-4 py-3 text-left">
                      Clinical Condition
                    </th>
                    <th scope="col" className="px-4 py-3 text-left">
                      Retention Reason
                    </th>
                    <th scope="col" className="px-4 py-3 text-right">
                      Contact & Outreach
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[var(--border)] bg-[var(--surface)]">
                  {list.visible.map((p) => (
                    <tr key={p.patientId} className="hover:bg-[var(--paper)]/50 transition-colors">
                      {/* Patient */}
                      <td className="px-4 py-3">
                        <div className="min-w-0">
                          <Link
                            to="/ledger"
                            search={{ patientId: p.patientId }}
                            className="font-medium text-[var(--ink)] hover:text-[var(--teal)] hover:underline"
                          >
                            {p.patientName}
                          </Link>
                          <div className="mt-0.5 text-xs font-num font-mono text-[var(--muted)]">
                            {p.mrno}
                          </div>
                        </div>
                      </td>

                      {/* Last Visit & Recency */}
                      <td className="px-4 py-3 whitespace-nowrap">
                        <div className="flex items-center gap-2">
                          <span className="font-num text-xs text-[var(--ink)]">
                            {formatDateDMY(p.visitDate)}
                          </span>
                          {getRecencyBadge(p.daysSince)}
                        </div>
                      </td>

                      {/* Clinical Condition */}
                      <td className="px-4 py-3">
                        {p.primaryCondition ? (
                          <Pill tone="slate">{p.primaryCondition}</Pill>
                        ) : (
                          <span className="text-xs text-[var(--muted)]">—</span>
                        )}
                      </td>

                      {/* Reason / Status dropdown */}
                      <td className="px-4 py-3">
                        <select
                          value={p.noReturnReasonId ?? ''}
                          onChange={(e) => void onSetPatientReason(p.patientId, e.target.value)}
                          className={`rounded-full border px-2.5 py-1 text-xs font-semibold cursor-pointer transition-colors focus:outline-hidden ${p.noReturnReasonName
                              ? p.noReturnReasonClosed
                                ? 'bg-[var(--moss-light)] text-[var(--moss-strong)] border-transparent'
                                : 'bg-[var(--amber-light)] text-[#b45309] border-transparent'
                              : 'bg-[var(--surface)] text-[var(--muted)] border-dashed border-[var(--border)] hover:border-[var(--teal)]'
                            }`}
                        >
                          <option value="">+ Log reason</option>
                          {(noReturnReasons ?? [])
                            .filter((r) => r.active || r.id === p.noReturnReasonId)
                            .map((r) => (
                              <option key={r.id} value={r.id}>
                                {r.isClosed ? `✓ ${r.name} (closed)` : r.name}
                              </option>
                            ))}
                        </select>
                      </td>

                      {/* Contact & Actions */}
                      <td className="px-4 py-3 text-right whitespace-nowrap">
                        <div className="flex items-center justify-end gap-1.5">
                          {p.phone ? (
                            <a
                              href={`tel:${p.phone}`}
                              className="inline-flex items-center gap-1 rounded-full border border-[var(--border)] bg-[var(--surface)] px-2.5 py-1 text-xs font-semibold text-[var(--teal)] hover:bg-[var(--paper)] transition-colors"
                            >
                              📞 {p.phone}
                            </a>
                          ) : (
                            <span className="text-xs text-[var(--muted)]">No phone</span>
                          )}

                          {enablePatientComms && p.phone && (
                            <button
                              type="button"
                              className="rounded-full bg-[var(--teal-light)] px-2.5 py-1 text-xs font-semibold text-[var(--teal-strong)] hover:bg-[var(--teal)] hover:text-white transition-colors"
                              onClick={() => {
                                void feedbackService
                                  .sendReturnReminder(clinicId, p.patientName, p.phone!, clinicName)
                                  .catch((e) =>
                                    notify.error(e instanceof Error ? e.message : String(e))
                                  );
                              }}
                            >
                              Send reminder
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Mobile Cards (< md) */}
            <div className="md:hidden divide-y divide-[var(--border)] bg-[var(--surface)]">
              {list.visible.map((p) => (
                <div key={p.patientId} className="p-4 space-y-3">
                  {/* Row 1: Patient Name, MRNO and Recency Badge */}
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <Link
                        to="/ledger"
                        search={{ patientId: p.patientId }}
                        className="text-sm font-semibold text-[var(--ink)] hover:text-[var(--teal)] hover:underline block truncate"
                      >
                        {p.patientName}
                      </Link>
                      <div className="mt-0.5 text-xs font-mono font-medium text-[var(--muted)]">
                        {p.mrno}
                      </div>
                    </div>
                    <div className="shrink-0">{getRecencyBadge(p.daysSince)}</div>
                  </div>

                  {/* Row 2: Last Visit & Condition */}
                  <div className="flex items-center justify-between gap-2 text-xs">
                    <span className="text-[var(--muted)]">
                      Last visit:{' '}
                      <strong className="font-normal text-[var(--ink)]">
                        {formatDateDMY(p.visitDate)}
                      </strong>
                    </span>
                    {p.primaryCondition ? (
                      <Pill tone="slate">{p.primaryCondition}</Pill>
                    ) : (
                      <span className="text-xs text-[var(--muted)]">—</span>
                    )}
                  </div>

                  {/* Row 3: Action Toolbar (Reason Dropdown + Call + Remind) */}
                  <div className="space-y-2 pt-2 border-t border-[var(--border)]/60">
                    {/* Reason Selector */}
                    <div className="relative">
                      <select
                        value={p.noReturnReasonId ?? ''}
                        onChange={(e) => void onSetPatientReason(p.patientId, e.target.value)}
                        className={`w-full appearance-none rounded-xl border px-3 py-2 pr-8 text-xs cursor-pointer transition-colors focus:outline-hidden ${
                          p.noReturnReasonName
                            ? p.noReturnReasonClosed
                              ? 'bg-[var(--moss-light)] text-[var(--moss-strong)] border-[var(--moss)]/30 font-semibold'
                              : 'bg-[var(--amber-light)] text-[#b45309] border-[var(--amber)]/30 font-semibold'
                            : 'bg-[var(--paper)] text-[var(--muted)] border-dashed border-[var(--border)] hover:border-[var(--teal)] font-medium'
                        }`}
                      >
                        <option value="">+ Log non-return reason…</option>
                        {(noReturnReasons ?? [])
                          .filter((r) => r.active || r.id === p.noReturnReasonId)
                          .map((r) => (
                            <option key={r.id} value={r.id}>
                              {r.isClosed ? `✓ ${r.name} (closed)` : r.name}
                            </option>
                          ))}
                      </select>
                      <span
                        className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-xs text-[var(--muted)]"
                        aria-hidden="true"
                      >
                        ▾
                      </span>
                    </div>

                    {/* Quick Outreach Actions */}
                    <div className="flex items-center gap-2">
                      {p.phone ? (
                        <a
                          href={`tel:${p.phone}`}
                          className="flex-1 min-h-9 inline-flex items-center justify-center gap-1.5 rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3 py-1.5 text-xs font-semibold text-[var(--teal)] shadow-2xs hover:bg-[var(--paper)] active:bg-[var(--paper)] transition-colors whitespace-nowrap"
                        >
                          <span aria-hidden="true">📞</span>
                          <span>Call</span>
                        </a>
                      ) : (
                        <div className="flex-1 min-h-9 inline-flex items-center justify-center rounded-xl border border-dashed border-[var(--border)] bg-[var(--paper)]/50 px-3 py-1.5 text-xs text-[var(--muted)]">
                          No phone
                        </div>
                      )}

                      {enablePatientComms && p.phone && (
                        <button
                          type="button"
                          className="flex-1 min-h-9 inline-flex items-center justify-center gap-1.5 rounded-xl bg-[var(--teal-light)] px-3 py-1.5 text-xs font-semibold text-[var(--teal-strong)] shadow-2xs hover:bg-[var(--teal)] hover:text-white active:bg-[var(--teal-strong)] active:text-white transition-colors whitespace-nowrap cursor-pointer"
                          onClick={() => {
                            void feedbackService
                              .sendReturnReminder(clinicId, p.patientName, p.phone!, clinicName)
                              .catch((e) =>
                                notify.error(e instanceof Error ? e.message : String(e))
                              );
                          }}
                        >
                          <span aria-hidden="true">💬</span>
                          <span>Remind</span>
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </div>

            <ShowMoreFooter list={list} noun="patients" />
          </div>
        )}
          </div>
        )}
      </SectionCard>
    </div>
  );
}
