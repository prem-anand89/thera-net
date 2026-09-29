import { Link } from '@tanstack/react-router';
import { usePermissions } from '@/app/usePermissions';
import { useClinic } from '@/app/clinicContext';
import { useLiveQuery } from 'dexie-react-hooks';
import { repos } from '@/services';

export function MorePage() {
  const { canEditSettings, isAdmin, role } = usePermissions();
  const showReports = isAdmin || role === 'front_desk';
  // Requests → Feedback is admin-only, but Bookings (Slice 5) is
  // front_desk's primary surface too — same gate as the desktop nav's
  // /requests item in Shell.tsx.
  const showRequests = isAdmin || role === 'front_desk';
  const clinic = useClinic();
  
  const appointmentRequests = useLiveQuery(
    () => clinic && showRequests ? repos.appointmentRequests.listByClinic(clinic.id) : undefined,
    [clinic?.id, showRequests]
  );
  const pendingRequestsCount = appointmentRequests?.filter(r => r.status === 'pending').length ?? 0;

  return (
    <div className="space-y-4">
      <h1 className="font-display text-2xl font-semibold text-[var(--ink)]">More</h1>
      <ul className="divide-y divide-[var(--border)] overflow-hidden rounded-2xl border border-[var(--border)] bg-[var(--surface)]">
        {showReports && (
          <li>
            <Link
              to="/insights"
              className="block min-h-11 px-4 py-3 text-sm font-medium text-[var(--ink)] hover:bg-[var(--paper)]"
            >
              Reports
            </Link>
          </li>
        )}
        {canEditSettings && (
          <li>
            <Link
              to="/settings"
              className="block min-h-11 px-4 py-3 text-sm font-medium text-[var(--ink)] hover:bg-[var(--paper)]"
            >
              Settings
            </Link>
          </li>
        )}
        {showRequests && (
          <li>
            <Link
              to="/schedule"
              className="flex items-center justify-between min-h-11 px-4 py-3 text-sm font-medium text-[var(--ink)] hover:bg-[var(--paper)]"
            >
              <span>Requests</span>
              {pendingRequestsCount > 0 && (
                <span className="flex h-5 min-w-5 items-center justify-center rounded-full bg-[var(--rust)] px-1.5 text-[11px] font-bold text-white">
                  {pendingRequestsCount}
                </span>
              )}
            </Link>
          </li>
        )}
      </ul>
    </div>
  );
}
