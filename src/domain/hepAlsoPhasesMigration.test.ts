import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { EXERCISE_PHASES } from './hep';

const OLD_SIG = 'uuid, uuid, text, text, text, text[], text[], text, text, text[], smallint, smallint, smallint, smallint, text, text, boolean, text, smallint, smallint, text[], boolean, text[], text, text[], boolean, boolean';
const NEW_SIG = `${OLD_SIG}, text[]`;

describe('HEP exercise also_phases migration contract', () => {
  const path = resolve(process.cwd(), 'supabase/migrations/20261118100000_hep_exercise_also_phases.sql');

  it('exists', () => {
    expect(existsSync(path)).toBe(true);
  });

  const sql = () => readFileSync(path, 'utf8');

  it('adds also_phases column limited to valid EXERCISE_PHASES values', () => {
    const s = sql();
    expect(s).toContain("add column if not exists also_phases text[] not null default '{}'::text[]");
    expect(s).toContain('exercises_also_phases_check');
    const list = `array[${EXERCISE_PHASES.map((p) => `'${p}'`).join(',')}]::text[]`;
    expect(s).toContain(`check (also_phases <@ ${list})`);
  });

  it('replaces save_exercise: drops the 27-argument version and takes p_also_phases', () => {
    const s = sql();
    expect(s).toContain(`drop function if exists public.save_exercise(${OLD_SIG});`);
    expect(s).toContain("p_also_phases text[] default '{}'::text[]");
    expect(s).toContain(`grant execute on function public.save_exercise(${NEW_SIG}) to authenticated;`);
    expect(s).toContain(`revoke all on function public.save_exercise(${NEW_SIG}) from public, anon;`);
    expect(s).toContain('if not public.is_hep_staff(p_clinic_id) then');
    expect(s).toContain('clinic_has_unlimited_hep(p_clinic_id)');
    expect(s).toContain("raise exception 'Picture does not belong to this clinic.';");
  });
});
