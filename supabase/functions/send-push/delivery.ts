/** Which push subscriptions to delete after a batch. */
export interface DeliveryResult {
  id: string;
  status: number;
}

/**
 * 404 and 410 always mean the browser dropped the subscription. A 403 (e.g. Apple's "BadJwtToken", or a subscription made
 * under another VAPID key) never recovers for that subscription, but the same 403 on EVERY send would mean our own key is
 * wrong, and deleting everyone would be far worse. So a 403 is only removed when at least one other send in the batch worked.
 */
export function subscriptionsToRemove(results: DeliveryResult[]): string[] {
  const anyDelivered = results.some((r) => r.status === 201);
  return results
    .filter((r) => r.status === 404 || r.status === 410 || (r.status === 403 && anyDelivered))
    .map((r) => r.id);
}
