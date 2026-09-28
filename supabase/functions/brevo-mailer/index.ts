import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { corsHeaders } from '../_shared/cors.ts'; // assuming standard cors implementation

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

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const payload = (await req.json()) as WebhookPayload;
    
    const BREVO_API_KEY = Deno.env.get('BREVO_API_KEY');
    const SUPPORT_EMAIL = Deno.env.get('SUPPORT_EMAIL');

    if (!BREVO_API_KEY || !SUPPORT_EMAIL) {
      throw new Error('BREVO_API_KEY or SUPPORT_EMAIL is not set in environment variables');
    }

    let subject = '';
    let htmlContent = '';

    if (payload.type === 'error') {
      subject = `🚨 Thera.Net Error: [${payload.context}]`;
      htmlContent = `
        <h2>App Error Captured</h2>
        <p><strong>Context:</strong> ${payload.context}</p>
        <p><strong>Message:</strong> ${payload.message}</p>
        <p><strong>URL:</strong> ${payload.url}</p>
        <p><strong>Time:</strong> ${payload.time}</p>
        <p><strong>User Agent:</strong> ${payload.userAgent}</p>
        <hr />
        <pre>${payload.stack || 'No stack trace provided'}</pre>
      `;
    } else if (payload.type === 'feedback') {
      const categoryIcons = {
        bug: '🐞 Bug Report',
        feature: '💡 Feature Request',
        support: '💬 Support Request'
      };
      
      const categoryLabel = payload.category ? categoryIcons[payload.category] : 'Feedback';
      subject = `${categoryLabel} from ${payload.userName || 'User'}`;
      
      htmlContent = `
        <h2>${categoryLabel}</h2>
        <p><strong>User:</strong> ${payload.userName || 'Unknown'} (ID: ${payload.userId || 'Unknown'})</p>
        <p><strong>Clinic ID:</strong> ${payload.clinicId || 'Unknown'}</p>
        <hr />
        <p><strong>Message:</strong></p>
        <p>${payload.message.replace(/\n/g, '<br />')}</p>
      `;
    } else {
      throw new Response(JSON.stringify({ error: 'Invalid payload type' }), { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
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
    return new Response(JSON.stringify({ error: error.message }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 500,
    });
  }
});
