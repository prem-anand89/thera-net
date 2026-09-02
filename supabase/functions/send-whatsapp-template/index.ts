import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.47.0';

/**
 * Patient Communications, Phase 9: the only place in this app that ever
 * calls Meta's WhatsApp Business Cloud API. `src/lib/whatsappSend.ts`'s
 * `sendWhatsAppMessage()` calls this first for every patient-facing send
 * action (feedback link, resend, Google review nudge, reminders, booking
 * confirmation — not therapist-notify, since `Therapist` has no phone
 * field), falling back to the existing share-sheet path whenever this
 * returns `{ configured: false }`, a rejected send, or fails outright. So
 * in practice this still sends nothing for real until a clinic has
 * configured real Meta credentials (Settings → Patient communications →
 * WhatsApp Business API) *and* the caller's `templateName` matches an
 * approved template on Meta's side — until then every send falls through.
 *
 * Meta requires an approved template for any business-initiated message
 * outside a 24h customer-service window — this function is template-shaped
 * from the start rather than a placeholder that "sends text": the caller
 * supplies templateName/languageCode/bodyParams, and has no way to send
 * arbitrary freeform text through this path. What a given clinic's
 * approved template actually says (and how many variables it expects) is
 * entirely between that clinic and Meta — this function has no opinion.
 */

interface SendRequest {
  clinicId: string;
  /** One of message_log.kind's six existing values — validated below
   *  against that same list. */
  kind: string;
  toPhone: string;
  templateName: string;
  languageCode: string;
  bodyParams: string[];
}

const MESSAGE_LOG_KINDS = [
  'feedback_request',
  'booking_confirmation',
  'therapist_notify',
  'google_review',
  'reminder_stale_package',
  'reminder_single_visit',
];

// Same CORS reasoning as invite-therapist/index.ts: the browser preflights
// any cross-origin POST carrying an Authorization header, and blocks the
// real request client-side without a response to that OPTIONS request.
// '*' is fine here too — authorization is enforced by the JWT + membership
// check inside the handler, not by which origin the browser claims.
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

export default async function handler(req: Request): Promise<Response> {
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  if (req.method !== 'POST') {
    return json({ error: 'Method not allowed' }, 405);
  }

  try {
    const body: SendRequest = await req.json();
    const { clinicId, kind, toPhone, templateName, languageCode, bodyParams } = body;

    if (!clinicId || !kind || !toPhone || !templateName || !languageCode) {
      return json(
        {
          error: 'Missing required fields: clinicId, kind, toPhone, templateName, languageCode',
        },
        400
      );
    }
    if (!MESSAGE_LOG_KINDS.includes(kind)) {
      return json({ error: `Invalid kind: must be one of ${MESSAGE_LOG_KINDS.join(', ')}` }, 400);
    }

    const authHeader = req.headers.get('Authorization');
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return json({ error: 'Missing or invalid Authorization header' }, 401);
    }
    const jwt = authHeader.slice(7);

    const SUPABASE_URL = Deno.env.get('SUPABASE_URL');
    const SUPABASE_ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY');
    const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
    if (!SUPABASE_URL || !SUPABASE_ANON_KEY || !SUPABASE_SERVICE_ROLE_KEY) {
      return json({ error: 'Server configuration error: missing Supabase credentials' }, 500);
    }

    const userClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      global: { headers: { Authorization: `Bearer ${jwt}` } },
    });
    const {
      data: { user: caller },
      error: callerError,
    } = await userClient.auth.getUser();
    if (callerError || !caller) {
      return json({ error: 'Could not verify the calling user' }, 401);
    }

    // Any clinic member may trigger a send — matches who can already
    // trigger a manual share-sheet send today (admin, front_desk, or the
    // visit's own therapist, depending on the action); this function has
    // no per-action row-scoped check of its own, same coarser boundary
    // rotate_feedback_request_token relies on via RLS for the equivalent
    // client-side action.
    const { data: memberData, error: memberError } = await userClient
      .from('clinic_members')
      .select('role')
      .eq('clinic_id', clinicId)
      .eq('user_id', caller.id)
      .maybeSingle();
    if (memberError) {
      return json({ error: `Database error: ${memberError.message}` }, 500);
    }
    if (!memberData) {
      return json({ error: 'Not a member of this clinic' }, 403);
    }

    const serviceClient = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    const { data: config } = await serviceClient
      .from('clinic_whatsapp_config')
      .select('phone_number_id, access_token, enabled')
      .eq('clinic_id', clinicId)
      .maybeSingle();

    if (!config || !config.enabled || !config.phone_number_id || !config.access_token) {
      // Expected "not set up yet" response, not an error — a future
      // client-side wrapper falls back to the share sheet on this.
      return json({ configured: false }, 200);
    }

    const metaResponse = await fetch(
      `https://graph.facebook.com/v20.0/${config.phone_number_id}/messages`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${config.access_token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          messaging_product: 'whatsapp',
          to: toPhone,
          type: 'template',
          template: {
            name: templateName,
            language: { code: languageCode },
            components: [
              {
                type: 'body',
                parameters: (bodyParams ?? []).map((text) => ({ type: 'text', text })),
              },
            ],
          },
        }),
      }
    );
    const metaResult = await metaResponse.json().catch(() => ({}));

    if (!metaResponse.ok) {
      return json(
        {
          configured: true,
          success: false,
          error: metaResult?.error?.message ?? `Meta API error (${metaResponse.status})`,
        },
        200
      );
    }

    // Best-effort — the send already succeeded; a failed audit-log insert
    // shouldn't turn a successful send into a reported failure.
    const { error: logError } = await serviceClient.from('message_log').insert({
      clinic_id: clinicId,
      kind,
      recipient_phone: toPhone,
      channel: 'wa_business_api',
      sent_by: caller.id,
    });
    if (logError) {
      console.error('Failed to write message_log row:', logError);
    }

    return json({ configured: true, success: true }, 200);
  } catch (error) {
    console.error('Unexpected error:', error);
    return json(
      { error: `Server error: ${error instanceof Error ? error.message : 'Unknown error'}` },
      500
    );
  }
}

Deno.serve(handler);
