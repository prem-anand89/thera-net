/**
 * Database-only edge functions (send-push, send-agenda, notify-therapist) run without a login check because
 * triggers and pg_cron call them. Every such call carries `x-hook-secret` (public.edge_hook_headers()); this
 * compares it with the EDGE_HOOK_SECRET function setting. While that setting is absent, calls are accepted as
 * before, so deploying the code before setting the secret never drops a notification.
 */
export function hookAllowed(request: Request, expected: string | undefined = Deno.env.get('EDGE_HOOK_SECRET')): boolean {
  if (!expected) return true;
  const given = request.headers.get('x-hook-secret') ?? '';
  if (given.length !== expected.length) return false;
  let diff = 0;
  for (let i = 0; i < given.length; i++) diff |= given.charCodeAt(i) ^ expected.charCodeAt(i);
  return diff === 0;
}
