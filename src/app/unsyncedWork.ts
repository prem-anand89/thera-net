import { ALL_SYNCED_TABLES, db } from '@/lib/db';

/**
 * Support for the "session lost with unsynced work" case. The outbox rows are the
 * only copy of that work, but the rest of the local store (every patient, visit
 * and invoice the account could read) is only a cache and is protected health
 * data. While nobody is signed in we keep just what the outbox needs.
 */

export function keepSetFromOutbox(entries: { table: string; rowId: string }[]): Map<string, Set<string>> {
  const keep = new Map<string, Set<string>>();
  for (const e of entries) {
    if (!keep.has(e.table)) keep.set(e.table, new Set());
    keep.get(e.table)!.add(e.rowId);
  }
  return keep;
}

/** Deletes every synced row not referenced by an outbox entry, and resets the pull cursors so the next sign-in re-pulls. */
export async function purgeAllButOutbox(): Promise<void> {
  const keep = keepSetFromOutbox(await db.outbox.toArray());
  for (const table of ALL_SYNCED_TABLES) {
    const keepIds = keep.get(table) ?? new Set<string>();
    await db.table(table).filter((row: { id?: string }) => !keepIds.has(row.id ?? '')).delete();
  }
  // Cursors only: lastUserId (who owns the outbox) must survive.
  await db.meta.where('key').startsWith('cursor:').delete();
}

export interface UnsyncedRow {
  table: string;
  rowId: string;
  error?: string;
  row: unknown;
}

/** The actual data behind every queued change, for the "Download unsynced changes" file. */
export async function collectUnsyncedRows(): Promise<UnsyncedRow[]> {
  const entries = await db.outbox.toArray();
  const seen = new Set<string>();
  const rows: UnsyncedRow[] = [];
  for (const e of entries) {
    const key = `${e.table}:${e.rowId}`;
    if (seen.has(key)) continue;
    seen.add(key);
    rows.push({ table: e.table, rowId: e.rowId, error: e.error, row: (await db.table(e.table).get(e.rowId)) ?? null });
  }
  return rows;
}
