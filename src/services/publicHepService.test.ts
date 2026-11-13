// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { publicHepService } from './publicHepService';

const mockRpc = vi.fn();
const mockInvoke = vi.fn();
vi.mock('@/lib/supabase', () => ({ getSupabase: () => ({ rpc: mockRpc, functions: { invoke: mockInvoke } }) }));

beforeEach(() => {
  mockRpc.mockReset();
  mockInvoke.mockReset();
});

describe('the patient page calls', () => {
  it('treats a wrong PIN or a lock as a value with attempts left, not an exception', async () => {
    mockInvoke.mockResolvedValueOnce({ data: { ok: false, reason: 'wrong_pin', attemptsLeft: 3 }, error: null });
    expect(await publicHepService.getPublicHep({ token: 'tok', pin: '0000' })).toEqual({ ok: false, reason: 'wrong_pin', attemptsLeft: 3 });
    mockInvoke.mockResolvedValueOnce({ data: { ok: false, reason: 'locked', attemptsLeft: 0 }, error: null });
    expect(await publicHepService.getPublicHep({ token: 'tok', pin: '0000' })).toEqual({ ok: false, reason: 'locked', attemptsLeft: 0 });
  });

  it('asks hep-media for the page with the credential, program and refresh reason', async () => {
    mockInvoke.mockResolvedValueOnce({ data: { ok: true, clinicId: 'c-1', items: [] }, error: null });
    const res = await publicHepService.getPublicHep({ token: 'tok', device: 'dev1', programId: 'p-1', reason: 'refresh' });
    expect(res.ok).toBe(true);
    expect(mockInvoke).toHaveBeenCalledWith('hep-media', { body: { action: 'get_public_hep', token: 'tok', pin: null, device: 'dev1', programId: 'p-1', reason: 'refresh' } });
  });

  it('reads the busy answer out of a 429 from the edge function', async () => {
    const context = { json: async () => ({ ok: false, reason: 'busy' }) };
    mockInvoke.mockResolvedValueOnce({ data: null, error: { message: 'Edge Function returned a non-2xx status code', context } });
    expect(await publicHepService.getPublicHep({ token: 'tok', pin: '1234' })).toEqual({ ok: false, reason: 'busy' });
  });

  it('throws on a real transport failure (the page treats it as offline)', async () => {
    mockInvoke.mockResolvedValueOnce({ data: null, error: { message: 'Failed to fetch' } });
    await expect(publicHepService.getPublicHep({ token: 'tok', pin: '1234' })).rejects.toThrow('Failed to fetch');
  });

  it('logs a session with the skip reason and the clinic day, and sends nothing it should not', async () => {
    mockRpc.mockResolvedValueOnce({ data: { ok: true, logDate: '2026-11-13' }, error: null });
    const res = await publicHepService.submitExerciseLog({ token: 'tok', pin: '1234', itemId: 'i-1', sessionIndex: 2, logDate: '2026-11-13', skipped: true, skipReason: 'pain' });
    expect(res).toEqual({ ok: true, logDate: '2026-11-13' });
    expect(mockRpc).toHaveBeenCalledWith('submit_exercise_log', {
      p_token: 'tok', p_pin: '1234', p_item_id: 'i-1', p_session_index: 2, p_log_date: '2026-11-13', p_skipped: true, p_skip_reason: 'pain', p_device: null,
    });
  });

  it('uses the remembered-phone token instead of a PIN', async () => {
    mockRpc.mockResolvedValueOnce({ data: { ok: true }, error: null });
    await publicHepService.undoExerciseLog({ token: 'tok', device: 'dev1', itemId: 'i-1', sessionIndex: 1 });
    expect(mockRpc.mock.calls[0][1]).toMatchObject({ p_pin: null, p_device: 'dev1' });
  });

  it('returns pin_needed (no attempt counted) when the remembered phone has expired', async () => {
    mockRpc.mockResolvedValueOnce({ data: { ok: false, reason: 'pin_needed', attemptsLeft: 5 }, error: null });
    expect(await publicHepService.submitExerciseLog({ token: 'tok', device: 'old', itemId: 'i', sessionIndex: 1 })).toEqual({ ok: false, reason: 'pin_needed', attemptsLeft: 5 });
  });

  it('submits the end-of-session check with the marked exercises', async () => {
    mockRpc.mockResolvedValueOnce({ data: { ok: true }, error: null });
    await publicHepService.submitSessionFeedback({ token: 'tok', pin: '1234', programId: 'p-1', sessionIndex: 1, pain: 8, painItemIds: ['i-1'] });
    expect(mockRpc).toHaveBeenCalledWith('submit_hep_session_feedback', {
      p_token: 'tok', p_pin: '1234', p_program_id: 'p-1', p_session_index: 1, p_log_date: null, p_pain: 8, p_effort: null, p_pain_items: ['i-1'], p_hard_items: [], p_device: null,
    });
  });

  it('gets the clinic brand before the PIN, and a failure for an unknown link', async () => {
    mockRpc.mockResolvedValueOnce({ data: { ok: true, name: 'Sunrise Physio', logoPath: null }, error: null });
    expect(await publicHepService.clinicBrand('tok')).toEqual({ ok: true, name: 'Sunrise Physio', logoPath: null });
    mockRpc.mockResolvedValueOnce({ data: { ok: false, reason: 'unavailable' }, error: null });
    expect(await publicHepService.clinicBrand('nope')).toEqual({ ok: false, reason: 'unavailable' });
  });

  it('remembers the phone and returns the device token once', async () => {
    mockRpc.mockResolvedValueOnce({ data: { ok: true, device: 'abc' }, error: null });
    expect(await publicHepService.rememberDevice('tok', '1234')).toEqual({ ok: true, device: 'abc' });
    expect(mockRpc).toHaveBeenCalledWith('hep_remember_device', { p_token: 'tok', p_pin: '1234' });
  });

  it('throws a database error (not a bad PIN)', async () => {
    mockRpc.mockResolvedValueOnce({ data: null, error: { message: 'connection reset' } });
    await expect(publicHepService.clinicBrand('tok')).rejects.toThrow('connection reset');
  });
});
