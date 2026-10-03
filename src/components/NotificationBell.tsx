import { useRef, useState } from 'react';
import { useNavigate } from '@tanstack/react-router';
import {
  useNewFeedbackResponseCount,
  useNewLowRatingFeedbackCount,
  useNewTherapistAppointmentCount,
} from '@/features/schedule/scheduleSignals';
import { IconBell } from './NavIcons';
import type { UUID } from '@/domain/types';

/**
 * Header-level alert, visible from any page. Aggregates pending booking
 * requests (passed in — Shell.tsx already computes this for the nav badge),
 * new feedback responses (admin-only), and — for a therapist viewer — their
 * own new/changed appointments. A given viewer only ever has one of
 * {isAdmin, therapistId} set, so the feedback and appointment counts never
 * both contribute for the same person.
 *
 * Pressing the bell opens a dropdown with one row per unread category; each
 * row opens the Schedule tab that holds it. Rows are category counts, not
 * individual items, so the dropdown never lists patient names in-app beyond
 * what the Schedule page itself shows. Turns red when a 1–2 star response is
 * among the unread ones; color is paired with the count, never the only signal.
 */
export function NotificationBell({
  clinicId,
  pendingRequestsCount,
  isAdmin,
  therapistId,
}: {
  clinicId: UUID;
  pendingRequestsCount: number;
  isAdmin: boolean;
  /** Set only for a therapist viewer. Omit for admin/front_desk. */
  therapistId?: UUID;
}) {
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const newFeedbackCount = useNewFeedbackResponseCount(clinicId, isAdmin);
  const lowRatingCount = useNewLowRatingFeedbackCount(clinicId, isAdmin);
  const newAppointmentCount = useNewTherapistAppointmentCount(clinicId, therapistId, !!therapistId);
  const total = pendingRequestsCount + newFeedbackCount + newAppointmentCount;
  const alert = lowRatingCount > 0;

  const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;
  const rows: { key: string; label: string; tab: 'bookings' | 'feedback'; view?: 'requests' }[] = [];
  if (pendingRequestsCount > 0) {
    rows.push({ key: 'requests', label: plural(pendingRequestsCount, 'new booking request'), tab: 'bookings', view: 'requests' });
  }
  if (newFeedbackCount > 0) {
    const low = lowRatingCount > 0 ? ` · ${lowRatingCount} low-rated` : '';
    rows.push({ key: 'feedback', label: `${plural(newFeedbackCount, 'new feedback response')}${low}`, tab: 'feedback' });
  }
  if (newAppointmentCount > 0) {
    rows.push({
      key: 'appointments',
      label: `${plural(newAppointmentCount, 'new or updated appointment')}`,
      tab: 'bookings',
    });
  }
  const summary = rows.length ? rows.map((r) => r.label).join(', ') : 'No new notifications';

  const triggerRef = useRef<HTMLButtonElement>(null);
  const [menuPos, setMenuPos] = useState<{ top: number; right: number; width: number } | null>(null);

  function toggleMenu() {
    if (!open) {
      const rect = triggerRef.current?.getBoundingClientRect();
      if (rect) {
        const width = Math.min(288, window.innerWidth - 24);
        const right = Math.max(12, window.innerWidth - rect.right);
        setMenuPos({ top: rect.bottom + 8, right: Math.min(right, window.innerWidth - width - 12), width });
      }
    }
    setOpen(!open);
  }

  function openRow(row: { tab: 'bookings' | 'feedback'; view?: 'requests' }) {
    setOpen(false);
    void navigate({ to: '/schedule', search: row.view ? { tab: row.tab, view: row.view } : { tab: row.tab } });
  }

  return (
    <div className="relative shrink-0">
      <button
        ref={triggerRef}
        type="button"
        title={summary}
        aria-label={summary}
        aria-haspopup="menu"
        aria-expanded={open}
        className={`relative flex h-9 w-9 shrink-0 items-center justify-center rounded-full hover:bg-[var(--paper)] ${
          alert ? 'text-[var(--rust)]' : 'text-[var(--muted)]'
        }`}
        onClick={toggleMenu}
      >
        <IconBell />
        {total > 0 && (
          <span
            className={`absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full px-1 text-[10px] font-bold text-white ${
              alert ? 'bg-[var(--rust)]' : 'bg-[var(--teal)]'
            }`}
          >
            {total}
          </span>
        )}
      </button>
      {open && menuPos && (
        <>
          <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} aria-hidden />
          <div
            role="menu"
            style={{ top: menuPos.top, right: menuPos.right, width: menuPos.width }}
            className="fixed z-20 overflow-hidden rounded-xl border border-[var(--border)] bg-[var(--surface)] py-1 shadow-lg"
          >
            <p className="px-3 pb-1 pt-2 text-[10px] font-semibold uppercase tracking-wide text-[var(--muted)]">
              Notifications
            </p>
            {rows.length === 0 && <p className="px-3 py-3 text-sm text-[var(--muted)]">No new notifications.</p>}
            {rows.map((row) => (
              <button
                key={row.key}
                type="button"
                role="menuitem"
                onClick={() => openRow(row)}
                className={`flex min-h-10 w-full items-center justify-between gap-2 px-3 py-2 text-left text-sm text-[var(--ink)] hover:bg-[var(--paper)] ${
                  row.key === 'feedback' && lowRatingCount > 0 ? 'text-[var(--rust)]' : ''
                }`}
              >
                <span>{row.label}</span>
                <span aria-hidden className="text-[var(--muted)]">›</span>
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
