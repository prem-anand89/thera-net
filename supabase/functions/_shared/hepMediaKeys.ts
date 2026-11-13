// HEP picture keys: where an exercise's pictures live in the private R2 bucket, and who may touch them.
// Dependency-free on purpose (like send-push/preferences.ts): the hep-media edge function and the app both import this
// one file, so the rule "a clinic only ever reaches its own prefix" cannot drift between them. No secrets in here.

/** `clinics/{clinicId}/exercises/{exerciseId}/` */
export function exerciseMediaPrefix(clinicId: string, exerciseId: string): string {
  return `clinics/${clinicId}/exercises/${exerciseId}/`;
}

const SAFE_ID = /^[A-Za-z0-9_-]{1,64}$/;
const SUFFIX = /^[a-z0-9]{8}$/;

/** A random 8-character lowercase suffix (amendment 76: every upload gets a new key, so a cached old picture never shows). */
export function newKeySuffix(random: (bytes: Uint8Array) => Uint8Array = (b) => crypto.getRandomValues(b)): string {
  const alphabet = 'abcdefghijklmnopqrstuvwxyz0123456789';
  const bytes = random(new Uint8Array(8));
  let out = '';
  for (let i = 0; i < 8; i++) out += alphabet[bytes[i] % alphabet.length];
  return out;
}

/** `.../{index}` or, with a suffix, `.../{index}-{suffix}`. */
export function buildExerciseMediaKey(clinicId: string, exerciseId: string, index: number, suffix?: string): string {
  return `${exerciseMediaPrefix(clinicId, exerciseId)}${index}${suffix ? `-${suffix}` : ''}`;
}

/** `.../thumb` or `.../thumb-{suffix}`: the small picture used in lists. */
export function buildExerciseThumbKey(clinicId: string, exerciseId: string, suffix?: string): string {
  return `${exerciseMediaPrefix(clinicId, exerciseId)}thumb${suffix ? `-${suffix}` : ''}`;
}

/** Splits a key into its parts, or null when it is not a well-formed HEP key. */
export function parseExerciseMediaKey(
  key: string,
): { clinicId: string; exerciseId: string; slot: number | 'thumb'; suffix: string | null } | null {
  const parts = key.split('/');
  if (parts.length !== 5 || parts[0] !== 'clinics' || parts[2] !== 'exercises') return null;
  const [, clinicId, , exerciseId, last] = parts;
  if (!SAFE_ID.test(clinicId) || !SAFE_ID.test(exerciseId)) return null;
  const m = /^(thumb|\d)(?:-([a-z0-9]{8}))?$/.exec(last);
  if (!m) return null;
  if (m[2] !== undefined && !SUFFIX.test(m[2])) return null;
  return { clinicId, exerciseId, slot: m[1] === 'thumb' ? 'thumb' : Number(m[1]), suffix: m[2] ?? null };
}

/** True when the key is a well-formed HEP key inside this clinic's own prefix. This is the access rule for signing. */
export function isKeyForClinic(clinicId: string, key: string): boolean {
  const parsed = parseExerciseMediaKey(key);
  return parsed !== null && parsed.clinicId === clinicId;
}

/**
 * The keys of one exercise: none (0 keys), one GIF (1), or 2 to 4 photos. Every key must be in this clinic's prefix,
 * in one exercise folder, and photo number n must sit at position n.
 */
export function validateMediaKeysForClinic(
  clinicId: string,
  mediaType: 'none' | 'gif' | 'stills',
  keys: string[],
): boolean {
  if (mediaType === 'none') return keys.length === 0;
  if (mediaType === 'gif' && keys.length !== 1) return false;
  if (mediaType === 'stills' && (keys.length < 2 || keys.length > 4)) return false;
  const parsed = keys.map(parseExerciseMediaKey);
  if (parsed.some((p) => p === null || p.clinicId !== clinicId || p.slot === 'thumb')) return false;
  const exercise = parsed[0]!.exerciseId;
  return parsed.every((p, idx) => p!.exerciseId === exercise && p!.slot === idx);
}
