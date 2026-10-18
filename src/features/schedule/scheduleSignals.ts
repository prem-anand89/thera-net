import { useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { repos, feedbackService } from '@/services';
import { db } from '@/lib/db';
import { syncStatus } from '@/sync/status';
import { isActiveAppointmentStatus } from '@/domain/appointmentStatus';
import { effectiveSeenSince } from '@/domain/seenMarker';
import type { SeenMarkerKey, UUID } from '@/domain/types';

/**
 * Split out of `SchedulePage.tsx` so `WorkspacePage.tsx` — eagerly bundled,
 * unlike every other route — can read the "new response" count without
 * pulling the (route-code-split) Schedule page component into that eager
 * bundle. Keep this file free of anything page-shaped.
 *
 * "New" means "after the last time THIS USER looked", stored as a synced
 * per-user marker (`user_seen_markers`) so it follows them to every device.
 * It used to be a timestamp in this device's own `db.meta`, which is why a
 * fresh phone or browser showed every old response as new.
 */

/** LEGACY per-device key (pre-synced markers). Scoped per clinic, same reasoning as
 *  `lastBackupMetaKey` — `db.meta` is one global table shared by every clinic on this
 *  device. Kept only so an existing device's marker can be carried over to the synced
 *  one (see `useSeenSince`); the string itself must not change or that carry-over would
 *  miss it. Don't "fix" this string. */
export function requestsLastViewedKey(clinicId: string): string {
  return `requestsLastViewedAt:${clinicId}`;
}

/** LEGACY per-device key, scoped per clinic AND per therapist. See `requestsLastViewedKey`. */
export function therapistAppointmentsLastViewedKey(clinicId: string, therapistId: string): string {
  return `therapistAppointmentsLastViewedAt:${clinicId}:${therapistId}`;
}

/** True once this device has completed a sync, so synced markers have had their chance to arrive. */
function useFirstSyncDone(): boolean {
  return useSyncExternalStore(
    syncStatus.subscribe,
    () => syncStatus.get().lastSuccessAt != null
  );
}

/**
 * The timestamp after which items count as "new" for this user, or `undefined` while it
 * isn't known yet (counts then read 0 instead of flashing everything as new). Combines
 * the synced marker with any legacy per-device value (newest wins) and, once, carries
 * that legacy value over into the synced marker.
 */
function useSeenSince(
  clinicId: UUID,
  userId: UUID | undefined,
  key: SeenMarkerKey,
  legacyKey: string | null,
  enabled: boolean
): string | undefined {
  const active = enabled && !!userId;
  const syncDone = useFirstSyncDone();
  const marker = useLiveQuery(
    async () => (active ? ((await repos.userSeenMarkers.get(userId!, clinicId, key)) ?? null) : undefined),
    [active, userId, clinicId, key]
  );
  const legacy = useLiveQuery(
    async () => (active && legacyKey ? ((await db.meta.get(legacyKey)) ?? null) : undefined),
    [active, legacyKey]
  );

  useEffect(() => {
    if (!active || !legacyKey || !legacy?.value) return;
    void repos.userSeenMarkers
      .markSeen(userId!, clinicId, key, legacy.value)
      .then(() => db.meta.delete(legacyKey))
      .catch(() => {
        /* keep the legacy value; it is retried on the next load */
      });
  }, [active, userId, clinicId, key, legacyKey, legacy?.value]);

  if (!active || !syncDone || marker === undefined) return undefined;
  if (legacyKey && legacy === undefined) return undefined;
  return effectiveSeenSince(marker?.seenAt, legacy?.value);
}

/** Count of responses created after this user's last look at feedback — Workspace's
 *  "new response" surface, cleared by opening `/schedule?tab=feedback` (see that page's
 *  own mark-as-seen effect). */
export function useNewFeedbackResponseCount(clinicId: string, userId: UUID | undefined, enabled: boolean): number {
  const responses = useLiveQuery(
    () => (enabled ? repos.feedbackResponses.listByClinic(clinicId) : undefined),
    [clinicId, enabled]
  );
  const since = useSeenSince(clinicId, userId, 'feedback', requestsLastViewedKey(clinicId), enabled);
  return useMemo(() => {
    if (!enabled || !responses || since === undefined) return 0;
    return responses.filter((r) => r.createdAt > since).length;
  }, [enabled, responses, since]);
}

/** Same "since last seen" window as `useNewFeedbackResponseCount`, narrowed to 1-2 star
 *  responses — the Notification Bell's "turn red" signal (Phase 6.5). Admin-only, same RLS
 *  reasoning as the count above: a front_desk caller's Dexie never receives
 *  `feedback_responses` rows at all, so `enabled` must stay false for them. */
export function useNewLowRatingFeedbackCount(clinicId: string, userId: UUID | undefined, enabled: boolean): number {
  const responses = useLiveQuery(
    () => (enabled ? repos.feedbackResponses.listByClinic(clinicId) : undefined),
    [clinicId, enabled]
  );
  const since = useSeenSince(clinicId, userId, 'feedback', requestsLastViewedKey(clinicId), enabled);
  return useMemo(() => {
    if (!enabled || !responses || since === undefined) return 0;
    return responses.filter((r) => r.rating <= 2 && r.createdAt > since).length;
  }, [enabled, responses, since]);
}

/**
 * A therapist's own "something new or changed landed on my schedule"
 * count — the one in-app signal a therapist gets today besides the
 * automatic email `notify-therapist` already sends on confirm/reschedule
 * (see that edge function's own doc comment). `appointments` is
 * clinic-wide readable (`is_clinic_member` RLS, not admin-only like
 * `feedback_responses`), so a therapist's own Dexie already has every
 * row needed here — no RLS change, same pattern as
 * `useNewFeedbackResponseCount` just filtered to this therapist's own
 * rows. Diffs on `updatedAt`, not `createdAt`, so a reschedule (which
 * touches an existing row rather than inserting a new one) counts as
 * "new" too — `isActiveAppointmentStatus` (confirmed or rescheduled)
 * excludes cancelled/no-show/arrived, which aren't things to alert a
 * therapist about. */
export function useNewTherapistAppointmentCount(
  clinicId: string,
  userId: UUID | undefined,
  therapistId: string | undefined,
  enabled: boolean
): number {
  const on = enabled && !!therapistId;
  const appointments = useLiveQuery(
    () => (on ? repos.appointments.listByClinic(clinicId) : undefined),
    [clinicId, on]
  );
  const since = useSeenSince(
    clinicId,
    userId,
    'therapist_appointments',
    therapistId ? therapistAppointmentsLastViewedKey(clinicId, therapistId) : null,
    on
  );
  return useMemo(() => {
    if (!on || !appointments || since === undefined) return 0;
    return appointments.filter(
      (a) => a.therapistId === therapistId && isActiveAppointmentStatus(a.status) && a.updatedAt > since
    ).length;
  }, [on, therapistId, appointments, since]);
}

/**
 * Google-review-nudge eligibility for callers who can't get it from the
 * synced `feedback_responses.rating` column — i.e. front_desk, since that
 * table's RLS is `is_clinic_admin()`-only and the row never reaches their
 * Dexie at all (see `feedbackService.listGoogleReviewEligibleRequestIds`'s
 * own comment). Admin callers don't need this; only fetch when `enabled`.
 * Not reactive like this file's other hooks — a plain one-shot RPC fetch,
 * re-run on window focus so a response that just came in shows up without
 * a full page reload.
 */
export function useGoogleReviewEligibleRequestIds(clinicId: UUID, enabled: boolean): Set<UUID> {
  const [ids, setIds] = useState<Set<UUID>>(new Set());
  useEffect(() => {
    if (!enabled) {
      setIds(new Set());
      return;
    }
    let cancelled = false;
    const load = () => {
      void feedbackService.listGoogleReviewEligibleRequestIds(clinicId).then((result) => {
        if (!cancelled) setIds(result);
      });
    };
    load();
    window.addEventListener('focus', load);
    return () => {
      cancelled = true;
      window.removeEventListener('focus', load);
    };
  }, [clinicId, enabled]);
  return ids;
}
