import { useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { Panel, ErrorNote } from '@/components/ui';
import { PushSettingsCard } from '@/features/notifications/PushSettingsCard';
import { repos } from '@/services';
import { useClinic } from '@/app/clinicContext';
import { useSession } from '@/app/useSession';
import { toFriendlyMessage } from '@/lib/errors';
import { PUSH_CATEGORY_COPY, PUSH_CATEGORY_DEFAULT, pushCategoriesFor, type PushCategory } from '@/domain/pushPreferences';
import type { ClinicRole } from '@/app/useClinicRole';
import type { Therapist } from '@/domain/types';

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
  const clinic = useClinic();
  const userId = useSession().session?.user?.id;
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const categories = pushCategoriesFor(role, Boolean(therapist));
  // Only explicit choices are stored; with no row an alert is on and "hide patient names" is off.
  const choices = useLiveQuery(
    async () => (userId ? await repos.userPushPreferences.listForUser(userId, clinic.id) : undefined),
    [userId, clinic.id]
  );
  const isOn = (category: PushCategory) => choices?.find((c) => c.category === category)?.enabled ?? PUSH_CATEGORY_DEFAULT[category];
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

  async function setAlert(category: PushCategory, enabled: boolean) {
    if (!userId) return;
    setError(null);
    try {
      await repos.userPushPreferences.setEnabled(userId, clinic.id, category, enabled);
    } catch (e) {
      setError(toFriendlyMessage(e));
    }
  }

  return (
    <Panel open={open} onClose={onClose} title="Notifications">
      <div className="space-y-5">
        <PushSettingsCard />
        {categories.length === 0 ? (
          <p className="text-sm text-[var(--muted)]">
            Ask an admin to link your login to your therapist profile to get appointment alerts.
          </p>
        ) : (
          <div className="space-y-1 border-t border-[var(--border)] pt-4">
            <h3 className="text-sm font-semibold">Which alerts do you want?</h3>
            <p className="text-xs text-[var(--muted)]">
              These apply on all your devices for this clinic. Alerts are on unless you switch them off. Quiet hours: nothing is sent from 11 pm to 6 am, except changes to today's appointments.
            </p>
            {categories.map((category) => (
              <label key={category} className="flex min-h-11 cursor-pointer items-center justify-between gap-3">
                <span>
                  <span className="block text-sm font-medium text-[var(--ink)]">
                    {PUSH_CATEGORY_COPY[category].label}
                  </span>
                  <span className="block text-xs text-[var(--muted)]">
                    {PUSH_CATEGORY_COPY[category].description}
                  </span>
                </span>
                <input
                  type="checkbox"
                  role="switch"
                  className="h-5 w-5 shrink-0 accent-[var(--teal)]"
                  aria-label={PUSH_CATEGORY_COPY[category].label}
                  checked={isOn(category)}
                  disabled={!userId}
                  onChange={(e) => void setAlert(category, e.target.checked)}
                />
              </label>
            ))}
          </div>
        )}
        {therapist && (
          <div className="space-y-1.5 border-t border-[var(--border)] pt-4">
            <label className="flex min-h-11 cursor-pointer items-center justify-between gap-3">
              <span>
                <span className="block text-sm font-medium text-[var(--ink)]">Email me each appointment</span>
                <span className="block text-xs text-[var(--muted)]">
                  A separate email, with a calendar invite, whenever one is confirmed.
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
