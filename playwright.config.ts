import { readFileSync, existsSync } from 'node:fs';
import { defineConfig } from '@playwright/test';

function loadDotEnv() {
  if (!existsSync('.env')) return;
  for (const line of readFileSync('.env', 'utf8').split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq < 0) continue;
    const key = trimmed.slice(0, eq);
    const value = trimmed.slice(eq + 1);
    if (process.env[key] === undefined) process.env[key] = value;
  }
}

loadDotEnv();

const localSupabase = (process.env.VITE_SUPABASE_URL ?? '').includes('127.0.0.1');
if (localSupabase) {
  process.env.E2E_EMAIL ??= 'admin@thera.local';
  process.env.E2E_PASSWORD ??= 'testpass123';
}

export default defineConfig({
  testDir: 'e2e',
  timeout: 180_000,
  use: {
    baseURL: 'http://localhost:5173',
  },
  webServer: {
    command: 'npm run dev',
    url: 'http://localhost:5173',
    reuseExistingServer: true,
  },
});
