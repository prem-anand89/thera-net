import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.47.0';

interface InviteRequest {
  clinicId: string;
  email: string;
  role: 'admin' | 'therapist' | 'front_desk';
  /** Required when role === 'therapist' — used to create and link a
   *  `therapists` roster row in the same request, so a new therapist shows
   *  up correctly-scoped (their own visits, not clinic-wide) from their
   *  first login instead of needing a separate manual "add to roster, then
   *  link" step an admin has to remember to do afterward. */
  name?: string;
}

export default async function handler(req: Request): Promise<Response> {
  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  try {
    const body: InviteRequest = await req.json();
    const { clinicId, email, role, name } = body;

    if (!clinicId || !email || !role) {
      return new Response(
        JSON.stringify({ error: 'Missing required fields: clinicId, email, role' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }

    if (!['admin', 'therapist', 'front_desk'].includes(role)) {
      return new Response(
        JSON.stringify({ error: 'Invalid role: must be admin, therapist, or front_desk' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }

    if (role === 'therapist' && !name?.trim()) {
      return new Response(
        JSON.stringify({ error: 'A name is required to invite a therapist' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }

    // Get the caller's JWT from the Authorization header
    const authHeader = req.headers.get('Authorization');
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return new Response(JSON.stringify({ error: 'Missing or invalid Authorization header' }), {
        status: 401,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const jwt = authHeader.slice(7); // Remove 'Bearer ' prefix

    const SUPABASE_URL = Deno.env.get('SUPABASE_URL');
    const SUPABASE_ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY');
    const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');

    if (!SUPABASE_URL || !SUPABASE_ANON_KEY || !SUPABASE_SERVICE_ROLE_KEY) {
      return new Response(
        JSON.stringify({
          error: 'Server configuration error: missing Supabase credentials',
        }),
        { status: 500, headers: { 'Content-Type': 'application/json' } }
      );
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
      return new Response(JSON.stringify({ error: `Database error: ${memberError.message}` }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    if (!memberData || memberData.role !== 'admin') {
      return new Response(
        JSON.stringify({
          error: 'Only clinic admins can invite therapists',
        }),
        { status: 403, headers: { 'Content-Type': 'application/json' } }
      );
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
      return new Response(
        JSON.stringify({
          error: `Failed to invite user: ${inviteError?.message || 'Unknown error'}`,
        }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }

    const newUserId = inviteData.user.id;

    // Insert clinic_members row
    const { error: insertError } = await serviceClient
      .from('clinic_members')
      .insert({
        clinic_id: clinicId,
        user_id: newUserId,
        role: role,
      });

    if (insertError) {
      // User was created but clinic_members insert failed. This is bad but the invite went out.
      // Log it but don't fail the entire response since the user will receive an email.
      console.error(`Failed to insert clinic_members for user ${newUserId}:`, insertError);
      return new Response(
        JSON.stringify({
          success: false,
          error: `Invite sent but failed to set up clinic access: ${insertError.message}`,
        }),
        { status: 500, headers: { 'Content-Type': 'application/json' } }
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
        return new Response(
          JSON.stringify({
            success: true,
            message: `Invitation sent to ${email}`,
            warning: `Could not add them to the service roster automatically: ${therapistError.message}. Add them from Settings → Team → Service roster.`,
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        );
      }
    }

    return new Response(
      JSON.stringify({
        success: true,
        message: `Invitation sent to ${email}`,
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    );
  } catch (error) {
    console.error('Unexpected error:', error);
    return new Response(
      JSON.stringify({
        error: `Server error: ${error instanceof Error ? error.message : 'Unknown error'}`,
      }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }
}
