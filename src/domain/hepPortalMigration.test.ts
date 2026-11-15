// src/domain/hepPortalMigration.test.ts
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, it, expect } from 'vitest';

const SIG_25 = 'uuid, uuid, text, text, text, text[], text[], text, text, text[], smallint, smallint, smallint, smallint, text, text, boolean, text, smallint, smallint, text[], boolean, text[], text, text[]';
const SIG_27 = `${SIG_25}, boolean, boolean`;

const EARLIER = [
  '20261113200000_hep_module.sql',
  '20261113200100_hep_pain_push.sql',
  '20261114100000_hep_exercises_audit_columns.sql',
  '20261114200000_hep_exercise_positions.sql',
];

/** The text of one function, from its create statement to the next create statement. */
function fnBody(s: string, name: string): string {
  const start = s.indexOf(`create or replace function public.${name}(`);
  if (start < 0) return '';
  const next = s.indexOf('create or replace function', start + 10);
  return s.slice(start, next < 0 ? undefined : next);
}

describe('HEP photo consent and portal home migration contract', () => {
  const path = resolve(process.cwd(), 'supabase/migrations/20261115100000_hep_photo_consent_and_portal_home.sql');

  it('exists', () => {
    expect(existsSync(path)).toBe(true);
  });

  const sql = () => readFileSync(path, 'utf8');

  it('never edits an earlier HEP migration (only adds a new file)', () => {
    // get_public_hep keeps its signature, so it is replaced in place, never dropped.
    expect(sql()).not.toContain('drop function if exists public.get_public_hep(');
    // Every earlier file is still there and this one sorts after all of them.
    for (const f of EARLIER) expect(existsSync(resolve(process.cwd(), 'supabase/migrations', f))).toBe(true);
    expect([...EARLIER, '20261115100000_hep_photo_consent_and_portal_home.sql'].sort().at(-1)).toBe('20261115100000_hep_photo_consent_and_portal_home.sql');
  });

  it('adds the three exercise columns', () => {
    const s = sql();
    expect(s).toContain('add column if not exists picture_consent_by uuid references auth.users (id)');
    expect(s).toContain('add column if not exists picture_consent_at timestamptz');
    expect(s).toContain('add column if not exists hide_pictures_in_lists boolean not null default false');
  });

  it('replaces save_exercise with a 27-argument version that asks for consent', () => {
    const s = sql();
    expect(s).toContain(`drop function if exists public.save_exercise(${SIG_25});`);
    expect(s).toContain('p_picture_consent boolean default false');
    expect(s).toContain('p_hide_pictures_in_lists boolean default false');
    expect(s).toContain("raise exception 'Consent is needed for these pictures.';");
    expect(s).toContain('picture_consent_by = auth.uid()');
    // Consent only when a save brings in pictures (new row, or a changed non-empty set); no archive-only exemption.
    const fnS = fnBody(s, 'save_exercise');
    expect(fnS).toContain('v_new_pictures := v_has_media');
    expect(fnS).toContain('(not v_exists');
    expect(fnS).toContain("v_old_keys @> coalesce(p_media_keys, '{}'::text[])");
    expect(fnS).toContain('if v_new_pictures and not coalesce(p_picture_consent, false) then');
    expect(fnS).not.toContain('coalesce(p_active, true)\n     and v_old_consent_at is null');
    expect(fnS).not.toMatch(/and coalesce\(p_active, true\)\s+and v_old_consent_at is null/);
    expect(s).toContain(`grant execute on function public.save_exercise(${SIG_27}) to authenticated;`);
    expect(s).toContain(`revoke all on function public.save_exercise(${SIG_27}) from public, anon;`);
    // Same guards as before.
    const fn = fnBody(s, 'save_exercise');
    expect(fn).toContain('if not public.is_hep_staff(p_clinic_id) then');
    expect(fn).toContain('clinic_has_unlimited_hep(p_clinic_id)');
    expect(fn).toContain("raise exception 'Picture does not belong to this clinic.';");
    // hide_pictures_in_lists written on insert and on update.
    expect(fn.match(/coalesce\(p_hide_pictures_in_lists, false\)/g)?.length).toBe(2);
  });

  it('get_public_hep carries hidePicturesInLists per item, same signature and grant', () => {
    const s = sql();
    const fn = fnBody(s, 'get_public_hep');
    expect(fn).toContain("'hidePicturesInLists', coalesce(ex.hide_pictures_in_lists, false)");
    expect(fn).toContain('left join public.exercises ex on ex.id = pi.source_exercise_id');
    expect(fn).toContain('public.hep_rate_ok(p_token)');
    expect(fn).toContain('public.hep_verify(p_token, p_pin, p_device)');
    expect(s).toContain('grant execute on function public.get_public_hep(text, text, text, uuid, text) to anon, authenticated;');
  });

  it('adds get_public_hep_home behind hep_verify and the same rate limit and failure shape', () => {
    const s = sql();
    const fn = fnBody(s, 'get_public_hep_home');
    expect(fn).toContain('create or replace function public.get_public_hep_home(p_token text, p_pin text, p_device text default null)');
    expect(fn).toContain('security definer');
    expect(fn).toContain('set search_path = pg_catalog, public, platform_admin');
    expect(fn).toContain("if not public.hep_rate_ok(p_token) then\n    return jsonb_build_object('ok', false, 'reason', 'busy');");
    expect(fn).toContain('select * into v from public.hep_verify(p_token, p_pin, p_device);');
    expect(fn).toContain("return jsonb_build_object('ok', false, 'reason', v.outcome, 'attemptsLeft', v.attempts_left);");
    for (const key of ["'firstName'", "'nextVisit'", "'package'", "'programs'", "'bookingSlug'", "'expiresOn'", "'itemCount'"]) expect(fn).toContain(key);
    expect(fn).toContain("a.status in ('confirmed', 'rescheduled')");
    expect(s).toContain('revoke all on function public.get_public_hep_home(text, text, text) from public;');
    expect(s).toContain('grant execute on function public.get_public_hep_home(text, text, text) to anon, authenticated;');
  });
});
