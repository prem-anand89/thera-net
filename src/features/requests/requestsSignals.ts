import { useMemo } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { repos } from '@/services';
import { db } from '@/lib/db';

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
