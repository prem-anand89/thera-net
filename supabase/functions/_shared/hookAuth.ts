/**
 * Database-only edge functions (send-push, send-agenda, notify-therapist) run without a login check because
 * triggers and pg_cron call them. Every such call carries `x-hook-secret` (public.edge_hook_headers()); this
 * compares it with the EDGE_HOOK_SECRET function setting. With no secret configured every call is refused (fails
 * closed), so the secret MUST be set, and match the vault's edge_hook_secret, before this code is deployed.
 */
export function hookAllowed(request: Request, expected: string | undefined = Deno.env.get('EDGE_HOOK_SECRET')): boolean {
  if (!expected) return false;
  const given = request.headers.get('x-hook-secret') ?? '';
  if (given.length !== expected.length) return false;
  let diff = 0;
  for (let i = 0; i < given.length; i++) diff |= given.charCodeAt(i) ^ expected.charCodeAt(i);
  return diff === 0;
}
