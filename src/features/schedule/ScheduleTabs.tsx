import type { ReactNode } from 'react';
import { Link } from '@tanstack/react-router';

export type ScheduleTab = 'schedule' | 'history' | 'feedback';

/**
 * The Schedule page's one tab row — Schedule · History · Feedback on the
 * left, the page's actions (Reminders, + Book) on the right. It replaced a
 * "Schedule" title, a Bookings | Feedback row, a toolbar row and a
 * Schedule | History row that together pushed the calendar down. The page
 * title stays for screen readers only; the header nav already says
 * Schedule. URLs are unchanged: Schedule/History are
 * `?tab=bookings&view=…`, Feedback is `?tab=feedback` (admins only).
 */
export function ScheduleTabs({
  active,
  showFeedback,
  scheduleLabel,
  actions,
}: {
  active: ScheduleTab;
  showFeedback: boolean;
  scheduleLabel: string;
  actions?: ReactNode;
}) {
  const cls = (tab: ScheduleTab) =>
    `-mb-px flex min-h-11 items-center border-b-2 px-1 text-sm font-medium ${
      active === tab ? 'border-[var(--teal)] text-[var(--teal)]' : 'border-transparent text-[var(--muted)] hover:text-[var(--ink)]'
    }`;
  return (
    <div className="flex items-end gap-3 border-b border-[var(--border)]">
      <h1 className="sr-only">Schedule</h1>
      <nav aria-label="Schedule views" className="flex min-w-0 gap-5">
        <Link to="/schedule" search={{ tab: 'bookings', view: 'schedule' }} className={cls('schedule')} aria-current={active === 'schedule' ? 'page' : undefined}>
          {scheduleLabel}
        </Link>
        <Link to="/schedule" search={{ tab: 'bookings', view: 'history' }} className={cls('history')} aria-current={active === 'history' ? 'page' : undefined}>
          History
        </Link>
        {showFeedback && (
          <Link to="/schedule" search={{ tab: 'feedback' }} className={cls('feedback')} aria-current={active === 'feedback' ? 'page' : undefined}>
            Feedback
          </Link>
        )}
      </nav>
      {actions && <div className="mb-1.5 ml-auto flex shrink-0 items-center gap-2">{actions}</div>}
    </div>
  );
}
