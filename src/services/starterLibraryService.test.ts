import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Exercise } from '@/domain/hep';
import { STARTER_EXERCISES } from '@/domain/hepStarterSet';
import { starterLibraryService } from './starterLibraryService';

const { mockFrom, mockRpc, cloneToStarter } = vi.hoisted(() => ({
  mockFrom: vi.fn(),
  mockRpc: vi.fn(),
  cloneToStarter: vi.fn(),
}));
vi.mock('@/lib/supabase', () => ({ getSupabase: () => ({ from: mockFrom, rpc: mockRpc }) }));
vi.mock('./hepMediaService', () => ({
  hepMediaService: { cloneToStarter: (...a: unknown[]) => cloneToStarter(...a) },
}));

const ex = (over: Partial<Exercise> = {}): Exercise => ({
  id: 'ex-1', clinicId: 'c-bm', title: 'Hip Flexor Stretch', otherNames: [], bodyRegion: 'Hip', alsoRegions: [],
  equipment: ['Mat'], phase: 'stretching', alsoPhases: ['mobility'], positions: ['Kneeling'],
  instructions: 'Kneel\nLean forward', mediaType: 'stills',
  mediaKeys: ['clinics/c-bm/exercises/ex-1/0-aaaaaaaa', 'clinics/c-bm/exercises/ex-1/1-bbbbbbbb'],
  mediaCaptions: ['Start', 'End'], thumbKey: 'clinics/c-bm/exercises/ex-1/thumb-cccccccc',
  defaultSets: 1, doseType: 'hold', defaultReps: 3, defaultHoldSeconds: 30, defaultDurationSeconds: null,
  defaultRestSeconds: 30, defaultSessionsPerDay: 1, side: 'both', stopIf: 'Sharp pain',
  isFavorite: false, active: true, deleted: false, version: 1, createdAt: '', updatedAt: '', ...over,
});

beforeEach(() => {
  mockFrom.mockReset();
  mockRpc.mockReset();
  cloneToStarter.mockReset();
  Object.defineProperty(navigator, 'onLine', { value: true, configurable: true });
});

describe('starterLibraryService', () => {
  it('falls back to static STARTER_EXERCISES when DB returns empty or errors', async () => {
    mockFrom.mockReturnValue({
      select: () => ({ eq: () => ({ order: async () => ({ data: [], error: null }) }) }),
    });
    const list = await starterLibraryService.listStarterItems();
    expect(list).toHaveLength(STARTER_EXERCISES.length);
    expect(list[0].mediaKeys).toEqual([]);
  });

  it('merges DB rows with unshadowed built-in STARTER_EXERCISES matching titles case-insensitively', async () => {
    const firstBuiltIn = STARTER_EXERCISES[0];
    mockFrom.mockReturnValue({
      select: () => ({
        eq: () => ({
          order: async () => ({
            data: [
              {
                id: 'st-db-1',
                title: `  ${firstBuiltIn.title.toUpperCase()}  `,
                other_names: [],
                body_region: firstBuiltIn.region,
                also_regions: [],
                equipment: firstBuiltIn.equipment ?? [],
                phase: firstBuiltIn.phase,
                also_phases: [],
                positions: firstBuiltIn.positions,
                instructions: firstBuiltIn.steps.join('\n'),
                stop_if: null,
                media_type: 'stills',
                media_keys: ['starter/exercises/st-db-1/0-aaaaaaaa'],
                media_captions: ['End'],
                thumb_key: 'starter/exercises/st-db-1/thumb-bbbbbbbb',
                dose_type: 'hold',
                default_sets: 1,
                default_reps: 5,
                default_hold_seconds: 20,
                default_duration_seconds: null,
                default_rest_seconds: 30,
                default_sessions_per_day: 1,
                side: 'none',
                published_at: '2026-11-18T00:00:00Z',
              },
            ],
            error: null,
          }),
        }),
      }),
    });
    const list = await starterLibraryService.listStarterItems();
    expect(list).toHaveLength(STARTER_EXERCISES.length);
    expect(list[0].id).toBe('st-db-1');
    expect(list[0].mediaKeys).toEqual(['starter/exercises/st-db-1/0-aaaaaaaa']);
    const matches = list.filter((i) => i.title.trim().toLowerCase() === firstBuiltIn.title.trim().toLowerCase());
    expect(matches).toHaveLength(1);
    expect(list.some((i) => i.title === STARTER_EXERCISES[1].title)).toBe(true);
  });

  it('publishes an exercise, cloning its R2 images to starter/exercises and calling publish_starter_exercise', async () => {
    mockFrom.mockReturnValue({
      select: () => ({ eq: () => ({ eq: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null, error: null }) }) }) }) }),
    });
    cloneToStarter.mockResolvedValue({
      mediaKeys: ['starter/exercises/st-9/0-new11111', 'starter/exercises/st-9/1-new22222'],
      thumbKey: 'starter/exercises/st-9/thumb-new33333',
    });
    mockRpc.mockResolvedValue({ data: 'st-9', error: null });

    const id = await starterLibraryService.publishExercise('c-bm', ex(), 'st-9');
    expect(id).toBe('st-9');
    expect(cloneToStarter).toHaveBeenCalledWith('c-bm', 'st-9', ['clinics/c-bm/exercises/ex-1/0-aaaaaaaa', 'clinics/c-bm/exercises/ex-1/1-bbbbbbbb'], 'clinics/c-bm/exercises/ex-1/thumb-cccccccc');
    expect(mockRpc).toHaveBeenCalledWith('publish_starter_exercise', expect.objectContaining({
      p_clinic_id: 'c-bm',
      p_source_exercise_id: 'ex-1',
      p_starter_id: 'st-9',
      p_also_phases: ['mobility'],
      p_media_keys: ['starter/exercises/st-9/0-new11111', 'starter/exercises/st-9/1-new22222'],
      p_thumb_key: 'starter/exercises/st-9/thumb-new33333',
    }));
  });

  it('refuses to publish exercises with "Hide pictures in lists" enabled', async () => {
    await expect(starterLibraryService.publishExercise('c-bm', ex({ hidePicturesInLists: true }))).rejects.toThrow(/Hide pictures in lists/);
    expect(cloneToStarter).not.toHaveBeenCalled();
  });

  it('unpublishes an entry via unpublish_starter_exercise', async () => {
    mockRpc.mockResolvedValue({ data: null, error: null });
    await starterLibraryService.unpublishExercise('c-bm', 'st-9');
    expect(mockRpc).toHaveBeenCalledWith('unpublish_starter_exercise', { p_clinic_id: 'c-bm', p_starter_id: 'st-9' });
  });
});

describe('starterLibraryService.publishMany and provenance', () => {
  it('sends the image source and note with the publish call when there are pictures', async () => {
    const chain: Record<string, unknown> = { eq: () => chain, maybeSingle: async () => ({ data: null, error: null }) };
    mockFrom.mockReturnValue({ select: () => chain });
    cloneToStarter.mockResolvedValue({ mediaKeys: ['starter/exercises/s/0-aaaaaaaa'], thumbKey: null });
    mockRpc.mockResolvedValue({ data: 's', error: null });
    await starterLibraryService.publishExercise('c-bm', ex(), null, { imageSource: 'ai_generated', imageNote: 'checked' });
    expect(mockRpc).toHaveBeenCalledWith('publish_starter_exercise', expect.objectContaining({ p_image_source: 'ai_generated', p_image_note: 'checked' }));
  });

  it('skips archived and hidden-picture exercises, keeps going after a failure, and reports each', async () => {
    const chain: Record<string, unknown> = { eq: () => chain, maybeSingle: async () => ({ data: null, error: null }) };
    mockFrom.mockReturnValue({ select: () => chain });
    cloneToStarter.mockResolvedValue({ mediaKeys: ['starter/exercises/s/0-aaaaaaaa'], thumbKey: null });
    mockRpc.mockImplementation(async (_fn: string, args: { p_title: string }) =>
      args.p_title === 'Bad' ? { data: null, error: { message: 'nope' } } : { data: 'id', error: null });
    const progress = vi.fn();
    const result = await starterLibraryService.publishMany(
      'c-bm',
      [ex({ id: 'a', title: 'Good' }), ex({ id: 'b', title: 'Old', active: false }), ex({ id: 'c', title: 'Hidden', hidePicturesInLists: true }), ex({ id: 'd', title: 'Bad' }), ex({ id: 'e', title: 'Good 2' })],
      { imageSource: 'own_photography', imageNote: null },
      progress,
    );
    expect(result.published).toBe(2);
    expect(result.skipped.map((s) => [s.id, s.reason])).toEqual([['b', 'it is archived'], ['c', 'its pictures are hidden in lists'], ['d', 'nope']]);
    expect(progress).toHaveBeenLastCalledWith(5, 5);
  });

  it('republishing reuses the id of a row that was removed from the library (one row per clinic exercise)', async () => {
    const chain: Record<string, unknown> = { eq: () => chain, maybeSingle: async () => ({ data: { id: 'old-row' }, error: null }) };
    mockFrom.mockReturnValue({ select: () => chain });
    cloneToStarter.mockResolvedValue({ mediaKeys: ['starter/exercises/old-row/0-aaaaaaaa'], thumbKey: null });
    mockRpc.mockResolvedValue({ data: 'old-row', error: null });
    await starterLibraryService.publishExercise('c-bm', ex(), null, { imageSource: 'licensed', imageNote: null });
    expect(cloneToStarter).toHaveBeenCalledWith('c-bm', 'old-row', expect.any(Array), expect.anything());
    expect(mockRpc).toHaveBeenCalledWith('publish_starter_exercise', expect.objectContaining({ p_starter_id: 'old-row' }));
  });
});
