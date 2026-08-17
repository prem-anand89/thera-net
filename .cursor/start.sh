#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
CURSOR_DIR="$(dirname "$0")"

# Local Supabase requires Docker; skip gracefully when unavailable (no passwordless sudo on agent pods)
if ! docker info >/dev/null 2>&1; then
  echo "Docker unavailable; skipping local Supabase bootstrap" >&2
  exit 0
fi

# Start local Supabase stack (Postgres + Auth + PostgREST + Kong)
docker compose -f "$CURSOR_DIR/docker-compose.supabase.yml" up -d

# Wait for Postgres and apply schema if this is a fresh volume
for _ in $(seq 1 60); do
  if docker exec supabase-db pg_isready -U postgres >/dev/null 2>&1; then
    break
  fi
  sleep 2
done

# First-boot: run migrations, seed, and set service passwords
if ! docker exec supabase-db psql -U postgres -d postgres -tAc \
  "SELECT 1 FROM public.clinics WHERE id='11111111-1111-4111-8111-111111111111'" | grep -q 1; then
  for f in "$ROOT"/supabase/migrations/*.sql; do
    docker exec -i supabase-db psql -U postgres -d postgres <"$f" >/dev/null
  done
  docker exec -i supabase-db psql -U postgres -d postgres <"$ROOT/supabase/seed.sql" >/dev/null
  docker exec -e PGPASSWORD=postgres supabase-db psql -U supabase_admin -d postgres -c \
    "ALTER USER supabase_auth_admin WITH PASSWORD 'postgres'; ALTER USER authenticator WITH PASSWORD 'postgres';" >/dev/null
  docker compose -f "$CURSOR_DIR/docker-compose.supabase.yml" restart auth rest >/dev/null
fi

# Ensure test admin exists (idempotent)
ANON_KEY='eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0'
curl -sf -X POST 'http://127.0.0.1:54321/auth/v1/signup' \
  -H "apikey: $ANON_KEY" \
  -H 'Content-Type: application/json' \
  -d '{"email":"admin@thera.local","password":"testpass123"}' >/dev/null 2>&1 || true

docker exec supabase-db psql -U postgres -d postgres -c \
  "INSERT INTO public.clinic_members (clinic_id, user_id, role)
   SELECT '11111111-1111-4111-8111-111111111111', id, 'admin'
   FROM auth.users WHERE email = 'admin@thera.local'
   ON CONFLICT DO NOTHING;" >/dev/null 2>&1 || true

# Wait for API gateway
for _ in $(seq 1 30); do
  curl -sf "http://127.0.0.1:54321/auth/v1/health" -H "apikey: $ANON_KEY" >/dev/null 2>&1 && exit 0
  sleep 2
done

echo "Supabase API did not become ready in time" >&2
exit 1
