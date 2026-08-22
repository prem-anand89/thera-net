import { useCallback, useEffect } from 'react';
import { useNavigate, useSearch } from '@tanstack/react-router';
import { usePermissions } from '@/app/usePermissions';
import { useWorkspaceScope } from '@/app/useWorkspaceScope';
import { ReportsOverviewPage } from './ReportsOverviewPage';
import { MonthlyStatementPage } from './MonthlyStatementPage';
import { AttributionAuditPage } from './AttributionAuditPage';

type InsightsView = 'overview' | 'monthly' | 'audit';

/**
 * Reports nav tab: what you read periodically, as opposed to Ledger (what
 * you act on daily). Trends is the Dashboard (patient retention, packages,
 * revenue trend, referral sources — an "insights" page in substance, so it
 * now says so); Monthly statement is the
 * full per-therapist Bill/BM Share/TDS/Post-Tax/HV breakdown, gated on
 * canViewPayouts (admin-only) the same way Ledger's Invoices sub-tab is
 * gated on canBill — a colleague's individual earnings, not a per-visit
 * bill amount. The nav item itself is hidden from plain therapists
 * entirely (see Shell.tsx), so anyone who reaches this page at all is
 * already admin or front_desk.
 */
export function ReportsPage() {
  const { canViewPayouts, role } = usePermissions();
  const { isClinicWideView } = useWorkspaceScope();
  const navigate = useNavigate();
  const search = useSearch({ from: '/insights' });
  const view: InsightsView =
    search.tab === 'monthly' ? 'monthly' : search.tab === 'audit' ? 'audit' : 'overview';

  const setView = useCallback(
    (next: InsightsView) => {
      void navigate({ to: '/insights', search: next === 'overview' ? {} : { tab: next }, replace: true });
    },
    [navigate]
  );

  // canViewPayouts flipping mid-session (admin role changed on another
  // device) shouldn't leave someone stranded on a tab that just disappeared.
  // Wait until role resolves — while it's still 'unknown', canViewPayouts is
  // false and we'd incorrectly strip ?tab=monthly back to Trends on load.
  useEffect(() => {
    if (view !== 'overview' && role !== 'unknown' && !canViewPayouts) setView('overview');
  }, [view, canViewPayouts, role, setView]);

  // Nav already hides the Reports link for a plain therapist (Shell.tsx);
  // this guard covers a direct URL hit (old bookmark, typed link) instead
  // of silently rendering clinic-wide aggregates. The therapist comparison
  // chart is the one exception (decision 4) — it lives on Workspace instead,
  // reachable without this tab.
  if (!isClinicWideView) {
    return (
      <div className="space-y-4">
        <h1 className="font-display text-lg font-semibold text-[var(--ink)]">Reports</h1>
        <p className="text-sm text-[var(--muted)]">
          Reports are visible to admins and front desk. Your own numbers are on Workspace.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <div className="flex w-fit gap-1 rounded-lg border border-[var(--border)] bg-[var(--paper)] p-1">
        {(
          [
            { key: 'overview', label: 'Trends' },
            { key: 'monthly', label: 'Monthly statement' },
            { key: 'audit', label: 'Attribution audit' },
          ] as const
        )
          .filter((v) => v.key === 'overview' || canViewPayouts)
          .map((v) => (
            <button
              key={v.key}
              type="button"
              className={`rounded-md px-3 py-1 text-xs font-medium ${
                view === v.key ? 'bg-[var(--teal)] text-white' : 'text-[var(--muted)] hover:bg-[var(--surface)]'
              }`}
              onClick={() => setView(v.key)}
            >
              {v.label}
            </button>
          ))}
      </div>

      {view === 'overview' && <ReportsOverviewPage />}
      {view === 'monthly' && canViewPayouts && <MonthlyStatementPage />}
      {view === 'audit' && canViewPayouts && <AttributionAuditPage />}
    </div>
  );
}
