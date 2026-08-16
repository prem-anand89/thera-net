import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.47.0';

interface InviteRequest {
  clinicId: string;
  email: string;
  role: 'admin' | 'therapist' | 'front_desk';
  /** Required for every role — seeds clinic_members.display_name (shown
   *  throughout the app instead of raw email; the invited person can
   *  rename themselves once they've signed in) and, for a therapist
   *  invite specifically, also creates and links a `therapists` roster
   *  row in the same request, so a new therapist shows up correctly-
   *  scoped (their own visits, not clinic-wide) from their first login
   *  instead of needing a separate manual "add to roster, then link"
   *  step an admin has to remember to do afterward. */
  name?: string;
}

// The browser preflights any cross-origin POST that carries an
// Authorization header (which this call always does) with an OPTIONS
// request first — without a response to that (and these headers on every
// response, preflighted or not), the browser blocks the request client-side
// before it ever reaches the handler logic below, and the invite form's
// fetch() never resolves. '*' is fine here despite the sensitivity of what
// this function does: authorization is enforced by the JWT + admin-role
// check inside the handler, not by which origin the browser says it's
// calling from.
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
    const body: InviteRequest = await req.json();
    const { clinicId, email, role, name } = body;

    if (!clinicId || !email || !role) {
      return json({ error: 'Missing required fields: clinicId, email, role' }, 400);
    }

    if (!['admin', 'therapist', 'front_desk'].includes(role)) {
      return json({ error: 'Invalid role: must be admin, therapist, or front_desk' }, 400);
    }

    if (!name?.trim()) {
      return json({ error: 'A name is required to invite a team member' }, 400);
    }

    // Get the caller's JWT from the Authorization header
    const authHeader = req.headers.get('Authorization');
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return json({ error: 'Missing or invalid Authorization header' }, 401);
    }

    const jwt = authHeader.slice(7); // Remove 'Bearer ' prefix

    const SUPABASE_URL = Deno.env.get('SUPABASE_URL');
    const SUPABASE_ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY');
    const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');

    if (!SUPABASE_URL || !SUPABASE_ANON_KEY || !SUPABASE_SERVICE_ROLE_KEY) {
      return json({ error: 'Server configuration error: missing Supabase credentials' }, 500);
    }

    // Create a client with the caller's JWT to check permissions
    const userClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      global: {
        headers: {
          Authorization: `Bearer ${jwt}`,
        },
      },
    });

    // Verify caller is admin in this clinic
    const { data: memberData, error: memberError } = await userClient
      .from('clinic_members')
      .select('role')
      .eq('clinic_id', clinicId)
      .maybeSingle();

    if (memberError) {
      return json({ error: `Database error: ${memberError.message}` }, 500);
    }

    if (!memberData || memberData.role !== 'admin') {
      return json({ error: 'Only clinic admins can invite therapists' }, 403);
    }

    // Use service-role client for admin operations
    const serviceClient = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    });

    // Invite the user via Supabase Admin API
    const { data: inviteData, error: inviteError } = await serviceClient.auth.admin.inviteUserByEmail(
      email,
      {
        autoConfirm: true,
      }
    );

    if (inviteError || !inviteData.user) {
      return json({ error: `Failed to invite user: ${inviteError?.message || 'Unknown error'}` }, 400);
    }

    const newUserId = inviteData.user.id;

    // Insert clinic_members row
    const { error: insertError } = await serviceClient
      .from('clinic_members')
      .insert({
        clinic_id: clinicId,
        user_id: newUserId,
        role: role,
        display_name: name!.trim(),
      });

    if (insertError) {
      // User was created but clinic_members insert failed. This is bad but the invite went out.
      // Log it but don't fail the entire response since the user will receive an email.
      console.error(`Failed to insert clinic_members for user ${newUserId}:`, insertError);
      return json(
        { success: false, error: `Invite sent but failed to set up clinic access: ${insertError.message}` },
        500
      );
    }

    // A therapist also needs a `therapists` roster row (what visits/notes
    // actually reference, and what shows in the therapist picker) linked
    // back to their new login via user_id -- otherwise an admin has to
    // remember a separate manual step (Settings -> Team -> Service roster
    // -> add + "Linked login"), and until they do, this person's Workspace
    // can't tell "clinic-wide" apart from "not linked yet" and shows
    // nothing. Best-effort: the invite and clinic access already succeeded
    // above, so a failure here is reported but doesn't undo either --  the
    // existing manual roster path still works as a fallback.
    if (role === 'therapist') {
      const { error: therapistError } = await serviceClient.from('therapists').insert({
        clinic_id: clinicId,
        name: name!.trim(),
        user_id: newUserId,
        active: true,
      });
      if (therapistError) {
        console.error(`Failed to create therapist roster row for user ${newUserId}:`, therapistError);
        return json(
          {
            success: true,
            message: `Invitation sent to ${email}`,
            warning: `Could not add them to the service roster automatically: ${therapistError.message}. Add them from Settings → Team → Service roster.`,
          },
          200
        );
      }
    }

    return json({ success: true, message: `Invitation sent to ${email}` }, 200);
  } catch (error) {
    console.error('Unexpected error:', error);
    return json({ error: `Server error: ${error instanceof Error ? error.message : 'Unknown error'}` }, 500);
  }
}

// The file previously only had `export default function handler(...)` with
// nothing ever calling Deno.serve — every request (OPTIONS or POST alike)
// hung until the platform gateway's own idle timeout instead of reaching
// this code at all, since nothing had registered it as the HTTP handler.
// That's the actual root cause of the stuck "Sending…"/no-email bug, not
// the missing CORS headers or verify_jwt (both still worth having, but
// neither would matter if the function never started listening).
Deno.serve(handler);
