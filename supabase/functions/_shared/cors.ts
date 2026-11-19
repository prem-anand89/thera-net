// CORS for the functions the app calls from the browser (invite-therapist, brevo-mailer, send-whatsapp-template,
// hep-media). Only the app's own origins may read their responses; any other website gets no CORS headers and the
// browser blocks it. Database-only functions (send-push, send-agenda, notify-therapist) are never called from a browser.
//
// Allowed origins: the ALLOWED_ORIGINS function secret (comma-separated, exact origins, no trailing slash) or, when it is
// not set, the built-in list below. Add any new domain (custom domain, preview deploy) to the secret BEFORE using it.

export const corsHeaders = {
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

export const DEFAULT_ALLOWED_ORIGINS = [
  'https://thera-net-three.vercel.app',
  'http://localhost:5173',
  'http://localhost:5174',
  'http://127.0.0.1:5173',
  'http://127.0.0.1:5174',
];

export function allowedOrigins(configured: string | undefined = Deno.env.get('ALLOWED_ORIGINS')): string[] {
  const list = (configured ?? '').split(',').map((o) => o.trim().replace(/\/+$/, '')).filter(Boolean);
  return list.length ? list : DEFAULT_ALLOWED_ORIGINS;
}

/** The request's origin when it is allowed, otherwise null. */
export function allowedOrigin(request: Request, allowed: string[] = allowedOrigins()): string | null {
  const origin = request.headers.get('Origin');
  return origin && allowed.includes(origin) ? origin : null;
}

/** The response with CORS headers for an allowed origin; for any other origin the response carries none. */
export function applyCors(request: Request, response: Response, allowed: string[] = allowedOrigins()): Response {
  const headers = new Headers(response.headers);
  headers.delete('Access-Control-Allow-Origin');
  headers.append('Vary', 'Origin');
  const origin = allowedOrigin(request, allowed);
  if (origin) headers.set('Access-Control-Allow-Origin', origin);
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}
