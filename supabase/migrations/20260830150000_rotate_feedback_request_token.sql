-- ---------------------------------------------------------------------------
-- Patient Communications, Slice 1: "Resend" on an existing feedback
-- request. Creating a request goes through the normal Dexie/outbox path
-- (an upsert), which works for the initial token because the column
-- default (generate_url_safe_token(), from the foundation migration)
-- fires on INSERT when the client omits the column. Rotating the token on
-- an *existing* row is an UPDATE, where column defaults never apply — so
-- resend needs a small dedicated RPC instead, same reasoning
-- issue_invoice() is an RPC rather than outbox-synced (server-authoritative
-- value, can't be produced offline).
--
-- security invoker (the default — not stated explicitly), not definer:
-- this is for authenticated staff, not the anonymous public flow, and the
-- existing feedback_requests_update RLS policy (admin/front_desk/own-
-- therapist) already gates who may call this correctly. No elevated
-- privileges needed, unlike the Slice 0 public RPCs.
-- ---------------------------------------------------------------------------
create or replace function public.rotate_feedback_request_token(p_request_id uuid)
returns text
language plpgsql as $$
declare
  v_token text;
begin
  update feedback_requests
    set token = public.generate_url_safe_token(),
        expires_at = now() + interval '21 days',
        status = 'pending'
    where id = p_request_id
    returning token into v_token;

  if v_token is null then
    raise exception 'Feedback request not found or not visible.';
  end if;

  return v_token;
end $$;

-- Functionally safe either way (the underlying UPDATE is still RLS-gated,
-- so an anon caller would just get zero rows updated and the exception
-- above), but explicit is better than relying on Postgres's anon-gets-
-- EXECUTE-by-default behavior — same reasoning the Slice 0 migration's
-- own public RPCs state for their (opposite-direction) explicit grants.
--
-- Revoke from both `public` (the pseudo-role every real role inherits
-- from) AND `anon` explicitly: confirmed live that Supabase also
-- auto-grants EXECUTE on new public-schema functions directly to
-- anon/authenticated at creation time, a separate mechanism from the
-- PUBLIC-pseudo-role grant, so `revoke ... from public` alone doesn't
-- close it — same gap found and fixed for check_public_rpc_rate_limit()
-- in the Slice 0 follow-up migrations.
revoke execute on function public.rotate_feedback_request_token(uuid) from public, anon;
grant execute on function public.rotate_feedback_request_token(uuid) to authenticated;
