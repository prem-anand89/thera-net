import { useEffect, useMemo, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { repos, feedbackService } from '@/services';
import { db } from '@/lib/db';
import type { UUID } from '@/domain/types';

/**
 * Split out of `RequestsPage.tsx` so `WorkspacePage.tsx` — eagerly bundled,
 * unlike every other route — can read the "new response" count without
 * pulling the (route-code-split) Requests page component into that eager
 * bundle. Keep this file free of anything page-shaped.
 */

/** Scoped per clinic, same reasoning as `lastBackupMetaKey` — `db.meta` is
 *  one global table shared by every clinic on this device, so an unscoped
 *  key would clear the "new response" signal for every clinic at once. */
export function requestsLastViewedKey(clinicId: string): string {
  return `requestsLastViewedAt:${clinicId}`;
}

/** Count of responses created after this clinic's own last-viewed
 *  timestamp — Workspace's "new response" surface, cleared by opening
 *  `/requests?tab=feedback` (see that page's own mark-as-viewed effect). */
export function useNewFeedbackResponseCount(clinicId: string, enabled: boolean): number {
  const responses = useLiveQuery(
    () => (enabled ? repos.feedbackResponses.listByClinic(clinicId) : undefined),
    [clinicId, enabled]
  );
  const lastViewed = useLiveQuery(
    () => (enabled ? db.meta.get(requestsLastViewedKey(clinicId)) : undefined),
    [clinicId, enabled]
  );
  return useMemo(() => {
    if (!enabled || !responses) return 0;
    const since = lastViewed?.value;
    if (!since) return responses.length;
    return responses.filter((r) => r.createdAt > since).length;
  }, [enabled, responses, lastViewed]);
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
