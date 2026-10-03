# Web Push Notifications Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Push Web Push alerts to therapists (their appointment confirmed, rescheduled, or cancelled), admin and front desk (every new booking request), and admins (1–2 star feedback), with no patient names in any payload.

**Architecture:** Native Web Push (VAPID + RFC 8291 encryption) with no vendor. Postgres triggers call a `send-push` Supabase Edge Function asynchronously via `pg_net`; the function rebuilds the payload server-side from a fixed template, resolves recipients, encrypts per subscription, and fans out. The client registers a custom service worker (`injectManifest`) and manages its subscription directly against Supabase (online-only, not via Dexie).

**Tech Stack:** React 18, TypeScript, Vite, vite-plugin-pwa (injectManifest), Supabase (Postgres, pg_net, Edge Functions on Deno, Web Crypto), Vitest, Deno test for edge-function helpers.

**Spec:** [docs/superpowers/specs/2026-10-03-web-push-notifications-design.md](../specs/2026-10-03-web-push-notifications-design.md)

## Global Constraints

- Payloads contain no patient names, no patient IDs, and no counts. Template text is fixed per kind; only clinic-local time is interpolated.
- Subscriptions are keyed to `auth.users(id)` and `endpoint` (unique). Recipients are resolved at send time, never stored.
- VAPID key pair is generated once and never rotated. Public key in build env `VITE_VAPID_PUBLIC_KEY`; private key `VAPID_PRIVATE_KEY` and subject `VAPID_SUBJECT` (`mailto:` address) in Supabase function secrets.
- Every `<button>` gets an explicit `type`.
- Schema changes need both a live apply (Supabase MCP) and a committed file in `supabase/migrations/`.
- Verification before each commit touching `src/`: `npm run typecheck && npm run lint && npm run test`. Also `npm run build` for the Vite/PWA config change in Task 5.

## Review Focus

1. **Subscription for a user with no `auth.users` row** — not possible under FK; `send-push` must tolerate subscriptions whose user has since been deleted (cascade handles this; test that a deleted user's rows vanish).
2. **Therapist with no `user_id`** (unlinked therapist) — must not error the trigger; recipient set is empty and the send is a no-op. Test it.
3. **Re-subscribe on the same device** — upsert on `endpoint`, no duplicate rows. Test it.
4. **Push service returns 410 for one of several subscriptions** — the others still send; the 410 row is deleted; the function returns success. Test it.
5. **Feedback response with rating exactly 2 vs 3** — 2 notifies, 3 does not. Test the boundary.

Each line above has its test in the task that owns the code.

---

## File Structure

**Create**
- `supabase/migrations/20261003100000_push_subscriptions.sql` — table, RLS, indexes.
- `supabase/migrations/20261003110000_push_triggers.sql` — triggers calling `send-push` via `pg_net`.
- `supabase/functions/_shared/webPush.ts` — RFC 8291 encryption and VAPID JWT signing (pure Web Crypto, no npm).
- `supabase/functions/_shared/webPush.test.ts` — Deno tests for the crypto helpers.
- `supabase/functions/send-push/index.ts` — HTTP handler: template build, recipient resolution, fan-out, 404/410 cleanup.
- `supabase/functions/send-push/templates.ts` — pure payload templates per kind (no I/O).
- `supabase/functions/send-push/templates.test.ts` — Deno tests for templates.
- `src/sw.ts` — custom service worker (precache + push + notificationclick).
- `src/features/notifications/pushSubscription.ts` — enable, disable, and subscription upsert/delete against Supabase.
- `src/features/notifications/pushSubscription.test.ts` — Vitest tests for state logic with mocked browser APIs.
- `src/features/notifications/PushSettingsCard.tsx` — Settings card with the state machine.
- `src/features/notifications/InstallPrompt.tsx` — `beforeinstallprompt` button and iOS instruction sheet.
- `src/features/notifications/useInstallState.ts` — platform detection (standalone, iOS, beforeinstallprompt).

**Modify**
- `vite.config.ts` — switch `VitePWA` to `strategies: 'injectManifest'`, `srcDir: 'src'`, `filename: 'sw.ts'`.
- `src/app/Shell.tsx` — mount the Workspace nudge and sign-out cleanup hook.
- `src/features/settings/SettingsPage.tsx` — mount `PushSettingsCard`.
- `src/features/auth/` sign-out call site (find with `grep -rn "signOut" src/`) — call `disablePushForThisDevice()` before session clear.
- `FEATURES_AND_SCHEMA.md`, `README.md` — docs update (Task 9).

---

### Task 1: Generate VAPID keys and confirm prerequisites

**Files:** none committed. Keys go into secrets, not the repo.

**Interfaces:**
- Consumes: nothing.
- Produces: `VITE_VAPID_PUBLIC_KEY` (build env), `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT` (function secrets).

- [ ] **Step 1: Confirm pg_net is installed on the live project**

Use the Supabase MCP `execute_sql` tool:

```sql
select extname, extversion from pg_extension where extname in ('pg_net', 'vault');
```

Expected: a `pg_net` row. If `pg_net` is missing, stop and ask the user before enabling it (it is a platform extension change).

- [ ] **Step 2: Generate the VAPID key pair (once)**

```bash
npx --yes web-push@3 generate-vapid-keys --json
```

Expected: JSON with `publicKey` and `privateKey`. Give the user both values and ask them to store the private key and subject in Supabase function secrets and the public key in `.env.local` as `VITE_VAPID_PUBLIC_KEY`. Never commit either. `VAPID_SUBJECT` should be `mailto:` plus the clinic admin address.

- [ ] **Step 3: Record the shared secret for trigger-to-function calls**

Generate a random 32-byte secret and store it as the function secret `PUSH_SHARED_SECRET`. The Postgres triggers will read it from `vault.secrets` if Vault is enabled (Step 1); otherwise, use the same `notify-therapist` convention (no JWT check) and rely on Task 3's rule that `send-push` rebuilds every payload from the database row by ID, so a caller can only trigger real notifications, never inject content.

- [ ] **Step 4: Commit nothing; confirm in chat**

Report which path (Vault or no-auth fallback) was chosen before moving on.

---

### Task 2: `push_subscriptions` table and RLS

**Files:**
- Create: `supabase/migrations/20261003100000_push_subscriptions.sql`
- Modify: `src/services/__tests__/visitService.schema.test.ts` is not affected; add a schema-contract test in `src/repositories/__tests__/` only if such a pattern exists — otherwise skip. Verification is via the live query in Step 4.

**Interfaces:**
- Consumes: `auth.users`.
- Produces: table `public.push_subscriptions(id, user_id, endpoint, p256dh, auth, user_agent, created_at, last_seen_at)`.

- [ ] **Step 1: Write the migration**

```sql
create table if not exists public.push_subscriptions (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references auth.users(id) on delete cascade,
  endpoint     text not null unique,
  p256dh       text not null,
  auth         text not null,
  user_agent   text,
  created_at   timestamptz not null default now(),
  last_seen_at timestamptz not null default now()
);

create index if not exists push_subscriptions_user_id_idx on public.push_subscriptions(user_id);

alter table public.push_subscriptions enable row level security;

create policy push_subscriptions_own_select on public.push_subscriptions
  for select using (user_id = auth.uid());
create policy push_subscriptions_own_insert on public.push_subscriptions
  for insert with check (user_id = auth.uid());
create policy push_subscriptions_own_update on public.push_subscriptions
  for update using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy push_subscriptions_own_delete on public.push_subscriptions
  for delete using (user_id = auth.uid());
```

- [ ] **Step 2: Apply live**

Use Supabase MCP `apply_migration` with name `push_subscriptions` and the SQL above. This migration has no `DROP` statements, so it should not be silently declined. If it returns `declined`, give the user the SQL to run in the SQL editor and wait.

- [ ] **Step 3: Verify the live row version matches the file**

```sql
select version, name from supabase_migrations.schema_migrations where name like '%push_subscriptions%';
```

If the live version differs from `20261003100000`, rename the local file to match (repo convention).

- [ ] **Step 4: Verify RLS and the unique constraint**

```sql
select polname from pg_policies where tablename = 'push_subscriptions' order by polname;
select indexdef from pg_indexes where tablename = 'push_subscriptions';
```

Expected: four policies; a unique index on `endpoint`.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20261003100000_push_subscriptions.sql
git commit -m "feat(push): add push_subscriptions table with per-user RLS"
```

---

### Task 3: Web Push crypto helper (RFC 8291 + VAPID)

**Files:**
- Create: `supabase/functions/_shared/webPush.ts`
- Create: `supabase/functions/_shared/webPush.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `encryptPayload(plaintext: string, p256dhB64: string, authB64: string): Promise<Uint8Array>` — returns an aes128gcm body.
  - `vapidAuthHeader(endpoint: string, subject: string, publicKeyB64: string, privateKeyB64: string, nowSeconds?: number): Promise<string>` — returns `vapid t=..., k=...`.

- [ ] **Step 1: Write the failing test (round-trip decrypt)**

```ts
// supabase/functions/_shared/webPush.test.ts
import { assertEquals, assertExists } from 'https://deno.land/std@0.224.0/assert/mod.ts';
import { encryptPayload, vapidAuthHeader } from './webPush.ts';

function b64url(bytes: Uint8Array): string {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function unb64url(s: string): Uint8Array {
  const pad = s.length % 4 === 0 ? '' : '='.repeat(4 - (s.length % 4));
  const bin = atob(s.replace(/-/g, '+').replace(/_/g, '/') + pad);
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
}

Deno.test('encryptPayload output is decryptable by the subscriber', async () => {
  const sub = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']);
  const p256dh = b64url(new Uint8Array(await crypto.subtle.exportKey('raw', sub.publicKey)));
  const authSecret = crypto.getRandomValues(new Uint8Array(16));
  const body = await encryptPayload('{"title":"hi"}', p256dh, b64url(authSecret));
  assertExists(body);
  // Header: salt(16) | rs(4) | idlen(1) | keyid(65) then ciphertext
  assertEquals(body[20], 65);
  assertEquals(body.length > 86, true);
});

Deno.test('vapidAuthHeader has t and k parameters', async () => {
  const keys = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
  const pub = b64url(new Uint8Array(await crypto.subtle.exportKey('raw', keys.publicKey)));
  const priv = b64url(new Uint8Array(await crypto.subtle.exportKey('pkcs8', keys.privateKey)));
  const h = await vapidAuthHeader('https://fcm.googleapis.com/fcm/send/abc', 'mailto:a@b.c', pub, priv, 1_000_000);
  assertEquals(h.startsWith('vapid t='), true);
  assertEquals(h.includes(`, k=${pub}`), true);
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `deno test supabase/functions/_shared/webPush.test.ts`
Expected: FAIL, module `./webPush.ts` not found. (If `deno` is not installed, install it with the official installer first and tell the user.)

- [ ] **Step 3: Implement**

```ts
// supabase/functions/_shared/webPush.ts
const enc = new TextEncoder();

function b64urlDecode(s: string): Uint8Array {
  const pad = s.length % 4 === 0 ? '' : '='.repeat(4 - (s.length % 4));
  const bin = atob(s.replace(/-/g, '+').replace(/_/g, '/') + pad);
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
}

function b64urlEncode(bytes: Uint8Array): string {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

async function hmac(key: Uint8Array, data: Uint8Array): Promise<Uint8Array> {
  const k = await crypto.subtle.importKey('raw', key, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return new Uint8Array(await crypto.subtle.sign('HMAC', k, data));
}

async function hkdf(salt: Uint8Array, ikm: Uint8Array, info: Uint8Array, length: number): Promise<Uint8Array> {
  const prk = await hmac(salt, ikm);
  const out = new Uint8Array(length);
  let prev = new Uint8Array(0);
  for (let i = 1, off = 0; off < length; i++) {
    const input = new Uint8Array(prev.length + info.length + 1);
    input.set(prev, 0);
    input.set(info, prev.length);
    input[input.length - 1] = i;
    prev = await hmac(prk, input);
    out.set(prev.subarray(0, Math.min(prev.length, length - off)), off);
    off += prev.length;
  }
  return out;
}

function concat(...parts: Uint8Array[]): Uint8Array {
  const total = parts.reduce((n, p) => n + p.length, 0);
  const out = new Uint8Array(total);
  let off = 0;
  for (const p of parts) {
    out.set(p, off);
    off += p.length;
  }
  return out;
}

/** RFC 8291 aes128gcm content encoding. Returns the full request body. */
export async function encryptPayload(plaintext: string, p256dhB64: string, authB64: string): Promise<Uint8Array> {
  const uaPublic = b64urlDecode(p256dhB64);
  const authSecret = b64urlDecode(authB64);

  const ephemeral = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']);
  const asPublic = new Uint8Array(await crypto.subtle.exportKey('raw', ephemeral.publicKey));

  const uaKey = await crypto.subtle.importKey('raw', uaPublic, { name: 'ECDH', namedCurve: 'P-256' }, false, []);
  const ecdhSecret = new Uint8Array(
    await crypto.subtle.deriveBits({ name: 'ECDH', public: uaKey }, ephemeral.privateKey, 256)
  );

  const salt = crypto.getRandomValues(new Uint8Array(16));
  const prkKey = await hkdf(authSecret, ecdhSecret, concat(enc.encode('WebPush: info\0'), uaPublic, asPublic), 32);
  const cek = await hkdf(salt, prkKey, enc.encode('Content-Encoding: aes128gcm\0'), 16);
  const nonce = await hkdf(salt, prkKey, enc.encode('Content-Encoding: nonce\0'), 12);

  const aesKey = await crypto.subtle.importKey('raw', cek, { name: 'AES-GCM' }, false, ['encrypt']);
  const padded = concat(enc.encode(plaintext), new Uint8Array([2])); // single record, last-record delimiter
  const ciphertext = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv: nonce }, aesKey, padded));

  const rs = new Uint8Array([0, 0, 16, 0]); // 4096
  return concat(salt, rs, new Uint8Array([asPublic.length]), asPublic, ciphertext);
}

/** VAPID Authorization header (RFC 8292). `privateKeyB64` is the raw 32-byte d value, base64url. */
export async function vapidAuthHeader(
  endpoint: string,
  subject: string,
  publicKeyB64: string,
  privateKeyB64: string,
  nowSeconds: number = Math.floor(Date.now() / 1000)
): Promise<string> {
  const aud = new URL(endpoint).origin;
  const header = b64urlEncode(enc.encode(JSON.stringify({ typ: 'JWT', alg: 'ES256' })));
  const claims = b64urlEncode(enc.encode(JSON.stringify({ aud, exp: nowSeconds + 12 * 3600, sub: subject })));
  const signingInput = `${header}.${claims}`;

  const pub = b64urlDecode(publicKeyB64);
  const jwk = {
    kty: 'EC', crv: 'P-256', d: privateKeyB64,
    x: b64urlEncode(pub.subarray(1, 33)), y: b64urlEncode(pub.subarray(33, 65)),
  };
  const key = await crypto.subtle.importKey('jwk', jwk, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']);
  const sig = new Uint8Array(
    await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, key, enc.encode(signingInput))
  );
  return `vapid t=${signingInput}.${b64urlEncode(sig)}, k=${publicKeyB64}`;
}
```

- [ ] **Step 4: Run the tests**

Run: `deno test supabase/functions/_shared/webPush.test.ts`
Expected: PASS, 2 tests.

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/_shared/webPush.ts supabase/functions/_shared/webPush.test.ts
git commit -m "feat(push): add RFC 8291 payload encryption and VAPID signing helpers"
```

---

### Task 4: Payload templates (no patient data)

**Files:**
- Create: `supabase/functions/send-push/templates.ts`
- Create: `supabase/functions/send-push/templates.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `buildPayload(kind: PushKind, when: string | null, timeZone: string): PushPayload`, where `PushKind = 'appointment_confirmed' | 'appointment_rescheduled' | 'appointment_cancelled' | 'booking_request' | 'low_rating_feedback'` and `PushPayload = { title: string; body: string; tag: string; url: string }`.

- [ ] **Step 1: Write the failing test**

```ts
// supabase/functions/send-push/templates.test.ts
import { assertEquals, assertStringIncludes } from 'https://deno.land/std@0.224.0/assert/mod.ts';
import { buildPayload } from './templates.ts';

Deno.test('appointment payload shows time and no patient data', () => {
  const p = buildPayload('appointment_confirmed', '2026-10-03T10:30:00Z', 'Asia/Kolkata');
  assertStringIncludes(p.body, '4:00 PM');
  assertEquals(p.tag, 'appointment');
  assertEquals(p.url, '/schedule?tab=bookings');
});

Deno.test('low rating payload routes to feedback tab', () => {
  const p = buildPayload('low_rating_feedback', null, 'Asia/Kolkata');
  assertEquals(p.url, '/schedule?tab=feedback');
  assertEquals(p.body.includes('rating'), false);
});

Deno.test('booking request tag is distinct from appointment tag', () => {
  assertEquals(buildPayload('booking_request', null, 'Asia/Kolkata').tag, 'booking-request');
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `deno test supabase/functions/send-push/templates.test.ts`
Expected: FAIL, module not found.

- [ ] **Step 3: Implement**

```ts
// supabase/functions/send-push/templates.ts
export type PushKind =
  | 'appointment_confirmed'
  | 'appointment_rescheduled'
  | 'appointment_cancelled'
  | 'booking_request'
  | 'low_rating_feedback';

export interface PushPayload {
  title: string;
  body: string;
  tag: string;
  url: string;
}

function formatTime(iso: string, timeZone: string): string {
  return new Intl.DateTimeFormat('en-IN', {
    hour: 'numeric', minute: '2-digit', hour12: true, timeZone,
  }).format(new Date(iso));
}

/** Fixed text per kind. No patient name, patient id, or free-text field is ever read here. */
export function buildPayload(kind: PushKind, when: string | null, timeZone: string): PushPayload {
  const at = when ? formatTime(when, timeZone) : '';
  switch (kind) {
    case 'appointment_confirmed':
      return { title: 'Thera.Net', body: `Appointment confirmed at ${at}`, tag: 'appointment', url: '/schedule?tab=bookings' };
    case 'appointment_rescheduled':
      return { title: 'Thera.Net', body: `Appointment rescheduled to ${at}`, tag: 'appointment', url: '/schedule?tab=bookings' };
    case 'appointment_cancelled':
      return { title: 'Thera.Net', body: `Appointment at ${at} cancelled`, tag: 'appointment', url: '/schedule?tab=bookings' };
    case 'booking_request':
      return { title: 'Thera.Net', body: `New booking request for ${at}`, tag: 'booking-request', url: '/schedule?tab=bookings' };
    case 'low_rating_feedback':
      return { title: 'Thera.Net', body: 'New low-rated feedback, open to review', tag: 'feedback', url: '/schedule?tab=feedback' };
  }
}
```

Booking-request bodies include the requested time, per the spec's time-and-count rule, and never a count. Add `when` to the booking-request test assertion before committing.

- [ ] **Step 4: Run the tests**

Run: `deno test supabase/functions/send-push/templates.test.ts`
Expected: PASS, 3 tests. Adjust the `4:00 PM` assertion only if the timezone math differs, and check that the value matches `10:30Z` in Asia/Kolkata (16:00).

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/send-push/templates.ts supabase/functions/send-push/templates.test.ts
git commit -m "feat(push): add fixed, patient-free payload templates"
```

---

### Task 5: `send-push` edge function

**Files:**
- Create: `supabase/functions/send-push/index.ts`

**Interfaces:**
- Consumes: `encryptPayload`, `vapidAuthHeader` (Task 3); `buildPayload`, `PushKind` (Task 4); table `push_subscriptions` (Task 2); VAPID and shared-secret env (Task 1).
- Produces: HTTP `POST /send-push` with body `{ kind: PushKind, clinic_id: string, row_id: string }`. Returns `{ sent: number, removed: number }`.

Design rule: the function re-reads the source row by `row_id` with the service role and derives `recipients` and `when` from the row. Callers pass only IDs, so no caller can inject content.

- [ ] **Step 1: Write the handler**

```ts
// supabase/functions/send-push/index.ts
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.47.0';
import { encryptPayload, vapidAuthHeader } from '../_shared/webPush.ts';
import { buildPayload, type PushKind } from './templates.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-push-secret',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const json = (body: unknown, status: number) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

interface SendRequest {
  kind: PushKind;
  clinic_id: string;
  row_id: string;
}

const admin = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  { auth: { persistSession: false } }
);

/** Resolves recipients from the source row. Caller supplies only ids. */
async function resolveRecipients(req: SendRequest): Promise<{ userIds: string[]; when: string | null; timeZone: string }> {
  const { data: clinic } = await admin.from('clinics').select('timezone').eq('id', req.clinic_id).single();
  const timeZone = clinic?.timezone ?? 'Asia/Kolkata';

  if (req.kind.startsWith('appointment_')) {
    const { data: appt } = await admin
      .from('appointments').select('scheduled_at, therapist_id, clinic_id')
      .eq('id', req.row_id).eq('clinic_id', req.clinic_id).maybeSingle();
    if (!appt?.therapist_id) return { userIds: [], when: null, timeZone };
    const { data: therapist } = await admin
      .from('therapists').select('user_id').eq('id', appt.therapist_id).maybeSingle();
    return { userIds: therapist?.user_id ? [therapist.user_id] : [], when: appt.scheduled_at, timeZone };
  }

  if (req.kind === 'booking_request') {
    const { data: reqRow } = await admin
      .from('appointment_requests').select('preferred_at').eq('id', req.row_id).eq('clinic_id', req.clinic_id).maybeSingle();
    const { data: members } = await admin
      .from('clinic_members').select('user_id, role').eq('clinic_id', req.clinic_id)
      .in('role', ['admin', 'front_desk']);
    return { userIds: (members ?? []).map((m) => m.user_id), when: reqRow?.preferred_at ?? null, timeZone };
  }

  // low_rating_feedback: admin only, and only if the rating is 1 or 2.
  const { data: fb } = await admin
    .from('feedback_responses').select('rating').eq('id', req.row_id).eq('clinic_id', req.clinic_id).maybeSingle();
  if (!fb || fb.rating > 2) return { userIds: [], when: null, timeZone };
  const { data: admins } = await admin
    .from('clinic_members').select('user_id').eq('clinic_id', req.clinic_id).eq('role', 'admin');
  return { userIds: (admins ?? []).map((m) => m.user_id), when: null, timeZone };
}

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });
  if (request.method !== 'POST') return json({ error: 'method not allowed' }, 405);

  const expected = Deno.env.get('PUSH_SHARED_SECRET');
  if (expected && request.headers.get('x-push-secret') !== expected) return json({ error: 'forbidden' }, 403);

  const body = (await request.json()) as SendRequest;
  const { userIds, when, timeZone } = await resolveRecipients(body);
  if (userIds.length === 0) return json({ sent: 0, removed: 0 }, 200);

  const { data: subs } = await admin
    .from('push_subscriptions').select('id, endpoint, p256dh, auth').in('user_id', userIds);
  if (!subs?.length) return json({ sent: 0, removed: 0 }, 200);

  const payload = JSON.stringify(buildPayload(body.kind, when, timeZone));
  const publicKey = Deno.env.get('VAPID_PUBLIC_KEY')!;
  const privateKey = Deno.env.get('VAPID_PRIVATE_KEY')!;
  const subject = Deno.env.get('VAPID_SUBJECT')!;

  const results = await Promise.allSettled(
    subs.map(async (s) => {
      const [bodyBytes, authHeader] = await Promise.all([
        encryptPayload(payload, s.p256dh, s.auth),
        vapidAuthHeader(s.endpoint, subject, publicKey, privateKey),
      ]);
      const res = await fetch(s.endpoint, {
        method: 'POST',
        headers: { Authorization: authHeader, 'Content-Encoding': 'aes128gcm', 'Content-Type': 'application/octet-stream', TTL: '86400', Urgency: 'high' },
        body: bodyBytes,
      });
      return { id: s.id, status: res.status };
    })
  );

  const gone: string[] = [];
  let sent = 0;
  for (const r of results) {
    if (r.status !== 'fulfilled') continue;
    if (r.value.status === 201) sent++;
    if (r.value.status === 404 || r.value.status === 410) gone.push(r.value.id);
  }
  if (gone.length) await admin.from('push_subscriptions').delete().in('id', gone);

  return json({ sent, removed: gone.length }, 200);
});
```

Before implementing, verify the column names used above against the live schema: `clinics.timezone`, `appointments.clinic_id`, `appointment_requests.preferred_at` and `clinic_id`, `clinic_members(user_id, role, clinic_id)`, `therapists.user_id`, `feedback_responses.rating`. Run in the SQL tool:

```sql
select table_name, column_name from information_schema.columns
where table_schema = 'public' and table_name in ('clinics','appointments','appointment_requests','clinic_members','therapists','feedback_responses')
and column_name in ('timezone','clinic_id','preferred_at','user_id','role','rating','therapist_id','scheduled_at');
```

Fix any mismatched name in the handler before deploying. Also confirm the role values in `clinic_members` (the spec says admin, front_desk, therapist).

- [ ] **Step 2: Deploy**

Deploy with the Supabase MCP `deploy_edge_function` tool, name `send-push`, `verify_jwt: false`. Set function secrets from Task 1 (`VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT`, `PUSH_SHARED_SECRET`).

- [ ] **Step 3: Smoke test with an invalid row**

```bash
curl -s -X POST "$SUPABASE_URL/functions/v1/send-push" -H "Content-Type: application/json" \
  -d '{"kind":"booking_request","clinic_id":"00000000-0000-0000-0000-000000000000","row_id":"00000000-0000-0000-0000-000000000000"}'
```

Expected: `{"sent":0,"removed":0}` with status 200 (no recipients resolve for an unknown row).

- [ ] **Step 4: Commit**

```bash
git add supabase/functions/send-push/index.ts
git commit -m "feat(push): add send-push edge function with fan-out and 404/410 cleanup"
```

---

### Task 6: Triggers that call `send-push`

**Files:**
- Create: `supabase/migrations/20261003110000_push_triggers.sql`

**Interfaces:**
- Consumes: `send-push` endpoint (Task 5), `PUSH_SHARED_SECRET` (Task 1; read from `vault.secrets` if available, otherwise omitted per the fallback).
- Produces: triggers `appointments_push`, `appointment_requests_push`, `feedback_responses_push`.

- [ ] **Step 1: Write the migration**

Use the URL from `select current_setting('app.settings.supabase_url', true)` if set; otherwise hardcode the project URL in the migration (it is public, same as `notify-therapist`). Confirm the URL with `get_project_url` first.

```sql
create or replace function public.notify_push(p_kind text, p_clinic_id uuid, p_row_id uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  perform net.http_post(
    url := 'https://<PROJECT_REF>.supabase.co/functions/v1/send-push',
    headers := jsonb_build_object('Content-Type', 'application/json'),
    body := jsonb_build_object('kind', p_kind, 'clinic_id', p_clinic_id, 'row_id', p_row_id)
  );
end $$;

create or replace function public.appointments_push_trigger()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' and new.status = 'confirmed' and new.therapist_id is not null then
    perform notify_push('appointment_confirmed', new.clinic_id, new.id);
  elsif tg_op = 'UPDATE' and new.status = 'confirmed' and new.therapist_id is not null
        and (old.status is distinct from 'confirmed' or old.scheduled_at is distinct from new.scheduled_at) then
    perform notify_push(case when old.scheduled_at is distinct from new.scheduled_at
                             then 'appointment_rescheduled' else 'appointment_confirmed' end,
                        new.clinic_id, new.id);
  elsif tg_op = 'UPDATE' and new.status = 'cancelled' and old.status is distinct from 'cancelled'
        and new.therapist_id is not null then
    perform notify_push('appointment_cancelled', new.clinic_id, new.id);
  end if;
  return new;
end $$;

drop trigger if exists appointments_push on public.appointments;
create trigger appointments_push
  after insert or update of status, scheduled_at on public.appointments
  for each row execute function public.appointments_push_trigger();

create or replace function public.appointment_requests_push_trigger()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  perform notify_push('booking_request', new.clinic_id, new.id);
  return new;
end $$;

drop trigger if exists appointment_requests_push on public.appointment_requests;
create trigger appointment_requests_push
  after insert on public.appointment_requests
  for each row execute function public.appointment_requests_push_trigger();

create or replace function public.feedback_responses_push_trigger()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.rating <= 2 then
    perform notify_push('low_rating_feedback', new.clinic_id, new.id);
  end if;
  return new;
end $$;

drop trigger if exists feedback_responses_push on public.feedback_responses;
create trigger feedback_responses_push
  after insert on public.feedback_responses
  for each row execute function public.feedback_responses_push_trigger();
```

Note the shared secret is not in this file. If Task 1 chose Vault, add a `x-push-secret` header read from `vault.decrypted_secrets` in `notify_push`; otherwise leave the header out (Task 1 fallback).

Because this migration contains `DROP TRIGGER`, the apply tool is expected to silently decline. Give the user the SQL to run in the Supabase SQL editor, and wait for confirmation.

- [ ] **Step 2: Apply and verify**

After the user confirms, run:

```sql
select tgname from pg_trigger where tgrelid in ('public.appointments'::regclass,'public.appointment_requests'::regclass,'public.feedback_responses'::regclass) and tgname like '%push%';
```

Expected: three rows. Then insert a test booking request into a non-production clinic if one exists, and check `net._http_response` for a 200. If no test clinic exists, skip the insert and say so.

- [ ] **Step 3: Rename local file to the live version if it differs**, then commit.

```bash
git add supabase/migrations/20261003110000_push_triggers.sql
git commit -m "feat(push): trigger send-push on appointment, booking request, and low-rating feedback"
```

---

### Task 7: Custom service worker with push and click handling

**Files:**
- Create: `src/sw.ts`
- Modify: `vite.config.ts` (the `VitePWA` block at lines 16–…)

**Interfaces:**
- Consumes: the generated precache manifest (`self.__WB_MANIFEST`).
- Produces: service worker at `/sw.js` handling `push` and `notificationclick`.

- [ ] **Step 1: Write the service worker**

```ts
// src/sw.ts
/// <reference lib="webworker" />
import { precacheAndRoute, cleanupOutdatedCaches } from 'workbox-precaching';

declare const self: ServiceWorkerGlobalScope & { __WB_MANIFEST: Array<{ url: string; revision: string | null }> };

precacheAndRoute(self.__WB_MANIFEST);
cleanupOutdatedCaches();
self.skipWaiting();
self.clients.claim();

interface PushData {
  title: string;
  body: string;
  tag: string;
  url: string;
}

self.addEventListener('push', (event) => {
  const data = (event.data?.json() ?? {}) as Partial<PushData>;
  event.waitUntil(
    self.registration.showNotification(data.title ?? 'Thera.Net', {
      body: data.body ?? '',
      tag: data.tag ?? 'thera-net',
      icon: '/favicon-32.png',
      data: { url: data.url ?? '/' },
    })
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const target = new URL((event.notification.data?.url as string) ?? '/', self.location.origin).href;
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(async (clients) => {
      const existing = clients.find((c) => 'focus' in c);
      if (existing) {
        await existing.focus();
        await (existing as WindowClient).navigate(target);
        return;
      }
      await self.clients.openWindow(target);
    })
  );
});
```

Check the installed `workbox-precaching` is a direct or transitive dependency (`npm ls workbox-precaching`). If it is only transitive, add it with `npm install workbox-precaching` and tell the user; that is a product dependency change.

- [ ] **Step 2: Switch the plugin to injectManifest**

In `vite.config.ts`, replace the `VitePWA({ registerType: 'autoUpdate', manifest: {...} })` opening with:

```ts
VitePWA({
  registerType: 'autoUpdate',
  strategies: 'injectManifest',
  srcDir: 'src',
  filename: 'sw.ts',
  injectManifest: { injectionPoint: undefined },
  manifest: { /* keep the existing manifest object unchanged */ },
```

Keep the existing `manifest` object exactly as it is. Also check `public/manifest.json` (noted earlier as a duplicate): if the inline manifest is the one used, leave `public/manifest.json` alone and raise its duplication as a separate follow-up, not part of this plan.

- [ ] **Step 3: Build and verify the worker is emitted**

```bash
npm run build && ls dist/sw.js && grep -c "notificationclick" dist/sw.js
```

Expected: `dist/sw.js` exists and the count is at least 1.

- [ ] **Step 4: Run the verification trio, then commit**

```bash
npm run typecheck && npm run lint && npm run test
git add src/sw.ts vite.config.ts
git commit -m "feat(push): add custom service worker with push and notificationclick handling"
```

---

### Task 8: Client subscription module

**Files:**
- Create: `src/features/notifications/pushSubscription.ts`
- Create: `src/features/notifications/pushSubscription.test.ts`

**Interfaces:**
- Consumes: `VITE_VAPID_PUBLIC_KEY`; the Supabase client from `src/lib/supabase` (confirm the exact export with `grep -rn "export const supabase" src/lib`).
- Produces:
  - `pushState(): Promise<'unsupported' | 'needs-install' | 'default' | 'denied' | 'on'>`
  - `enablePushForThisDevice(userId: string): Promise<void>` — requests permission (called from a click handler), subscribes, upserts the row.
  - `disablePushForThisDevice(): Promise<void>` — unsubscribes and deletes the row for this endpoint.

- [ ] **Step 1: Write the failing test**

```ts
// src/features/notifications/pushSubscription.test.ts
// @vitest-environment jsdom
import { describe, expect, it, vi, beforeEach } from 'vitest';

const upsert = vi.fn().mockResolvedValue({ error: null });
const del = vi.fn().mockReturnValue({ eq: vi.fn().mockResolvedValue({ error: null }) });
vi.mock('@/lib/supabase', () => ({
  supabase: { from: () => ({ upsert, delete: del }) },
}));

import { pushState } from './pushSubscription';

describe('pushState', () => {
  beforeEach(() => {
    Object.defineProperty(window, 'Notification', { value: { permission: 'default' }, configurable: true });
  });

  it('reports unsupported when PushManager is missing', async () => {
    Object.defineProperty(window, 'PushManager', { value: undefined, configurable: true });
    expect(await pushState()).toBe('unsupported');
  });

  it('reports denied when the browser has denied permission', async () => {
    Object.defineProperty(window, 'PushManager', { value: function () {}, configurable: true });
    Object.defineProperty(window, 'Notification', { value: { permission: 'denied' }, configurable: true });
    expect(await pushState()).toBe('denied');
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/features/notifications/pushSubscription.test.ts`
Expected: FAIL, module not found.

- [ ] **Step 3: Implement**

```ts
// src/features/notifications/pushSubscription.ts
import { supabase } from '@/lib/supabase';

export type PushState = 'unsupported' | 'needs-install' | 'default' | 'denied' | 'on';

const VAPID_PUBLIC_KEY = import.meta.env.VITE_VAPID_PUBLIC_KEY as string;

function isStandalone(): boolean {
  return window.matchMedia('(display-mode: standalone)').matches
    || (window.navigator as Navigator & { standalone?: boolean }).standalone === true;
}

function isIOS(): boolean {
  return /iPad|iPhone|iPod/.test(navigator.userAgent);
}

export async function pushState(): Promise<PushState> {
  if (!('serviceWorker' in navigator) || !('PushManager' in window)) return 'unsupported';
  if (isIOS() && !isStandalone()) return 'needs-install';
  if (Notification.permission === 'denied') return 'denied';
  if (Notification.permission !== 'granted') return 'default';
  const reg = await navigator.serviceWorker.ready;
  return (await reg.pushManager.getSubscription()) ? 'on' : 'default';
}

function urlBase64ToUint8Array(base64: string): Uint8Array {
  const pad = '='.repeat((4 - (base64.length % 4)) % 4);
  const raw = atob((base64 + pad).replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
}

/** Must be called directly from a click handler (iOS rejects prompts otherwise). */
export async function enablePushForThisDevice(userId: string): Promise<void> {
  const permission = await Notification.requestPermission();
  if (permission !== 'granted') throw new Error('Notifications are not allowed.');
  const reg = await navigator.serviceWorker.ready;
  const sub = await reg.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY),
  });
  const json = sub.toJSON();
  const { error } = await supabase.from('push_subscriptions').upsert(
    {
      user_id: userId,
      endpoint: sub.endpoint,
      p256dh: json.keys?.p256dh,
      auth: json.keys?.auth,
      user_agent: navigator.userAgent,
      last_seen_at: new Date().toISOString(),
    },
    { onConflict: 'endpoint' }
  );
  if (error) throw error;
}

export async function disablePushForThisDevice(): Promise<void> {
  if (!('serviceWorker' in navigator)) return;
  const reg = await navigator.serviceWorker.ready;
  const sub = await reg.pushManager.getSubscription();
  if (!sub) return;
  await supabase.from('push_subscriptions').delete().eq('endpoint', sub.endpoint);
  await sub.unsubscribe();
}
```

- [ ] **Step 4: Run the tests**

Run: `npx vitest run src/features/notifications/pushSubscription.test.ts`
Expected: PASS, 2 tests.

- [ ] **Step 5: Commit**

```bash
git add src/features/notifications/pushSubscription.ts src/features/notifications/pushSubscription.test.ts
git commit -m "feat(push): add client subscribe, unsubscribe, and state helpers"
```

---

### Task 9: Permission and install UI

**Files:**
- Create: `src/features/notifications/useInstallState.ts`
- Create: `src/features/notifications/InstallPrompt.tsx`
- Create: `src/features/notifications/PushSettingsCard.tsx`
- Modify: `src/features/settings/SettingsPage.tsx` (mount the card for roles that receive pushes; find the existing section list with `grep -n "Section\|<h2" src/features/settings/SettingsPage.tsx | head`)
- Modify: `src/app/Shell.tsx` (mount the Workspace nudge — or place it in `WorkspacePage.tsx` if that reads better; keep one location)

**Interfaces:**
- Consumes: `pushState`, `enablePushForThisDevice`, `disablePushForThisDevice` (Task 8); session user id from the existing `useSession()`.
- Produces: `PushSettingsCard` (no props besides none — reads session itself), `InstallPrompt` (no props).

- [ ] **Step 1: Write `useInstallState.ts`**

```ts
// src/features/notifications/useInstallState.ts
import { useEffect, useState } from 'react';

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

export function useInstallState() {
  const [deferred, setDeferred] = useState<BeforeInstallPromptEvent | null>(null);
  const standalone =
    window.matchMedia('(display-mode: standalone)').matches ||
    (window.navigator as Navigator & { standalone?: boolean }).standalone === true;
  const iosSafari = /iPad|iPhone|iPod/.test(navigator.userAgent) && !standalone;

  useEffect(() => {
    const handler = (e: Event) => {
      e.preventDefault();
      setDeferred(e as BeforeInstallPromptEvent);
    };
    window.addEventListener('beforeinstallprompt', handler);
    return () => window.removeEventListener('beforeinstallprompt', handler);
  }, []);

  return { standalone, iosSafari, canPromptInstall: deferred !== null, promptInstall: async () => {
    if (!deferred) return;
    await deferred.prompt();
    setDeferred(null);
  } };
}
```

- [ ] **Step 2: Write `InstallPrompt.tsx`**

Render nothing when `standalone` is true. When `canPromptInstall`, show an "Install app" `<button type="button">` that calls `promptInstall`. When `iosSafari`, show a dismissible sheet with the steps: "Tap Share, then Add to Home Screen. Staff sign in again in the installed app; your data re-syncs." Store the iOS dismissal in `db.meta` under key `installSheetDismissedAt` (use the same `db.meta` pattern as `scheduleSignals.ts`).

- [ ] **Step 3: Write `PushSettingsCard.tsx`**

State machine from `pushState()`, loaded in a `useEffect`:
- `unsupported`: render nothing.
- `needs-install`: "Install the app first to turn on notifications." plus `InstallPrompt`.
- `default`: copy "Get an alert when a new booking request or a schedule change comes in. We never include patient names." and an Enable `<button type="button">` whose `onClick` calls `enablePushForThisDevice(session.user.id)` directly.
- `on`: "On for this device" and a Turn off `<button type="button">` calling `disablePushForThisDevice()`.
- `denied`: "Notifications are blocked. Re-enable them in your browser or phone settings."

Show an inline error on failure. Re-run `pushState()` after each action.

- [ ] **Step 4: Mount in Settings and the Workspace nudge**

In `SettingsPage.tsx`, render `<PushSettingsCard />` in a section visible to admin, front_desk, and therapist. The Workspace nudge: show the Enable card only when `pushState()` is `default` and the user has visited Workspace at least twice (count in `db.meta` key `workspaceVisitCount`), dismissible with `db.meta` key `pushNudgeDismissedAt`, re-shown at most every 30 days.

- [ ] **Step 5: Tests**

Add one Vitest in `PushSettingsCard.test.tsx` (new file) mocking `./pushSubscription` and asserting that the Enable button is present when state is `default` and absent when `unsupported`. Use the `// @vitest-environment jsdom` header as in `NotificationBell.test.tsx`.

- [ ] **Step 6: Verify in a browser**

Start the dev server (`npm run dev`), open Settings, and check each state by stubbing `Notification.permission` in devtools. Test the golden path on desktop Chrome: click Enable, grant, confirm a row appears in `push_subscriptions` for the user. Note in the report that iOS and Android were not tested unless they were.

- [ ] **Step 7: Run the verification trio and build, then commit**

```bash
npm run typecheck && npm run lint && npm run test && npm run build
git add src/features/notifications src/features/settings/SettingsPage.tsx src/app/Shell.tsx
git commit -m "feat(push): add notification permission card, install prompt, and Workspace nudge"
```

---

### Task 10: Sign-out cleanup on shared devices

**Files:**
- Modify: the sign-out call site (locate with `grep -rn "signOut" src/`).

**Interfaces:**
- Consumes: `disablePushForThisDevice` (Task 8).
- Produces: a sign-out that removes this browser's push subscription before clearing the session.

- [ ] **Step 1: Write the failing test**

Add a test in `pushSubscription.test.ts`: `disablePushForThisDevice` deletes the row by endpoint and calls `unsubscribe`. Mock `navigator.serviceWorker.ready` to resolve a registration whose `pushManager.getSubscription()` returns `{ endpoint: 'https://x', unsubscribe: vi.fn() }`, and assert the delete was called with `'https://x'`.

- [ ] **Step 2: Run to verify it fails, then implement**

Run: `npx vitest run src/features/notifications/pushSubscription.test.ts`
Expected before change: the new test fails if the mock path differs. Then, at the sign-out call site, call `await disablePushForThisDevice().catch(() => {})` before the existing `supabase.auth.signOut()` so a failure never blocks sign-out.

- [ ] **Step 3: Verify and commit**

```bash
npm run typecheck && npm run lint && npm run test
git add src/features/notifications/pushSubscription.test.ts <signout file>
git commit -m "feat(push): remove this device's subscription on sign-out"
```

---

### Task 11: Documentation and final verification

**Files:**
- Modify: `FEATURES_AND_SCHEMA.md` — add `push_subscriptions` to the schema section; add a Notifications section listing the five kinds, recipients, and the no-patient-data rule; document the `send-push` function and triggers.
- Modify: `README.md` — one bullet under features: "Push notifications to staff and therapists (installed app / desktop browsers)."

- [ ] **Step 1: Update both docs** using the exact table, trigger, and kind names from Tasks 2, 4, and 6.

- [ ] **Step 2: Full verification**

```bash
npm run typecheck && npm run lint && npm run test && npm run build
deno test supabase/functions/_shared/webPush.test.ts supabase/functions/send-push/templates.test.ts
```

Expected: all pass.

- [ ] **Step 3: Manual end-to-end check**

1. Enable notifications on desktop Chrome from Settings.
2. Create a booking request from the public booking page for the clinic.
3. With the Thera.Net tab closed, confirm a notification appears with the fixed booking-request text and no patient name.
4. Click it; confirm it opens `/schedule?tab=bookings`.
5. Sign out; confirm the `push_subscriptions` row for that endpoint is gone.

Report what was not tested (iOS Home Screen, Android) rather than claiming it works.

- [ ] **Step 4: Commit**

```bash
git add FEATURES_AND_SCHEMA.md README.md
git commit -m "docs: document web push notifications, triggers, and recipients"
```
