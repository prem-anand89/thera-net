import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.47.0';
import { corsHeaders } from '../_shared/cors.ts';

// Longest text accepted per field, so nobody can send oversized emails through this function.
const MAX_MESSAGE = 8000;
const MAX_STACK = 16000;
const MAX_SHORT = 500;
const cut = (v: unknown, max: number): string | undefined => (typeof v === 'string' ? v.slice(0, max) : undefined);

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
}

interface WebhookPayload {
  type: 'error' | 'feedback';
  context?: string;
  message: string;
  stack?: string;
  url?: string;
  userAgent?: string;
  time?: string;
  userId?: string;
  clinicId?: string;
  userName?: string;
  category?: 'bug' | 'feature' | 'support';
}

function escapeHtml(unsafe: string | undefined): string {
  if (!unsafe) return '';
  return unsafe
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    // Only signed-in users may send: the function mails the support inbox and spends Brevo quota.
    const authHeader = req.headers.get('Authorization');
    if (!authHeader || !authHeader.startsWith('Bearer ')) return json({ error: 'Sign in to send this.' }, 401);
    const SUPABASE_URL = Deno.env.get('SUPABASE_URL');
    const SUPABASE_ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY');
    if (!SUPABASE_URL || !SUPABASE_ANON_KEY) throw new Error('Server is not configured.');
    const userClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, { global: { headers: { Authorization: authHeader } } });
    const { data: { user: caller }, error: authError } = await userClient.auth.getUser();
    if (authError || !caller) return json({ error: 'Sign in to send this.' }, 401);

    const raw = (await req.json()) as WebhookPayload;
    // Who sent it comes from the verified login, never from what the browser says.
    const payload: WebhookPayload = {
      type: raw.type,
      context: cut(raw.context, MAX_SHORT),
      message: cut(raw.message, MAX_MESSAGE) ?? '',
      stack: cut(raw.stack, MAX_STACK),
      url: cut(raw.url, MAX_SHORT),
      userAgent: cut(raw.userAgent, MAX_SHORT),
      time: cut(raw.time, MAX_SHORT),
      userId: caller.id,
      userName: cut(caller.user_metadata?.display_name, MAX_SHORT) ?? caller.email ?? undefined,
      clinicId: cut(raw.clinicId, MAX_SHORT),
      category: raw.category,
    };

    const BREVO_API_KEY = Deno.env.get('BREVO_API_KEY');
    const SUPPORT_EMAIL = Deno.env.get('SUPPORT_EMAIL');

    if (!BREVO_API_KEY || !SUPPORT_EMAIL) {
      throw new Error('BREVO_API_KEY or SUPPORT_EMAIL is not set in environment variables');
    }

    let subject = '';
    let htmlContent = '';

    if (payload.type === 'error') {
      subject = `🚨 Thera.Net Error: [${escapeHtml(payload.context)}]`;
      htmlContent = `
        <h2>App Error Captured</h2>
        <p><strong>Context:</strong> ${escapeHtml(payload.context)}</p>
        <p><strong>Message:</strong> ${escapeHtml(payload.message)}</p>
        <p><strong>URL:</strong> ${escapeHtml(payload.url)}</p>
        <p><strong>Time:</strong> ${escapeHtml(payload.time)}</p>
        <p><strong>User Agent:</strong> ${escapeHtml(payload.userAgent)}</p>
        <hr />
        <pre>${escapeHtml(payload.stack) || 'No stack trace provided'}</pre>
      `;
    } else if (payload.type === 'feedback') {
      const categoryIcons = {
        bug: '🐞 Bug Report',
        feature: '💡 Feature Request',
        support: '💬 Support Request'
      };
      
      const categoryLabel = payload.category ? categoryIcons[payload.category] : 'Feedback';
      subject = `${categoryLabel} from ${escapeHtml(payload.userName) || 'User'}`;
      
      htmlContent = `
        <h2>${categoryLabel}</h2>
        <p><strong>User:</strong> ${escapeHtml(payload.userName) || 'Unknown'} (ID: ${escapeHtml(payload.userId) || 'Unknown'})</p>
        <p><strong>Clinic ID:</strong> ${escapeHtml(payload.clinicId) || 'Unknown'}</p>
        <hr />
        <p><strong>Message:</strong></p>
        <p>${escapeHtml(payload.message).replace(/\n/g, '<br />')}</p>
      `;
    } else {
      return new Response(JSON.stringify({ error: 'Invalid payload type' }), { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    const emailData = {
      sender: { name: 'Thera.Net System', email: SUPPORT_EMAIL },
      to: [{ email: SUPPORT_EMAIL }],
      subject: subject,
      htmlContent: htmlContent,
    };

    const response = await fetch('https://api.brevo.com/v3/smtp/email', {
      method: 'POST',
      headers: {
        'Accept': 'application/json',
        'Content-Type': 'application/json',
        'api-key': BREVO_API_KEY,
      },
      body: JSON.stringify(emailData),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Brevo API Error: ${errorText}`);
    }

    return new Response(JSON.stringify({ success: true }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 200,
    });
  } catch (error) {
    return new Response(JSON.stringify({ error: error instanceof Error ? error.message : String(error) }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 500,
    });
  }
});
