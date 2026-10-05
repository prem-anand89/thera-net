import { useState } from 'react';
import { Panel, ErrorNote } from '@/components/ui';
import { PushSettingsCard } from '@/features/notifications/PushSettingsCard';
import { repos } from '@/services';
import { toFriendlyMessage } from '@/lib/errors';
import type { ClinicRole } from '@/app/useClinicRole';
import type { Therapist } from '@/domain/types';

function alertsFor(role: ClinicRole, linkedTherapist: boolean): string {
  if (role === 'admin') return 'You get an alert for every new booking request and for low-rated feedback.';
  if (role === 'front_desk') return 'You get an alert for every new booking request.';
  if (linkedTherapist) return 'You get an alert when one of your appointments is confirmed, rescheduled or cancelled.';
  return 'Ask an admin to link your login to your therapist profile to get appointment alerts.';
}

export function MyNotificationsSheet({
  open,
  onClose,
  role,
  therapist,
}: {
  open: boolean;
  onClose: () => void;
  role: ClinicRole;
  therapist: Therapist | undefined;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const emailOn = therapist?.emailAppointmentUpdates !== false;

  async function setEmail(next: boolean) {
    if (!therapist) return;
    setBusy(true);
    setError(null);
    try {
      await repos.therapists.put({
        ...therapist,
        emailAppointmentUpdates: next,
        updatedAt: new Date().toISOString(),
      });
    } catch (e) {
      setError(toFriendlyMessage(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Panel open={open} onClose={onClose} title="Notifications">
      <div className="space-y-5">
        <p className="text-sm text-[var(--muted)]">{alertsFor(role, Boolean(therapist))}</p>
        <PushSettingsCard />
        {therapist && (
          <div className="space-y-1.5 border-t border-[var(--border)] pt-4">
            <label className="flex min-h-11 cursor-pointer items-center justify-between gap-3">
              <span>
                <span className="block text-sm font-medium text-[var(--ink)]">Email me appointment updates</span>
                <span className="block text-xs text-[var(--muted)]">
                  Confirmations, reschedules and cancellations, with a calendar invite.
                </span>
              </span>
              <input
                type="checkbox"
                role="switch"
                className="h-5 w-5 shrink-0 accent-[var(--teal)]"
                checked={emailOn}
                disabled={busy}
                onChange={(e) => void setEmail(e.target.checked)}
              />
            </label>
            <ErrorNote message={error} />
          </div>
        )}
      </div>
    </Panel>
  );
}
