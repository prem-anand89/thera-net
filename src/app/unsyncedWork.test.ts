import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { db } from '@/lib/db';
import { collectUnsyncedRows, keepSetFromOutbox, purgeAllButOutbox } from './unsyncedWork';

describe('keepSetFromOutbox', () => {
  it('groups outbox row ids by table', () => {
    const keep = keepSetFromOutbox([
      { table: 'patients', rowId: 'p1' },
      { table: 'patients', rowId: 'p1' },
      { table: 'visits', rowId: 'v1' },
    ]);
    expect([...keep.get('patients')!]).toEqual(['p1']);
    expect([...keep.get('visits')!]).toEqual(['v1']);
  });
});

describe('purgeAllButOutbox', () => {
  beforeEach(async () => {
    await db.patients.clear();
    await db.visits.clear();
    await db.outbox.clear();
    await db.meta.clear();
  });

  it('keeps only rows the outbox needs, resets cursors, keeps the owner', async () => {
    await db.patients.bulkPut([{ id: 'p1', name: 'Keep' }, { id: 'p2', name: 'Purge' }] as never);
    await db.visits.put({ id: 'v1' } as never);
    await db.outbox.add({ table: 'patients', rowId: 'p1', ts: 1 });
    await db.meta.bulkPut([
      { key: 'cursor:patients', value: '2026-10-01' },
      { key: 'lastUserId', value: 'user-a' },
    ]);

    await purgeAllButOutbox();

    expect((await db.patients.toArray()).map((p) => p.id)).toEqual(['p1']);
    expect(await db.visits.count()).toBe(0);
    expect(await db.meta.get('cursor:patients')).toBeUndefined();
    expect((await db.meta.get('lastUserId'))?.value).toBe('user-a');
    expect(await db.outbox.count()).toBe(1);
  });

  it('collectUnsyncedRows returns the data behind each queued change once', async () => {
    await db.patients.put({ id: 'p1', name: 'Ananya' } as never);
    await db.outbox.bulkAdd([
      { table: 'patients', rowId: 'p1', ts: 1 },
      { table: 'patients', rowId: 'p1', ts: 2, error: 'boom' },
    ]);
    const rows = await collectUnsyncedRows();
    expect(rows).toHaveLength(1);
    expect((rows[0].row as { name: string }).name).toBe('Ananya');
  });
});
