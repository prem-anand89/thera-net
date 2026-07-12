import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.47.0';

interface InviteRequest {
  clinicId: string;
  email: string;
  role: 'admin' | 'staff';
}

interface InviteResponse {
  success: boolean;
  message?: string;
  error?: string;
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
    const { clinicId, email, role } = body;

    if (!clinicId || !email || !role) {
      return new Response(
        JSON.stringify({ error: 'Missing required fields: clinicId, email, role' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }

    if (!['admin', 'staff'].includes(role)) {
      return new Response(JSON.stringify({ error: 'Invalid role: must be admin or staff' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
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

    // Create a client with the caller's JWT to check permissions
    const userClient = createClient(
      Deno.env.get('SUPABASE_URL') || '',
      Deno.env.get('SUPABASE_ANON_KEY') || '',
      {
        global: {
          headers: {
            Authorization: `Bearer ${jwt}`,
          },
        },
      }
    );

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
    const serviceClient = createClient(
      Deno.env.get('SUPABASE_URL') || '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '',
      {
        auth: {
          autoRefreshToken: false,
          persistSession: false,
        },
      }
    );

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
