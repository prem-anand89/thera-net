import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { IMAGE_SOURCES } from './hep';

const OLD_PUB_SIG = 'uuid, uuid, uuid, text, text[], text, text[], text, text[], text[], text[], text, text, text, text[], text[], text, text, smallint, smallint, smallint, smallint, smallint, smallint, text';
const NEW_PUB_SIG = `${OLD_PUB_SIG}, text, text`;

describe('TheraNet Library curation migration contract', () => {
  const path = resolve(process.cwd(), 'supabase/migrations/20261118130000_hep_library_curation.sql');
  const sql = () => readFileSync(path, 'utf8');

  it('exists', () => {
    expect(existsSync(path)).toBe(true);
  });

  it('adds image_source (four allowed values) and image_note (200 chars) to starter_exercises', () => {
    const s = sql();
    expect(s).toContain("check (image_source in ('own_photography', 'ai_generated', 'illustration', 'licensed'))");
    expect(s).toContain('check (length(image_note) <= 200)');
  });

  it('allows exactly the picture sources the app offers', () => {
    const m = sql().match(/check \(image_source in \(([^)]*)\)\)/);
    expect(m).not.toBeNull();
    const fromSql = (m?.[1] ?? '').split(',').map((v) => v.trim().replace(/'/g, ''));
    expect(fromSql).toEqual([...IMAGE_SOURCES]);
  });

  it('lets a curator clinic read its own removed rows, everyone else active rows only', () => {
    expect(sql()).toContain('using (active = true or public.is_starter_curator(source_clinic_id))');
  });

  it('replaces publish_starter_exercise: drops the 25-argument overload, grants only the 27-argument one', () => {
    const s = sql();
    expect(s).toContain(`drop function if exists public.publish_starter_exercise(${OLD_PUB_SIG});`);
    expect(s).toContain('p_image_source text default null,');
    expect(s).toContain('p_image_note text default null');
    expect(s).toContain(`revoke all on function public.publish_starter_exercise(${NEW_PUB_SIG}) from public, anon;`);
    expect(s).toContain(`grant execute on function public.publish_starter_exercise(${NEW_PUB_SIG}) to authenticated;`);
  });

  it('keeps the curator check first and refuses pictures without a source', () => {
    const s = sql();
    const fn = s.slice(s.indexOf('create or replace function public.publish_starter_exercise'), s.indexOf('create table if not exists public.exercise_origins'));
    expect(fn.indexOf('is_starter_curator(p_clinic_id)')).toBeGreaterThan(-1);
    expect(fn.indexOf('is_starter_curator(p_clinic_id)')).toBeLessThan(fn.indexOf("Say where the pictures come from."));
    expect(fn).toContain("raise exception 'Say where the pictures come from.'");
    expect(fn).toContain('image_source = excluded.image_source');
    expect(fn).toContain('image_note = excluded.image_note');
  });

  it('creates exercise_origins readable by HEP staff only, with no write policies', () => {
    const s = sql();
    expect(s).toContain('create table if not exists public.exercise_origins');
    expect(s).toContain('exercise_id uuid primary key references public.exercises (id) on delete cascade');
    expect(s).toContain("check (source_kind in ('library', 'public'))");
    expect(s).toContain('alter table public.exercise_origins enable row level security;');
    expect(s).toContain('using (public.is_hep_staff(clinic_id))');
    expect(s).toContain('revoke all on public.exercise_origins from anon, authenticated;');
    expect(s).toContain('grant select on public.exercise_origins to authenticated;');
    expect(s).not.toMatch(/for (insert|update|delete|all)\b/i);
  });

  it('record_exercise_origin checks staff, then the exercise, then the source, and is authenticated-only', () => {
    const s = sql();
    const fn = s.slice(s.indexOf('create or replace function public.record_exercise_origin'));
    const staff = fn.indexOf('is_hep_staff(p_clinic_id)');
    const exercise = fn.indexOf('Exercise not found.');
    const source = fn.indexOf('That library exercise is not available.');
    expect(staff).toBeGreaterThan(-1);
    expect(staff).toBeLessThan(exercise);
    expect(exercise).toBeLessThan(source);
    expect(fn).toContain("raise exception 'The public library is not available yet.'");
    expect(fn).toContain('s.id = p_source_id and s.active');
    expect(s).toContain('revoke all on function public.record_exercise_origin(uuid, uuid, text, uuid, timestamptz) from public, anon;');
    expect(s).toContain('grant execute on function public.record_exercise_origin(uuid, uuid, text, uuid, timestamptz) to authenticated;');
  });

  it('has no select ... into with more than one target (the Postgres record INTO bug)', () => {
    const multi = [...sql().matchAll(/\binto\s+([a-z_][a-z0-9_]*\s*,\s*[a-z_][a-z0-9_,\s]*)/gi)]
      .map((m) => m[1].trim())
      .filter((t) => !/^public\./i.test(t) && !/^\(/.test(t));
    // The only "into" in this file is on insert; an INSERT INTO list never starts with a bare comma-separated variable list.
    expect(multi.filter((t) => /^v_/.test(t))).toEqual([]);
  });
});
