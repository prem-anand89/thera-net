import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Postgres rejects `select a.*, scalar into v_row, v_scalar` with:
 *   `record variable cannot be part of multiple-item INTO list`
 * Returns any offending SELECT ... INTO fragments where a `public.*` row variable is combined with another target.
 */
function findRowVarMultiIntoBugs(sqlText: string): string[] {
  const rowVars = new Set(
    [...sqlText.matchAll(/\b([a-z_][a-z0-9_]*)\s+public\.[a-z_][a-z0-9_]*\s*;/gi)].map((m) => m[1].toLowerCase()),
  );
  if (rowVars.size === 0) return [];
  const bugs: string[] = [];
  for (const m of sqlText.matchAll(/\bselect\b([\s\S]*?)\binto\s+([\s\S]*?)\bfrom\b/gi)) {
    const rawTargets = m[2].replace(/^strict\s+/i, '').trim();
    const targets = rawTargets.split(',').map((t) => t.trim().toLowerCase()).filter(Boolean);
    if (targets.length > 1 && targets.some((t) => rowVars.has(t))) {
      bugs.push(`into ${rawTargets}`);
    }
  }
  return bugs;
}

describe('HEP PIN options migration contract', () => {
  const path = resolve(process.cwd(), 'supabase/migrations/20261118120000_hep_pin_options.sql');

  it('exists', () => {
    expect(existsSync(path)).toBe(true);
  });

  const sql = () => readFileSync(path, 'utf8');

  it('adds clinics.hep_require_pin (default true) and patient_hep_access.pin_code', () => {
    const s = sql();
    expect(s).toContain('add column if not exists hep_require_pin boolean not null default true');
    expect(s).toContain('add column if not exists pin_code text');
    expect(s).not.toMatch(/grant select.*pin_code/i);
  });

  it('adds staff-only get_patient_hep_pin RPC guarded by is_hep_staff', () => {
    const s = sql();
    expect(s).toContain('create or replace function public.get_patient_hep_pin(p_patient_id uuid)');
    expect(s).toContain('if v_clinic is null or not public.is_hep_staff(v_clinic) then');
    expect(s).toContain('grant execute on function public.get_patient_hep_pin(uuid) to authenticated;');
    expect(s).toContain('revoke all on function public.get_patient_hep_pin(uuid) from public, anon;');
  });

  it('never mixes a public.* row variable into a multi-item INTO list (catches Postgres record INTO bug)', () => {
    // Self-check that the detector catches the exact broken pattern that failed on live Postgres.
    const broken = `
      declare v_access public.patient_hep_access; v_require_pin boolean := true;
      begin
        select a.*, coalesce(c.hep_require_pin, true)
          into v_access, v_require_pin
          from public.patient_hep_access a
          join public.clinics c on c.id = a.clinic_id;
      end;
    `;
    expect(findRowVarMultiIntoBugs(broken)).toEqual(['into v_access, v_require_pin']);

    expect(findRowVarMultiIntoBugs(sql())).toEqual([]);
    const starterSql = readFileSync(resolve(process.cwd(), 'supabase/migrations/20261118110000_hep_starter_library.sql'), 'utf8');
    expect(findRowVarMultiIntoBugs(starterSql)).toEqual([]);
  });

  it('generates a random 4-digit PIN in create_program (never from phone) and honours hep_require_pin in hep_verify', () => {
    const s = sql();
    expect(s).not.toMatch(/v_phone_digits|right\(/i);
    expect(s).toContain('gen_random_bytes(2)');
    expect(s).toContain('if not v_require_pin then');
    expect(s).toContain('revoke all on function public.hep_verify(text, text, text) from public, anon, authenticated;');
  });
});
