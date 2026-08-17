#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."

# Node dependencies (idempotent)
npm ci

# Playwright browsers for e2e (system libs are in .cursor/Dockerfile)
npx playwright install chromium

# Local Supabase CLI (project dev dependency)
# Already in package-lock.json after first setup; npm ci installs it.

# Write .env for local Supabase when not already configured
if [[ ! -f .env ]]; then
  cat > .env <<'EOF'
VITE_SUPABASE_URL=http://127.0.0.1:54321
VITE_SUPABASE_ANON_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0
EOF
fi
