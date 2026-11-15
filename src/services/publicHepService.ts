// HEP, the patient's side (the /p/$token page). No login: the link token plus the 4-digit PIN (or a remembered phone's
// device token) is the credential. Every call returns a VALUE like { ok: false, reason: 'wrong_pin', attemptsLeft: 3 };
// the server never raises on a bad PIN (a raise would roll back the failed-attempt count). Only a network or server
// failure throws, and the page treats that as "offline" (the queued tap is sent later).
import { getSupabase } from '@/lib/supabase';
import type { DoseType, ExercisePhase, ExerciseSide, SessionsPerDay, SkipReason } from '@/domain/hep';

export type PublicHepReason = 'wrong_pin' | 'locked' | 'unavailable' | 'pin_needed' | 'busy' | 'not_in_program' | 'invalid' | 'too_old';

export interface PublicFailure {
  ok: false;
  reason: PublicHepReason;
  attemptsLeft?: number;
}

export interface PublicHepItem {
  id: string;
  title: string;
  phase: ExercisePhase;
  equipment: string[];
  instructions: string;
  mediaType: 'none' | 'gif' | 'stills';
  /** Short-lived signed picture URLs (no raw keys ever reach the page). */
  mediaUrls: string[];
  mediaCaptions: string[];
  doseType: DoseType;
  sets: number;
  reps: number | null;
  holdSeconds: number | null;
  durationSeconds: number | null;
  restSeconds: number;
  sessionsPerDay: SessionsPerDay;
  sessionsSchedule: Array<{ from: string; sessionsPerDay: SessionsPerDay }>;
  side: ExerciseSide;
  optional: boolean;
  stopIf: string;
  specialInstructions: string;
  sortOrder: number;
  addedOn: string;
  /** The therapist chose "Hide pictures in lists": the checklist shows the name only, the exercise page still shows pictures. */
  hidePicturesInLists: boolean;
}

export interface PublicHepPayload {
  ok: true;
  clinicId: string;
  /** The clinic's day, so the page and the server agree on "today". */
  today: string;
  clinic: { name: string; logoPath: string | null; phone: string | null; timezone: string };
  programs: Array<{ id: string; title: string; startDate: string; durationDays: number | null; feedbackDefault: 'pain' | 'effort'; prescribedBy: string | null }>;
  shownProgramId: string | null;
  items: PublicHepItem[];
  logs: Array<{ programItemId: string; logDate: string; sessionIndex: SessionsPerDay; skipped: boolean; skipReason: SkipReason | null; completedAt: string }>;
  sessionFeedback: Array<{ sessionIndex: SessionsPerDay; pain: number | null; effort: number | null; painItemIds: string[]; hardItemIds: string[] }>;
}

/** The patient's Home tab: only this patient's own next booking, open package progress and programs. */
export interface PublicHepHome {
  ok: true;
  /** First word of the patient's name; null when the name is empty. */
  firstName: string | null;
  /** The clinic's public booking slug for "Book a visit"; null when online booking is off. */
  bookingSlug: string | null;
  /** The earliest confirmed or rescheduled booking still to come. */
  nextVisit: { at: string; therapistName: string | null; location: 'clinic' | 'home' | 'ward' } | null;
  /** The newest open package (sessions left, not past its last valid day). */
  package: { name: string | null; done: number; total: number; expiresOn: string | null } | null;
  /** Active, paused and completed programs, newest first. */
  programs: Array<{ id: string; title: string; status: 'active' | 'paused' | 'completed'; startDate: string; durationDays: number | null; itemCount: number }>;
}

/** A call that answers only ok or a failure. */
type Empty = object;

export type PublicResult<T> = ({ ok: true } & T) | PublicFailure;

/** The credential every call carries: the link token, and the PIN or the remembered phone's device token. */
export interface PublicCredential {
  token: string;
  pin?: string | null;
  device?: string | null;
}

function client() {
  const supabase = getSupabase();
  if (!supabase) throw new Error('Supabase is not configured');
  return supabase;
}

const asFailure = (data: Record<string, unknown>): PublicFailure => ({
  ok: false,
  reason: (data.reason as PublicHepReason) ?? 'unavailable',
  ...(typeof data.attemptsLeft === 'number' ? { attemptsLeft: data.attemptsLeft } : {}),
});

/** Turns an RPC answer into a value; a database error (not a bad PIN) is thrown. */
function fromRpc<T extends object>(res: { data: unknown; error: { message: string } | null }): PublicResult<T> {
  if (res.error) throw new Error(res.error.message);
  const data = (res.data ?? {}) as Record<string, unknown>;
  return data.ok === true ? ({ ...data } as unknown as PublicResult<T>) : asFailure(data);
}

/** A non-2xx answer from hep-media still carries our { ok: false, reason } body (for example 429 busy). */
async function edgeFailure(error: unknown): Promise<PublicFailure | null> {
  const ctx = (error as { context?: unknown })?.context;
  if (ctx && typeof (ctx as Response).json === 'function') {
    try {
      const body = (await (ctx as Response).json()) as Record<string, unknown>;
      if (body && body.ok === false && typeof body.reason === 'string') return asFailure(body);
    } catch {
      /* not JSON: treat as a transport failure */
    }
  }
  return null;
}

export const publicHepService = {
  /** Before the PIN: the clinic's name and logo for a valid, non-revoked link, and nothing else. */
  async clinicBrand(token: string): Promise<PublicResult<{ name: string; logoPath: string | null }>> {
    return fromRpc<{ name: string; logoPath: string | null }>(await client().rpc('hep_clinic_brand', { p_token: token }));
  },

  /** The page's data with signed picture URLs, through the hep-media edge function. */
  async getPublicHep(cred: PublicCredential & { programId?: string | null; reason?: 'open' | 'refresh' }): Promise<PublicResult<Omit<PublicHepPayload, 'ok'>>> {
    const { data, error } = await client().functions.invoke('hep-media', {
      body: { action: 'get_public_hep', token: cred.token, pin: cred.pin ?? null, device: cred.device ?? null, programId: cred.programId ?? null, reason: cred.reason ?? 'open' },
    });
    if (error) {
      const failure = await edgeFailure(error);
      if (failure) return failure;
      throw new Error(error.message);
    }
    const d = (data ?? {}) as Record<string, unknown>;
    return d.ok === true ? (d as unknown as PublicResult<Omit<PublicHepPayload, 'ok'>>) : asFailure(d);
  },

  /** The Home tab's data, behind the same PIN / remembered-phone check, lockout and rate limit as the page. */
  async getPublicHome(cred: PublicCredential): Promise<PublicResult<Omit<PublicHepHome, 'ok'>>> {
    return fromRpc<Omit<PublicHepHome, 'ok'>>(
      await client().rpc('get_public_hep_home', { p_token: cred.token, p_pin: cred.pin ?? null, p_device: cred.device ?? null }),
    );
  },

  /** After a correct PIN: a random device token (shown once) so this phone is not asked again for 30 days. */
  async rememberDevice(token: string, pin: string): Promise<PublicResult<{ device: string }>> {
    return fromRpc<{ device: string }>(await client().rpc('hep_remember_device', { p_token: token, p_pin: pin }));
  },

  /** One exercise, one session, done or skipped (with an optional reason). The day is the clinic's, sent by the page. */
  async submitExerciseLog(a: PublicCredential & { itemId: string; sessionIndex: SessionsPerDay; logDate?: string | null; skipped?: boolean; skipReason?: SkipReason | null }): Promise<PublicResult<{ logDate: string }>> {
    return fromRpc<{ logDate: string }>(
      await client().rpc('submit_exercise_log', {
        p_token: a.token, p_pin: a.pin ?? null, p_item_id: a.itemId, p_session_index: a.sessionIndex,
        p_log_date: a.logDate ?? null, p_skipped: a.skipped ?? false, p_skip_reason: a.skipReason ?? null, p_device: a.device ?? null,
      }),
    );
  },

  /** Removes that session's log (done or skipped): Undo. */
  async undoExerciseLog(a: PublicCredential & { itemId: string; sessionIndex: SessionsPerDay; logDate?: string | null }): Promise<PublicResult<Empty>> {
    return fromRpc<Empty>(
      await client().rpc('undo_exercise_skip', {
        p_token: a.token, p_pin: a.pin ?? null, p_item_id: a.itemId, p_session_index: a.sessionIndex, p_log_date: a.logDate ?? null, p_device: a.device ?? null,
      }),
    );
  },

  /** The end-of-session Pain | Effort check, with the exercises the patient marked. */
  async submitSessionFeedback(a: PublicCredential & { programId: string; sessionIndex: SessionsPerDay; logDate?: string | null; pain?: number | null; effort?: number | null; painItemIds?: string[]; hardItemIds?: string[] }): Promise<PublicResult<Empty>> {
    return fromRpc<Empty>(
      await client().rpc('submit_hep_session_feedback', {
        p_token: a.token, p_pin: a.pin ?? null, p_program_id: a.programId, p_session_index: a.sessionIndex, p_log_date: a.logDate ?? null,
        p_pain: a.pain ?? null, p_effort: a.effort ?? null, p_pain_items: a.painItemIds ?? [], p_hard_items: a.hardItemIds ?? [], p_device: a.device ?? null,
      }),
    );
  },
};
