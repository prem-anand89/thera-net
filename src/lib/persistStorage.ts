/**
 * Asks the browser to keep this site's IndexedDB (the offline outbox included)
 * out of automatic eviction. Without it Safari can drop script-written data
 * after a week without use, and any browser may evict under storage pressure.
 * Best-effort: unsupported or denied is fine, nothing depends on the answer.
 */
export async function requestPersistentStorage(): Promise<boolean> {
  try {
    const storage = navigator.storage;
    if (!storage?.persist) return false;
    if (storage.persisted && (await storage.persisted())) return true;
    return await storage.persist();
  } catch {
    return false;
  }
}
