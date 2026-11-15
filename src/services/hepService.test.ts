// @vitest-environment jsdom
import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { db } from '@/lib/db';
import { HEP_NEEDS_CONNECTION, hepService, itemToJson, mapProgramRow, type HepItemInput } from './hepService';
import type { Exercise } from '@/domain/hep';

const mockRpc = vi.fn();
const tables: Record<string, { data: unknown; error: { message: string } | null }> = {};
const seen: Array<{ table: string; calls: Array<[string, unknown[]]> }> = [];

/** A query builder that records its calls and resolves to the table's canned answer when awaited. */
function builder(table: string) {
  const rec = { table, calls: [] as Array<[string, unknown[]]> };
  seen.push(rec);
  const q: Record<string, unknown> = {};
  for (const m of ['select', 'eq', 'gte', 'in', 'not', 'order']) q[m] = (...a: unknown[]) => { rec.calls.push([m, a]); return q; };
  q.then = (resolve: (v: unknown) => unknown) => resolve(tables[table] ?? { data: [], error: null });
  return q;
}

vi.mock('@/lib/supabase', () => ({ getSupabase: () => ({ rpc: mockRpc, from: (t: string) => builder(t) }) }));
const schedule = vi.fn();
vi.mock('@/sync/engine', () => ({ syncEngine: { schedule: (...a: unknown[]) => schedule(...a) } }));

const item = (over: Partial<HepItemInput> = {}): HepItemInput => ({
  title: 'Wall Slides', bodyRegion: 'Shoulder', phase: 'mobility', instructions: 'Slide up', mediaType: 'none', mediaKeys: [], mediaCaptions: [], equipment: ['Wall'],
  doseType: 'reps', sets: 3, reps: 10, holdSeconds: null, durationSeconds: null, restSeconds: 30, sessionsPerDay: 2, side: 'none', optional: false, stopIf: '', ...over,
});

beforeEach(() => {
  mockRpc.mockReset();
  schedule.mockReset();
  seen.length = 0;
  for (const k of Object.keys(tables)) delete tables[k];
  Object.defineProperty(navigator, 'onLine', { value: true, configurable: true });
});

describe('creating and editing programs', () => {
  it('returns the one-time PIN and never sends a patient name or phone', async () => {
    mockRpc.mockResolvedValueOnce({ data: { programId: 'pr-1', patientId: 'pt-1', token: 'tok-1', pin: '4821' }, error: null });
    const res = await hepService.createProgram({ clinicId: 'c-1', patientId: 'pt-1', therapistId: null, title: 'Shoulder', items: [item()], settings: { durationDays: 14, sessionsPerDay: 2, feedbackDefault: 'effort' } });
    expect(res).toEqual({ programId: 'pr-1', patientId: 'pt-1', token: 'tok-1', pin: '4821' });
    const [name, args] = mockRpc.mock.calls[0];
    expect(name).toBe('create_program');
    expect(args).not.toHaveProperty('p_patient_name');
    expect(args).not.toHaveProperty('p_patient_phone');
    expect(args).toMatchObject({ p_clinic_id: 'c-1', p_patient_id: 'pt-1', p_settings: { durationDays: 14, sessionsPerDay: 2, feedbackDefault: 'effort' } });
    expect(args).not.toHaveProperty('p_today'); // the server uses the clinic's day unless one is passed
  });

  it('passes the clinic day and an explicit "ongoing" (null length) through', async () => {
    mockRpc.mockResolvedValueOnce({ data: { programId: 'p', patientId: 'x', token: 't', pin: null }, error: null });
    await hepService.createProgram({ clinicId: 'c', patientId: 'x', therapistId: null, title: 'T', items: [], today: '2026-11-13', settings: { durationDays: null } });
    expect(mockRpc.mock.calls[0][1]).toMatchObject({ p_today: '2026-11-13', p_settings: { durationDays: null } });
  });

  it("shows the database's own free-plan message when the Lite cap is hit", async () => {
    mockRpc.mockResolvedValueOnce({ data: null, error: { message: 'You have reached the free-plan limit of 5 active programs. Visit theranet.in to upgrade.' } });
    await expect(hepService.createProgram({ clinicId: 'c', patientId: 'p', therapistId: null, title: '6th', items: [] })).rejects.toThrow(/free-plan limit of 5 active programs.*theranet\.in/i);
  });

  it('sends the whole item list with ids on an edit, so a left-out exercise is removed on purpose', async () => {
    mockRpc.mockResolvedValueOnce({ data: null, error: null });
    await hepService.updateProgram({ programId: 'pr-1', title: 'Knee', status: 'active', items: [item({ id: 'pi-1' }), item({ title: 'New one' })], settings: { checkinOn: null } });
    const args = mockRpc.mock.calls[0][1];
    expect(args.p_items.map((i: { id?: string; title: string }) => [i.id, i.title])).toEqual([['pi-1', 'Wall Slides'], [undefined, 'New one']]);
    expect(args.p_settings).toEqual({ checkinOn: null });
  });

  it('itemToJson sends exactly the keys the database reads and drops the ones left out', () => {
    const json = itemToJson(item({ optional: true, specialInstructions: 'Red band' }));
    expect(JSON.parse(JSON.stringify(json))).toEqual({
      title: 'Wall Slides', bodyRegion: 'Shoulder', phase: 'mobility', instructions: 'Slide up', mediaType: 'none', mediaKeys: [], mediaCaptions: [], equipment: ['Wall'],
      doseType: 'reps', sets: 3, reps: 10, holdSeconds: null, durationSeconds: null, restSeconds: 30, sessionsPerDay: 2, side: 'none', optional: true, stopIf: '',
      specialInstructions: 'Red band',
    });
  });

  it('calls the right function for status, extend, pain review, PIN and link', async () => {
    mockRpc.mockResolvedValue({ data: null, error: null });
    await hepService.setProgramStatus('pr-1', 'paused');
    await hepService.extendProgram('pr-1', 14);
    await hepService.markPainReviewed('pr-1');
    await hepService.revokeLink('pt-1');
    mockRpc.mockResolvedValueOnce({ data: '0420', error: null });
    expect(await hepService.resetPin('pt-1')).toBe('0420');
    mockRpc.mockResolvedValueOnce({ data: 'newtoken', error: null });
    expect(await hepService.rotateToken('pt-1')).toBe('newtoken');
    expect(mockRpc.mock.calls.map((c) => c[0])).toEqual(['set_program_status', 'extend_program', 'mark_pain_reviewed', 'revoke_hep_link', 'reset_hep_pin', 'rotate_hep_token']);
    expect(mockRpc.mock.calls[1][1]).toEqual({ p_program_id: 'pr-1', p_extra_days: 14 });
  });

  it('reads the hand-over link status', async () => {
    mockRpc.mockResolvedValueOnce({ data: { firstOpenedAt: '2026-11-13T10:42:00Z', lastOpenedAt: '2026-11-13T10:42:00Z', openCount: 1, linkRevoked: false }, error: null });
    expect(await hepService.linkStatus('pt-1')).toEqual({ firstOpenedAt: '2026-11-13T10:42:00Z', lastOpenedAt: '2026-11-13T10:42:00Z', openCount: 1, linkRevoked: false });
    mockRpc.mockResolvedValueOnce({ data: { openCount: 0 }, error: null });
    expect(await hepService.linkStatus('pt-2')).toMatchObject({ firstOpenedAt: null, openCount: 0 });
  });
});

describe('writes need a connection', () => {
  it('refuses every write offline with the HEP message and never calls the server', async () => {
    Object.defineProperty(navigator, 'onLine', { value: false, configurable: true });
    await expect(hepService.createProgram({ clinicId: 'c', patientId: 'p', therapistId: null, title: 'T', items: [] })).rejects.toThrow(HEP_NEEDS_CONNECTION);
    await expect(hepService.resetPin('pt-1')).rejects.toThrow(HEP_NEEDS_CONNECTION);
    await expect(hepService.saveExercise({ clinicId: 'c', title: 'x', bodyRegion: 'Knee', phase: 'other', instructions: '', mediaType: 'none', defaultSets: 3, doseType: 'reps', defaultReps: 10, defaultHoldSeconds: null, defaultDurationSeconds: null, defaultRestSeconds: 30, defaultSessionsPerDay: 1, side: 'none', stopIf: '' })).rejects.toThrow(HEP_NEEDS_CONNECTION);
    expect(mockRpc).not.toHaveBeenCalled();
  });
});

describe('exercises', () => {
  it('saves an exercise with every field and asks the sync to bring it into the offline cache', async () => {
    mockRpc.mockResolvedValueOnce({ data: 'ex-9', error: null });
    const id = await hepService.saveExercise({
      clinicId: 'c-1', title: 'Quad Sets', otherNames: ['QS'], bodyRegion: 'Knee', alsoRegions: ['Hip'], equipment: ['Towel'], phase: 'activation', instructions: 'Tighten',
      mediaType: 'gif', mediaKeys: ['clinics/c-1/exercises/ex-9/0-ab12cd34'], mediaCaptions: ['Hold'], thumbKey: 'clinics/c-1/exercises/ex-9/thumb-ab12cd34',
      defaultSets: 3, doseType: 'hold', defaultReps: 12, defaultHoldSeconds: 10, defaultDurationSeconds: null, defaultRestSeconds: 30, defaultSessionsPerDay: 2, side: 'none', stopIf: 'Sharp pain',
    });
    expect(id).toBe('ex-9');
    expect(mockRpc.mock.calls[0][0]).toBe('save_exercise');
    expect(mockRpc.mock.calls[0][1]).toEqual({
      p_clinic_id: 'c-1', p_id: null, p_title: 'Quad Sets', p_body_region: 'Knee', p_phase: 'activation', p_also_regions: ['Hip'], p_equipment: ['Towel'], p_instructions: 'Tighten',
      p_media_type: 'gif', p_media_keys: ['clinics/c-1/exercises/ex-9/0-ab12cd34'], p_default_sets: 3, p_default_reps: 12, p_default_hold_seconds: 10, p_default_sessions_per_day: 2,
      p_side: 'none', p_stop_if: 'Sharp pain', p_deleted: false, p_dose_type: 'hold', p_default_duration_seconds: null, p_default_rest_seconds: 30, p_media_captions: ['Hold'],
      p_active: true, p_other_names: ['QS'], p_thumb_key: 'clinics/c-1/exercises/ex-9/thumb-ab12cd34', p_positions: [],
    });
    expect(schedule).toHaveBeenCalledWith(0);
  });

  it('sends the positions as p_positions, and an empty list when none are given', async () => {
    const input = { clinicId: 'c-1', title: 'x', bodyRegion: 'Knee', phase: 'other' as const, instructions: '', mediaType: 'none' as const, defaultSets: 3, doseType: 'reps' as const, defaultReps: 10, defaultHoldSeconds: null, defaultDurationSeconds: null, defaultRestSeconds: 30, defaultSessionsPerDay: 1 as const, side: 'none' as const, stopIf: '' };
    mockRpc.mockResolvedValue({ data: 'ex-9', error: null });
    await hepService.saveExercise({ ...input, positions: ['Supine'] });
    expect(mockRpc).toHaveBeenLastCalledWith('save_exercise', expect.objectContaining({ p_positions: ['Supine'] }));
    await hepService.saveExercise(input);
    expect(mockRpc).toHaveBeenLastCalledWith('save_exercise', expect.objectContaining({ p_positions: [] }));
  });

  it('archives with active = false', async () => {
    mockRpc.mockResolvedValueOnce({ data: 'ex-9', error: null });
    await hepService.saveExercise({ id: 'ex-9', clinicId: 'c-1', title: 'x', bodyRegion: 'Knee', phase: 'other', instructions: '', mediaType: 'none', defaultSets: 3, doseType: 'reps', defaultReps: 10, defaultHoldSeconds: null, defaultDurationSeconds: null, defaultRestSeconds: 30, defaultSessionsPerDay: 1, side: 'none', stopIf: '', active: false });
    expect(mockRpc.mock.calls[0][1]).toMatchObject({ p_id: 'ex-9', p_active: false, p_deleted: false });
  });

  it('toggles a favourite', async () => {
    mockRpc.mockResolvedValueOnce({ data: true, error: null });
    expect(await hepService.toggleExerciseFavorite('ex-1')).toBe(true);
  });

  it('lists the exercises prescribed since a date, once each, for "Used this week"', async () => {
    tables.program_items = { data: [{ source_exercise_id: 'e1' }, { source_exercise_id: 'e2' }, { source_exercise_id: 'e1' }], error: null };
    expect(await hepService.recentlyUsedExerciseIds('c-1', '2026-11-06')).toEqual(['e1', 'e2']);
    const rec = seen.find((r) => r.table === 'program_items')!;
    expect(rec.calls).toContainEqual(['eq', ['programs.clinic_id', 'c-1']]);
    expect(rec.calls).toContainEqual(['gte', ['added_on', '2026-11-06']]);
    delete tables.program_items;
  });

  it('counts uses per exercise through the grouped-count RPC, and gives {} on any error', async () => {
    mockRpc.mockResolvedValueOnce({ data: [{ exercise_id: 'e1', uses: 4 }, { exercise_id: 'e2', uses: 1 }], error: null });
    expect(await hepService.exerciseUseCounts('c-1')).toEqual({ e1: 4, e2: 1 });
    expect(mockRpc).toHaveBeenCalledWith('exercise_use_counts', { p_clinic_id: 'c-1' });
    mockRpc.mockResolvedValueOnce({ data: null, error: { message: 'boom' } });
    expect(await hepService.exerciseUseCounts('c-1')).toEqual({});
  });

  it('counts the programs and templates that carry a copy of an exercise', async () => {
    tables.program_items = { data: null, error: null, count: 3 } as never;
    tables.exercise_template_items = { data: null, error: null, count: 1 } as never;
    expect(await hepService.exerciseUsage('e1')).toEqual({ programs: 3, templates: 1 });
    delete tables.program_items;
    delete tables.exercise_template_items;
  });

  it('lists the clinic\'s cached exercises A to Z without archived or deleted ones (works offline)', async () => {
    const ex = (id: string, title: string, over: Partial<Exercise> = {}) => ({ id, clinicId: 'c-1', title, active: true, deleted: false, updatedAt: '2026-11-13T00:00:00Z', ...over }) as Exercise;
    await db.exercises.clear();
    await db.exercises.bulkPut([ex('1', 'Wall Slides'), ex('2', 'Ankle Pumps'), ex('3', 'Old one', { active: false }), ex('4', 'Gone', { deleted: true }), ex('5', 'Other clinic', { clinicId: 'c-2' })]);
    Object.defineProperty(navigator, 'onLine', { value: false, configurable: true });
    expect((await hepService.listCachedExercises('c-1')).map((e) => e.title)).toEqual(['Ankle Pumps', 'Wall Slides']);
    expect((await hepService.listCachedExercises('c-1', { includeArchived: true })).map((e) => e.title)).toEqual(['Ankle Pumps', 'Old one', 'Wall Slides']);
  });
});

describe('templates', () => {
  it('lists templates with their items in order and how often each was used', async () => {
    tables.exercise_templates = { error: null, data: [{ id: 't-1', clinic_id: 'c-1', title: 'ACL', note: null, deleted: false, created_at: 'a', updated_at: 'b', exercise_template_items: [{ id: 'i2', title: 'B', sort_order: 1 }, { id: 'i1', title: 'A', sort_order: 0 }] }] };
    tables.programs = { error: null, data: [{ source_template_id: 't-1' }, { source_template_id: 't-1' }, { source_template_id: 't-2' }] };
    const [t] = await hepService.listTemplates('c-1');
    expect(t).toMatchObject({ id: 't-1', title: 'ACL', usedCount: 2 });
    expect(t.items.map((i) => i.title)).toEqual(['A', 'B']);
  });

  it('saves a template with a note and its items', async () => {
    mockRpc.mockResolvedValueOnce({ data: 't-9', error: null });
    await hepService.saveTemplate({ clinicId: 'c-1', title: 'ACL', note: 'Weeks 0 to 2', items: [item()] });
    expect(mockRpc.mock.calls[0][1]).toMatchObject({ p_clinic_id: 'c-1', p_template_id: null, p_title: 'ACL', p_note: 'Weeks 0 to 2', p_deleted: false });
  });
});

describe('programs for the Programs tab and the chart', () => {
  const row = {
    id: 'pr-1', clinic_id: 'c-1', patient_id: 'pt-1', therapist_id: 'th-1', title: 'ACL', status: 'active', start_date: '2026-11-09', duration_days: 14, sessions_per_day: 2,
    patients: { name: 'Shiva Kumar' }, therapists: { name: 'Dr Kiran' },
    program_session_feedback: [{ id: 'f1', program_id: 'pr-1', log_date: '2026-11-13', session_index: 1, pain_score: 8, effort_score: null, pain_item_ids: ['pi-1'], hard_item_ids: [], created_at: 'x' }],
    program_items: [
      { id: 'pi-2', program_id: 'pr-1', title: 'Second', sort_order: 1, program_logs: [] },
      { id: 'pi-1', program_id: 'pr-1', title: 'First', sort_order: 0, program_logs: [{ id: 'l1', program_item_id: 'pi-1', log_date: '2026-11-13', session_index: 1, skipped: false, skip_reason: null }] },
    ],
  };

  it('builds one bundle: items in order, the logs flattened, feedback, names and the link state', () => {
    const b = mapProgramRow(row, { patient_id: 'pt-1', token: 'tok', link_revoked_at: null, open_count: 4, last_opened_at: '2026-11-13T09:10:00Z' });
    expect(b.program.items.map((i) => i.title)).toEqual(['First', 'Second']);
    expect(b.program.durationDays).toBe(14);
    expect(b.logs).toHaveLength(1);
    expect(b.logs[0]).toMatchObject({ programItemId: 'pi-1', logDate: '2026-11-13', sessionIndex: 1 });
    expect(b.sessionFeedback[0]).toMatchObject({ painScore: 8, painItemIds: ['pi-1'] });
    expect(b.patientName).toBe('Shiva Kumar');
    expect(b.therapistName).toBe('Dr Kiran');
    expect(b.access).toEqual({ token: 'tok', linkRevoked: false, openCount: 4, lastOpenedAt: '2026-11-13T09:10:00Z' });
    expect(mapProgramRow(row).access).toBeNull();
    expect(mapProgramRow({ ...row, therapists: null }).therapistName).toBeNull();
  });

  it('fetches by clinic with a log window, then the link state with columns listed (never select *)', async () => {
    tables.programs = { error: null, data: [row] };
    tables.patient_hep_access = { error: null, data: [{ patient_id: 'pt-1', token: 'tok', link_revoked_at: null, open_count: 1, last_opened_at: null }] };
    const out = await hepService.listClinicPrograms('c-1', '2026-10-30');
    expect(out).toHaveLength(1);
    expect(out[0].access?.token).toBe('tok');
    const programs = seen.find((s) => s.table === 'programs')!;
    expect(programs.calls).toContainEqual(['eq', ['clinic_id', 'c-1']]);
    expect(programs.calls).toContainEqual(['gte', ['program_items.program_logs.log_date', '2026-10-30']]);
    const access = seen.find((s) => s.table === 'patient_hep_access')!;
    const select = access.calls.find((c) => c[0] === 'select')![1][0] as string;
    expect(select).not.toContain('*');
    expect(select).not.toContain('pin_hash');
  });

  it('fetches one patient\'s programs', async () => {
    tables.programs = { error: null, data: [] };
    await hepService.listPatientPrograms('pt-1', '2026-10-30');
    expect(seen.find((s) => s.table === 'programs')!.calls).toContainEqual(['eq', ['patient_id', 'pt-1']]);
  });
});
