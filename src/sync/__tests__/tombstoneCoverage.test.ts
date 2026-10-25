// @vitest-environment node
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ALL_SYNCED_TABLES } from '@/lib/db';

/**
 * A table the app syncs but that has no delete marker would never lose a deleted row on other devices.
 * Every synced table needs `<table>_tombstone` (record_sync_tombstone) in some migration, either created
 * directly or listed in the loop of the migration that introduced sync_tombstones.
 */
const dir = join(process.cwd(), 'supabase', 'migrations');
const files = readdirSync(dir).filter((f) => f.endsWith('.sql'));
const sql = (name: string) => readFileSync(join(dir, name), 'utf8');
const tombstoneMigration = files.find((f) => f.includes('sync_tombstones'));
const all = files.map(sql).join('\n');

describe('delete markers cover every synced table', () => {
  it('finds the migration that introduced sync_tombstones', () => {
    expect(tombstoneMigration).toBeDefined();
  });

  it.each([...ALL_SYNCED_TABLES])('%s has a tombstone trigger', (table) => {
    const inLoop = tombstoneMigration ? sql(tombstoneMigration).includes(`'${table}'`) : false;
    const created = new RegExp(`create trigger ${table}_tombstone\\b`, 'i').test(all);
    expect(inLoop || created, `add "create trigger ${table}_tombstone after delete on public.${table} for each row execute function public.record_sync_tombstone()" to a migration`).toBe(true);
  });
});
