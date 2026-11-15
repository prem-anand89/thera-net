// What the patient's phone remembers, all in localStorage and all wrapped in try/catch (private windows and some in-app
// browsers block it; the page must work without it). Every key is scoped to the link token. The PIN is never stored.
const deviceKey = (token: string) => `hep-device:${token}`;
const openedKey = (token: string) => `hep-opened:${token}`;
const checkKey = (token: string, day: string, session: number) => `hep-check:${token}:${day}:${session}`;

function read(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}
function write(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* storage blocked */
  }
}
function remove(key: string): void {
  try {
    localStorage.removeItem(key);
  } catch {
    /* storage blocked */
  }
}

/** The remembered-phone token (item 39). */
export const readDevice = (token: string): string | null => read(deviceKey(token));
export const saveDevice = (token: string, device: string): void => write(deviceKey(token), device);
export const forgetDevice = (token: string): void => remove(deviceKey(token));

/** Exercises this phone has opened before, so the steps start open only the first time. */
export function readOpened(token: string): Set<string> {
  try {
    const raw = read(openedKey(token));
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    return new Set(Array.isArray(parsed) ? parsed.filter((x): x is string => typeof x === 'string') : []);
  } catch {
    return new Set();
  }
}
export function markOpened(token: string, itemId: string): void {
  const seen = readOpened(token);
  if (seen.has(itemId)) return;
  seen.add(itemId);
  write(openedKey(token), JSON.stringify([...seen]));
}

/** The Pain | Effort check was saved or dismissed for this session today, so it does not come back by itself. */
export const checkHandled = (token: string, day: string, session: number): boolean => read(checkKey(token, day, session)) === '1';
export const markCheckHandled = (token: string, day: string, session: number): void => write(checkKey(token, day, session), '1');
