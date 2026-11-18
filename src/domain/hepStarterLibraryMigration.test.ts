import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const PUB_SIG = 'uuid, uuid, uuid, text, text[], text, text[], text, text[], text[], text[], text, text, text, text[], text[], text, text, smallint, smallint, smallint, smallint, smallint, smallint, text';

describe('HEP starter_exercises curator migration contract', () => {
  const path = resolve(process.cwd(), 'supabase/migrations/20261118110000_hep_starter_library.sql');

  it('exists', () => {
    expect(existsSync(path)).toBe(true);
  });

  const sql = () => readFileSync(path, 'utf8');

  it('creates starter_exercises with RLS enabled for authenticated read only', () => {
    const s = sql();
    expect(s).toContain('create table if not exists public.starter_exercises');
    expect(s).toContain('alter table public.starter_exercises enable row level security;');
    expect(s).toContain('on public.starter_exercises');
    expect(s).toContain('using (active = true)');
  });

  it('defines clinics.starter_curator with default false and protects it from clinic members/admins', () => {
    const s = sql();
    expect(s).toMatch(/alter table public\.clinics[\s\S]*add column if not exists starter_curator boolean not null default false/i);
    expect(s).toContain('create or replace function public.clinics_protect_starter_curator()');
    expect(s).toContain('create trigger trg_clinics_protect_starter_curator');
    expect(s).toContain('before insert or update on public.clinics');
  });

  it('guards curation with is_starter_curator reading clinics.starter_curator (no clinic names)', () => {
    const s = sql();
    const fnMatch = s.match(/create or replace function public\.is_starter_curator\(p_clinic uuid\)[\s\S]*?\$\$;/i);
    expect(fnMatch).not.toBeNull();
    const fnSql = fnMatch![0].toLowerCase();
    expect(fnSql).toContain('c.starter_curator = true');
    expect(fnSql).not.toContain('beyond mechanics');
    expect(fnSql).not.toContain('physio clinic');
    expect(s).toContain('if not public.is_starter_curator(p_clinic_id) then');
    expect(s).toContain('grant execute on function public.is_starter_curator(uuid) to authenticated;');
    expect(s).toContain('revoke all on function public.is_starter_curator(uuid) from public, anon;');
  });

  it('creates publish_starter_exercise and unpublish_starter_exercise with starter prefix guards and grants', () => {
    const s = sql();
    expect(s).toContain("k not like 'starter/exercises/' || v_id::text || '/%'");
    expect(s).toContain(`grant execute on function public.publish_starter_exercise(${PUB_SIG}) to authenticated;`);
    expect(s).toContain(`revoke all on function public.publish_starter_exercise(${PUB_SIG}) from public, anon;`);
    expect(s).toContain('grant execute on function public.unpublish_starter_exercise(uuid, uuid) to authenticated;');
    expect(s).toContain('revoke all on function public.unpublish_starter_exercise(uuid, uuid) from public, anon;');
  });
});
