/**
 * supabase-js reports any non-2xx Edge Function response as the generic
 * "Edge Function returned a non-2xx status code", and keeps the real reply
 * (our functions answer `{ error: "Only clinic admins can invite…" }`) on
 * `error.context`, a Response. Pull that message out so users see the reason.
 */
export async function edgeFunctionErrorMessage(error: { message: string; context?: unknown }): Promise<string> {
  const context = error.context as { json?: () => Promise<unknown> } | undefined;
  if (context && typeof context.json === 'function') {
    try {
      const body = (await context.json()) as { error?: unknown; message?: unknown } | null;
      if (typeof body?.error === 'string' && body.error.trim()) return body.error;
      if (typeof body?.message === 'string' && body.message.trim()) return body.message;
    } catch {
      // Not JSON (or the body was already read) — fall back to the generic text.
    }
  }
  return error.message;
}
