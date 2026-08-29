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
  /** The inviting browser's own origin (`window.location.origin`) — used
   *  to build the invite email's redirect link. Without this, the link
   *  falls back to whatever the Supabase project's Site URL happens to be
   *  configured to, which lands the invitee on the app already signed in
   *  (the invite token establishes a session) but with no password ever
   *  set and no UI prompting them to set one. */
  redirectOrigin?: string;
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

// supabase-js's admin.listUsers() has no server-side email filter, so
// finding "the user behind this email" means paging through the project's
// users and matching client-side. Bounded to a few thousand accounts --
// comfortably past what a clinic-management app's whole Supabase project
// will ever have -- so a genuinely missing match returns null instead of
// scanning forever.
async function findUserIdByEmail(
  serviceClient: ReturnType<typeof createClient>,
  email: string
): Promise<string | null> {
  const target = email.trim().toLowerCase();
  const perPage = 200;
  for (let page = 1; page <= 20; page++) {
    const { data, error } = await serviceClient.auth.admin.listUsers({ page, perPage });
    if (error || !data?.users?.length) break;
    const match = data.users.find((u) => u.email?.toLowerCase() === target);
    if (match) return match.id;
    if (data.users.length < perPage) break; // last page
  }
  return null;
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
    const { clinicId, email, role, name, redirectOrigin } = body;

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

    // Who's calling — needed both to know their own membership row (below)
    // and, since RLS lets an admin see every member of the clinic, to make
    // sure the very next query doesn't come back with more than one row.
    const {
      data: { user: caller },
      error: callerError,
    } = await userClient.auth.getUser();

    if (callerError || !caller) {
      return json({ error: 'Could not verify the calling user' }, 401);
    }

    // Verify caller is admin in this clinic. Scoped to the caller's own
    // user_id -- clinic_members' RLS policy lets an admin read every row in
    // the clinic (needed for the Team page), so without this filter a
    // clinic with 2+ members makes this query return multiple rows and
    // .maybeSingle() throw, breaking every invite past the clinic's second
    // member.
    const { data: memberData, error: memberError } = await userClient
      .from('clinic_members')
      .select('role, display_name')
      .eq('clinic_id', clinicId)
      .eq('user_id', caller.id)
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

    // Best-effort — feeds the invite email's metadata (below) so a
    // customized "Invite user" template can greet the invitee by clinic
    // and inviter name. Missing/failed lookup just means a plainer email,
    // never blocks the invite itself.
    const { data: clinicData } = await serviceClient
      .from('clinics')
      .select('name')
      .eq('id', clinicId)
      .maybeSingle();

    // Seat cap (tier-subscriptions plan, Phase 2): clinic_plans.max_members
    // is the enforced ceiling on logins, counted against clinic_members —
    // this is the one chokepoint every new login passes through (a
    // re-linked existing account below still adds a clinic_members row for
    // THIS clinic, so it counts too). A missing clinic_plans row (shouldn't
    // happen — every clinic is seeded one on creation, Phase 0) fails open
    // rather than locking an admin out over a data gap that isn't their
    // fault.
    //
    // Phase 4: platform_config.tier_enforcement_enabled is the global pilot
    // kill switch — skip both checks below entirely while it's off, same as
    // the SQL-side enforcement points (issue_invoice(), the patients/visits
    // insert triggers) via tier_enforcement_enabled().
    const { data: platformConfig } = await serviceClient
      .from('platform_config')
      .select('tier_enforcement_enabled')
      .maybeSingle();
    const tierEnforcementEnabled = platformConfig?.tier_enforcement_enabled ?? true;

    if (tierEnforcementEnabled) {
      const { data: planData } = await serviceClient
        .from('clinic_plans')
        .select('max_members, status')
        .eq('clinic_id', clinicId)
        .maybeSingle();

      if (planData && planData.status !== 'active') {
        return json(
          {
            error:
              "This clinic's plan is read-only — invites are unavailable until payment resumes.",
          },
          403
        );
      }

      if (planData) {
        const { count: memberCount } = await serviceClient
          .from('clinic_members')
          .select('*', { count: 'exact', head: true })
          .eq('clinic_id', clinicId);
        if ((memberCount ?? 0) >= planData.max_members) {
          return json(
            {
              error: `This clinic's plan allows up to ${planData.max_members} team login${planData.max_members === 1 ? '' : 's'}. Upgrade to invite more.`,
            },
            403
          );
        }
      }
    }

    // Invite the user via Supabase Admin API. `redirectTo` is what actually
    // fixes "no option to set a new password" — without it, the link falls
    // back to the project's default Site URL, which signs the invitee in
    // (the invite token establishes a session) but drops them on the app
    // with no password ever set and nothing prompting them to set one.
    // /reset-password already handles both a password-recovery session and
    // an invite session identically (see ResetPasswordPage.tsx) — it just
    // checks for an active session and lets you choose a password, so no
    // new page was needed here, only routing the link to the one that
    // already exists. `data` seeds user_metadata with clinic/inviter
    // context, available to a customized "Invite user" email template via
    // `{{ .Data.clinicName }}`/`{{ .Data.invitedByName }}` — the stock
    // Supabase template doesn't reference these, so the email stays generic
    // until that template is edited in the Supabase dashboard.
    const redirectTo =
      redirectOrigin && /^https?:\/\//.test(redirectOrigin)
        ? `${redirectOrigin}/reset-password`
        : undefined;
    const { data: inviteData, error: inviteError } =
      await serviceClient.auth.admin.inviteUserByEmail(email, {
        redirectTo,
        data: {
          clinicName: clinicData?.name ?? null,
          invitedByName: memberData?.display_name ?? null,
          role,
        },
      });

    let newUserId: string;
    let reLinkedExisting = false;

    if (inviteError || !inviteData.user) {
      // GoTrue rejects an invite to an email that already has an auth.users
      // row -- true for anyone previously invited/offboarded from any
      // clinic, or a therapist who already works at a different one. Rather
      // than dead-ending there, fall back to re-linking the existing
      // account: this clinic just needs a clinic_members row for them, not
      // a brand-new login.
      const looksAlreadyRegistered =
        (inviteError as { code?: string } | null)?.code === 'email_exists' ||
        /already.*(registered|exists)/i.test(inviteError?.message ?? '');

      if (!looksAlreadyRegistered) {
        return json(
          { error: `Failed to invite user: ${inviteError?.message || 'Unknown error'}` },
          400
        );
      }

      const existingUserId = await findUserIdByEmail(serviceClient, email);
      if (!existingUserId) {
        // Matches GoTrue's own claim that the email is taken, but the admin
        // lookup couldn't confirm which account -- surface the original
        // error rather than silently doing nothing.
        return json(
          { error: `Failed to invite user: ${inviteError?.message || 'Unknown error'}` },
          400
        );
      }

      const { data: existingMembership } = await serviceClient
        .from('clinic_members')
        .select('role')
        .eq('clinic_id', clinicId)
        .eq('user_id', existingUserId)
        .maybeSingle();
      if (existingMembership) {
        return json({ error: `${email} is already a member of this clinic.` }, 409);
      }

      newUserId = existingUserId;
      reLinkedExisting = true;
    } else {
      newUserId = inviteData.user.id;
    }

    // Insert clinic_members row
    const { error: insertError } = await serviceClient.from('clinic_members').insert({
      clinic_id: clinicId,
      user_id: newUserId,
      role: role,
      display_name: name!.trim(),
    });

    if (insertError) {
      // For a fresh invite, the login was created but clinic_members insert
      // failed -- bad, but the invite email already went out. For the
      // re-link path, no new login/email is involved, so this is just a
      // failed insert. Either way: log it but don't fail the whole request,
      // since undoing the invite/lookup above isn't possible from here.
      console.error(`Failed to insert clinic_members for user ${newUserId}:`, insertError);
      return json(
        {
          success: false,
          error: reLinkedExisting
            ? `Found their existing account but failed to grant clinic access: ${insertError.message}`
            : `Invite sent but failed to set up clinic access: ${insertError.message}`,
        },
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
        console.error(
          `Failed to create therapist roster row for user ${newUserId}:`,
          therapistError
        );
        return json(
          {
            success: true,
            message: reLinkedExisting
              ? `${email} was added to this clinic`
              : `Invitation sent to ${email}`,
            warning: `Could not add them to the service roster automatically: ${therapistError.message}. Add them from Settings → Team → Service roster.`,
          },
          200
        );
      }
    }

    return json(
      {
        success: true,
        message: reLinkedExisting
          ? `${email} was added to this clinic`
          : `Invitation sent to ${email}`,
      },
      200
    );
  } catch (error) {
    console.error('Unexpected error:', error);
    return json(
      { error: `Server error: ${error instanceof Error ? error.message : 'Unknown error'}` },
      500
    );
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
