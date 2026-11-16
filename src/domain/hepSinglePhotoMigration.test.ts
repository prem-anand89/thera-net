import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('HEP allow single photo migration contract', () => {
  const path = resolve(process.cwd(), 'supabase/migrations/20261116100000_hep_allow_single_photo.sql');

  it('exists', () => {
    expect(existsSync(path)).toBe(true);
  });

  const sql = () => readFileSync(path, 'utf8');

  it('drops the existing media_keys check by looking up pg_constraint inside a re-runnable DO block', () => {
    const s = sql();
    expect(s).toMatch(/do\s+\$\$/i);
    expect(s).toContain('pg_constraint');
    expect(s).toContain("'public.exercises'::regclass");
    expect(s).toContain("c.contype = 'c'");
    expect(s).toContain('drop constraint if exists');
    expect(s).toMatch(/end\s+\$\$;/i);
  });

  it('adds exercises_media_keys_check allowing stills with 1 to 4 keys', () => {
    const s = sql();
    expect(s).toContain('add constraint exercises_media_keys_check check');
    expect(s).toContain("(media_type = 'none' and cardinality(media_keys) = 0)");
    expect(s).toContain("(media_type = 'gif' and cardinality(media_keys) = 1)");
    expect(s).toContain("(media_type = 'stills' and cardinality(media_keys) between 1 and 4)");
  });
});
