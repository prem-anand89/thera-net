// src/domain/hepRpcContract.test.ts
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, it, expect } from 'vitest';

describe('HEP Locked Database Migration Contract', () => {
  const migrationPath = resolve(
    process.cwd(),
    'supabase/migrations/20261113200000_hep_module.sql'
  );

  it('defines clinic-owned tables with sync triggers, no global seed, and no public media_url column', () => {
    expect(existsSync(migrationPath)).toBe(true);
    const sql = readFileSync(migrationPath, 'utf8');

    expect(sql).toContain('create table if not exists public.exercises');
    expect(sql).toContain('clinic_id uuid not null references public.clinics(id)');
    expect(sql).toContain('media_keys text[] not null');
    expect(sql).not.toContain('media_url');
    // No seed rows: the only insert into exercises is the one inside save_exercise.
    const inserts = [...sql.matchAll(/insert into public\.exercises\b/g)].map((m) => m.index ?? -1);
    const saveStart = sql.indexOf('create or replace function public.save_exercise');
    const saveEnd = sql.indexOf('create or replace function public.save_template');
    expect(inserts).toHaveLength(1);
    expect(inserts[0]).toBeGreaterThan(saveStart);
    expect(inserts[0]).toBeLessThan(saveEnd);
    expect(sql).toContain('create trigger exercises_tombstone');
    expect(sql).toContain('create trigger exercises_updated');
    expect(sql).toContain('alter publication supabase_realtime add table public.exercises');

    expect(sql).toContain('create table if not exists public.exercise_templates');
    expect(sql).toContain('create table if not exists public.exercise_template_items');
    expect(sql).toContain('create table if not exists public.programs');
    expect(sql).toContain('create table if not exists public.program_items');
    expect(sql).toContain('create table if not exists public.patient_hep_access');
    expect(sql).toContain('create table if not exists public.program_logs');
    expect(sql).toContain('unique (program_item_id, log_date, session_index)');
  });

  it('uses deleted_at/updated_at on patients and enforces Lite caps, PIN lockout, and reversible skip in RPCs', () => {
    const sql = readFileSync(migrationPath, 'utf8');

    expect(sql).toContain('and deleted_at is null');
    expect(sql).not.toContain('coalesce(deleted, false)');
    expect(sql).toContain('create or replace function public.clinic_has_unlimited_hep');
    expect(sql).toContain('valid_until >= platform_admin.clinic_today');
    expect(sql).toContain('free-plan limit');
    expect(sql).toContain('theranet.in');
    expect(sql).toContain('create or replace function public.hep_tier_limits');
    expect(sql).toContain('hep_tier_limits(');
    expect(sql).not.toContain('v_count >= 10');
    expect(sql).toContain('create or replace function public.hep_verify');
    expect(sql).toContain('create table if not exists public.hep_device_sessions');
    expect(sql).toContain('create or replace function public.hep_remember_device');
    expect(sql).toContain('grant execute on function public.hep_remember_device(text, text) to anon, authenticated');
    expect(sql).not.toContain('pin_override');
    expect(sql).toContain('pin_hash');
    // Staff can read the link state but never the PIN hash (offline-guessable); remembered phones have no client access.
    expect(sql).toContain('revoke select on public.patient_hep_access from anon, authenticated');
    expect(sql).not.toMatch(/grant select \([^)]*pin_hash[^)]*\) on public\.patient_hep_access/);
    expect(sql).toContain('revoke all on public.hep_device_sessions from anon, authenticated');
    expect(sql).not.toContain('right(regexp_replace');
    expect(sql).toContain('v_new >= 5');
    expect(sql).toContain("interval '15 minutes'");
    expect(sql).toContain('revoke execute on function public.rotate_hep_token(uuid) from public, anon');
    expect(sql).toContain('grant execute on function public.get_public_hep(text, text, text, uuid, text) to anon, authenticated');
    expect(sql).toContain(
      'grant execute on function public.submit_exercise_log(text, text, uuid, smallint, date, boolean, text, text) to anon, authenticated'
    );
    expect(sql).toContain(
      'grant execute on function public.undo_exercise_skip(text, text, uuid, smallint, date, text) to anon, authenticated'
    );
    expect(sql).toContain('grant execute on function public.hep_clinic_brand(text) to anon, authenticated');
    expect(sql).toContain('create table if not exists public.program_session_feedback');
    expect(sql).toContain('create or replace function public.submit_hep_session_feedback');
    expect(sql).toContain('create or replace function public.mark_pain_reviewed');
    expect(sql).toContain('create or replace function public.hep_rate_ok');
    expect(sql).not.toMatch(/create table if not exists public\.program_logs \([^;]*pain_score/); // pain lives on the session check now
    expect(sql).toContain("'hep_reminder'");
  });
});
