import { Link } from '@tanstack/react-router';
import { usePermissions } from '@/app/usePermissions';

export function MorePage() {
  const { canEditSettings, isAdmin, role } = usePermissions();
  const showReports = isAdmin || role === 'front_desk';
  // Requests → Feedback is admin-only, but Bookings (Slice 5) is
  // front_desk's primary surface too — same gate as the desktop nav's
  // /requests item in Shell.tsx.
  const showRequests = isAdmin || role === 'front_desk';

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
              to="/requests"
              className="block min-h-11 px-4 py-3 text-sm font-medium text-[var(--ink)] hover:bg-[var(--paper)]"
            >
              Requests
            </Link>
          </li>
        )}
      </ul>
    </div>
  );
}
