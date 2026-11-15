// src/domain/hepPositionsMigration.test.ts
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, it, expect } from 'vitest';
import { HEP_POSITIONS } from './hep';

const OLD_SIG = 'uuid, uuid, text, text, text, text[], text[], text, text, text[], smallint, smallint, smallint, smallint, text, text, boolean, text, smallint, smallint, text[], boolean, text[], text';
const NEW_SIG = `${OLD_SIG}, text[]`;

describe('HEP exercise positions migration contract', () => {
  const path = resolve(process.cwd(), 'supabase/migrations/20261114200000_hep_exercise_positions.sql');

  it('exists', () => {
    expect(existsSync(path)).toBe(true);
  });

  const sql = () => readFileSync(path, 'utf8');

  it('adds a positions column limited to the seven positions', () => {
    const s = sql();
    expect(s).toContain("add column if not exists positions text[] not null default '{}'::text[]");
    expect(s).toContain('exercises_positions_check');
    const list = `array[${HEP_POSITIONS.map((p) => `'${p}'`).join(',')}]::text[]`;
    expect(s).toContain(`check (positions <@ ${list})`);
  });

  it('replaces save_exercise: drops the 24-argument version and takes p_positions', () => {
    const s = sql();
    expect(s).toContain(`drop function if exists public.save_exercise(${OLD_SIG});`);
    expect(s).toContain("p_positions text[] default '{}'::text[]");
    // Written on both insert and update.
    expect(s.match(/coalesce\(p_positions, '\{\}'::text\[\]\)/g)?.length).toBe(2);
    expect(s).toContain(`grant execute on function public.save_exercise(${NEW_SIG}) to authenticated;`);
    expect(s).toContain(`revoke all on function public.save_exercise(${NEW_SIG}) from public, anon;`);
    // Same guards as the original.
    expect(s).toContain('if not public.is_hep_staff(p_clinic_id) then');
    expect(s).toContain('clinic_has_unlimited_hep(p_clinic_id)');
    expect(s).toContain("raise exception 'Picture does not belong to this clinic.';");
  });

  it('adds exercise_use_counts, a grouped count guarded by is_hep_staff', () => {
    const s = sql();
    expect(s).toContain('create or replace function public.exercise_use_counts(p_clinic_id uuid)');
    expect(s).toContain('returns table (exercise_id uuid, uses int)');
    const fn = s.slice(s.indexOf('function public.exercise_use_counts'));
    expect(fn).toContain('public.is_hep_staff(p_clinic_id)');
    expect(fn).toContain('group by 1');
    expect(s).toContain('grant execute on function public.exercise_use_counts(uuid) to authenticated;');
    expect(s).toContain('revoke all on function public.exercise_use_counts(uuid) from public, anon;');
  });
});
