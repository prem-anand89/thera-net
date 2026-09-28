/**
 * Minimal, dependency-free error capture. Always logs to the console;
 * additionally POSTs a small JSON payload to VITE_ERROR_WEBHOOK_URL if one
 * is configured (a Slack/Discord incoming webhook, or any endpoint that
 * accepts a JSON body) — otherwise this is a no-op. Deliberately not a
 * full APM SDK: those add real bundle weight for breadcrumbs/replay/source
 * maps this app doesn't need yet, and require an account+DSN this app
 * doesn't have. Swap in Sentry or similar later without touching call sites
 * — everything funnels through reportError().
 */

const WEBHOOK_URL = import.meta.env.VITE_ERROR_WEBHOOK_URL as string | undefined;

export function reportError(error: unknown, context: string): void {
  console.error(`[${context}]`, error);
  const payload = {
    context,
    message: error instanceof Error ? error.message : String(error),
    stack: error instanceof Error ? error.stack : undefined,
    url: typeof location !== 'undefined' ? location.href : undefined,
    userAgent: typeof navigator !== 'undefined' ? navigator.userAgent : undefined,
    time: new Date().toISOString(),
  };

  // Use Supabase Edge Function if available
  import('@/lib/supabase').then(({ getSupabase }) => {
    const supabase = getSupabase();
    if (supabase) {
      supabase.functions.invoke('brevo-mailer', {
        body: { type: 'error', ...payload }
      }).catch(() => {});
      return;
    }
    
    // Fallback to webhook if Supabase isn't ready or configured
    if (!WEBHOOK_URL) return;
    fetch(WEBHOOK_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    }).catch(() => {});
  }).catch(() => {});
}

export function installGlobalErrorReporting(): void {
  window.addEventListener('error', (e) => reportError(e.error ?? e.message, 'window.onerror'));
  window.addEventListener('unhandledrejection', (e) =>
    reportError(e.reason, 'unhandledrejection')
  );
}
