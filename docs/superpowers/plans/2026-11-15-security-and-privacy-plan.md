# TheraNet Security & Privacy Hardening Plan

> **Status (2026-11-19):** Tasks 1, 2, 3, 5 and 6 are built, pushed and deployed. Task 4 is built and pushed with the Content-Security-Policy in **report-only** mode (the other headers are enforced): switch it to enforcing (`Content-Security-Policy`) once a pass over the live site shows no `[Report Only]` console lines. Still open: Task 0 (dashboard checks: MFA, leaked-password protection, redirect URLs, Dependabot), Task 7 (idle-lock decision) and Task 8 (clinic checklist). Beyond the plan: the policy also allows the R2 picture host, and `public/hep-preview.html` is excluded from the headers. Known leftovers: no per-user rate limit on `brevo-mailer`; `clinicId` in feedback emails is not verified; 7 dev-only audit findings (vitest) need a breaking upgrade. Details: FEATURES_AND_SCHEMA.md, "Security hardening".

> **For agentic workers:** Execute tasks in priority order. Verify live Supabase configuration (Task 0) before deploying Task 1, because changing `hookAllowed()` to fail closed without `EDGE_HOOK_SECRET` configured in production will drop push notifications and scheduled/trigger emails.

**Goal:** Eliminate externally exploitable Edge Function abuse, close browser/HTTP header gaps, patch production dependency CVEs, neutralize CSV and error-telemetry leakage, and establish clinic-level operational controls without breaking offline-first workflows.

**Current Baseline (Verified 2026-11-15):**
- **Strong today:** Postgres RLS clinic isolation (`is_clinic_member`, `is_clinic_admin`, `is_front_desk`), `SECURITY DEFINER` RPCs with `set search_path = public`, zero JSX/DOM `dangerouslySetInnerHTML`/`innerHTML`/`eval` sinks in production `src/`, voluntary & involuntary local PHI cleanup (`signOutSafely`, `clearLocalData`, `purgeAllButOutbox`), `hide_patient_names` push lock-screen privacy, 256-bit feedback tokens with IP rate-limiting, and admin checks on `invite-therapist`.
- **Gaps targeted below:** Unauthenticated `brevo-mailer`, fail-open `EDGE_HOOK_SECRET` check, zero security headers in `vercel.json`, 3 production dependency CVEs (`npm audit --omit=dev`), unauthenticated/wildcard CORS on Edge Functions, full-URL error telemetry, CSV formula injection, and plaintext offline storage on shared clinic devices.

---

## Task 0: Live Config Pre-Flight (Human / Ops Verification Before Code Changes)

Before modifying Edge Function auth, confirm live secrets in the Supabase Dashboard (`Edge Functions → Secrets` and `Database → Vault`):
1. Confirm `vault.decrypted_secrets` has a non-empty `edge_hook_secret` row (created per `supabase/migrations/20261022120000_edge_hook_secret.sql`).
2. Confirm Edge Function secret `EDGE_HOOK_SECRET` is set to that **exact** same high-entropy random string.
3. Confirm `BREVO_API_KEY` and `SUPPORT_EMAIL` are set in Edge Function secrets.
4. Enable **MFA / 2FA** on Supabase, Vercel, GitHub, Brevo, and your DNS/domain registrar.
5. In Supabase Dashboard → **Authentication**:
   - Enable leaked-password protection and enforce a strong minimum password length.
   - Verify **Redirect URLs** only list exact production/staging URLs and localhost dev (no broad wildcards).
6. In GitHub repository settings, enable **Dependabot alerts** and security updates.

---

## Task 1: Fail-Close `hookAllowed()` on Internal Edge Functions (DONE)

**Files:**
- Modify: `supabase/functions/_shared/hookAuth.ts`
- Modify: `supabase/functions/_shared/hookAuth.test.ts`

**Why:** `supabase/functions/notify-therapist`, `send-push`, and `send-agenda` all have `verify_jwt = false` in `supabase/config.toml` and rely solely on `hookAllowed()`. Currently `if (!expected) return true;` fails **open** if `EDGE_HOOK_SECRET` is ever unset or wiped during a secret rotation.

**Steps:**
1. After confirming Task 0 (`EDGE_HOOK_SECRET` is set in production), edit `supabase/functions/_shared/hookAuth.ts`:
   - Change `if (!expected) return true;` to `if (!expected) return false;`.
2. Update `supabase/functions/_shared/hookAuth.test.ts`:
   - Replace `'with no secret configured every call is accepted'` with `'with no secret configured every call is rejected'` asserting `hookAllowed(call(), '') === false` and `hookAllowed(call('anything'), '') === false` and `hookAllowed(call(), undefined) === false`.
3. Run Deno tests for `_shared`:
   ```bash
   deno test supabase/functions/_shared/hookAuth.test.ts
   ```
4. Redeploy `notify-therapist`, `send-push`, and `send-agenda`.

---

## Task 2: Authenticate `brevo-mailer` & Scrub Telemetry URLs (DONE)

**Files:**
- Modify: `supabase/functions/brevo-mailer/index.ts`
- Modify: `src/lib/errorReporting.ts`
- Modify / Add test: `src/lib/errorReporting.test.ts` (if present, or add targeted Vitest coverage)

**Why:**
- `brevo-mailer` currently has `verify_jwt = false` and **no auth check inside the handler**. Anyone on the internet can POST `{ type: 'feedback' | 'error', ... }` to spam `SUPPORT_EMAIL` and burn Brevo quota.
- `src/lib/errorReporting.ts` currently emails `location.href`, which can contain sensitive route parameters (`/f/<token>`, `/patients/<uuid>`) or query tokens.

**Steps:**
1. **Lock down `supabase/functions/brevo-mailer/index.ts`:**
   - Extract the Bearer JWT from `Authorization` (same pattern as `supabase/functions/invite-therapist/index.ts` and `send-whatsapp-template/index.ts`).
   - Verify the caller via `userClient.auth.getUser()`; return `401` if missing or invalid.
   - Ignore client-supplied identity spoofing for `feedback`: attach the verified `caller.id` / `caller.email` from `getUser()` instead of trusting arbitrary `userId`/`userName` strings blindly (or cross-check against `clinic_members`).
   - Add basic payload size limits (e.g., reject/truncate `message` / `stack` over ~8–16 KB) to stop oversized email payloads.
2. **Update `src/lib/errorReporting.ts`:**
   - Check `supabase.auth.getSession()` (or only invoke `brevo-mailer` when an active session exists). If no user is signed in (e.g., anonymous crash on `/book/:slug` or `/f/:token`), `console.error` locally instead of making a failing unauthenticated call.
   - Sanitize the reported URL before sending: replace UUIDs and `/f/<token>` segments (e.g., send `sanitizeUrl(location.pathname)` such as `/f/[token]`, `/patients/[id]` — strip query strings and hashes) so patient IDs or single-use feedback tokens never land in plaintext support emails.
3. **Verify:**
   - Test feedback submission while signed in (`HelpFeedbackDialog.tsx`).
   - Confirm an unauthenticated `curl -X POST` to `brevo-mailer` without a valid user JWT returns `401`.
   - Run `npm run check:fast`.

---

## Task 3: Restrict Edge Function CORS Origins (DONE)

**Files:**
- Modify: `supabase/functions/_shared/cors.ts`
- Check callers: `supabase/functions/brevo-mailer/index.ts`, `supabase/functions/invite-therapist/index.ts`, `supabase/functions/send-whatsapp-template/index.ts`, `supabase/functions/notify-therapist/index.ts`, `supabase/functions/send-push/index.ts`, `supabase/functions/send-agenda/index.ts`

**Why:** `supabase/functions/_shared/cors.ts` currently returns `'Access-Control-Allow-Origin': '*'`. Restricting browser-callable functions to your real app origin(s) prevents random third-party websites from making credentialed browser requests against your endpoints.

**Steps:**
1. Replace the static `corsHeaders` export or add a helper `corsHeadersFor(req: Request)` (keeping backwards-compatible headers where needed for `OPTIONS` / JSON responses):
   - Allowlist exact origins (configured via an `ALLOWED_ORIGINS` Supabase secret with safe fallback, e.g., production domain(s) + `http://localhost:5173` / `http://127.0.0.1:5173` for local dev).
   - Echo `Origin` only when it matches the allowlist, plus `'Vary': 'Origin'`.
2. Update Edge Functions that return CORS headers (`invite-therapist`, `brevo-mailer`, `send-whatsapp-template`, etc.) to pass `corsHeadersFor(req)`.
3. Verify preflight `OPTIONS` requests succeed from your Vercel origin and localhost, and omit permissive `Access-Control-Allow-Origin` for unknown origins.

---

## Task 4: Add HTTP Security Headers & Content Security Policy in `vercel.json` (DONE; CSP report-only)

**Files:**
- Create: `public/blank-recovery.js` (extracted from `index.html`)
- Modify: `index.html`
- Modify: `vercel.json`

**Why:** `vercel.json` currently sets zero security headers (`CSP`, `X-Frame-Options`, `X-Content-Type-Options`, `Referrer-Policy`). Also, `index.html` currently has a small inline `<script>` for service-worker blank-page recovery; moving that script to `public/blank-recovery.js` lets us enforce `script-src 'self'` in CSP **without** `'unsafe-inline'`.

**Steps:**
1. Move lines 24–47 of `index.html` (the blank-page SW recovery listener) into `public/blank-recovery.js` and reference `<script src="/blank-recovery.js"></script>` in `index.html` before `<script type="module" src="/src/main.tsx"></script>`.
2. Add a global `/(.*)` header rule block in `vercel.json` (preserving the existing `/sw.js` `Cache-Control` rule):
   - `X-Content-Type-Options`: `nosniff`
   - `X-Frame-Options`: `DENY`
   - `Referrer-Policy`: `strict-origin-when-cross-origin`
   - `Permissions-Policy`: `camera=(), microphone=(), geolocation=()` *(confirm no feature needs camera/mic/geo before restricting)*
   - `Strict-Transport-Security`: `max-age=31536000; includeSubDomains`
   - `Content-Security-Policy` (start with `Content-Security-Policy-Report-Only` for one deploy if you want zero risk of blocking a resource, then switch to enforcing `Content-Security-Policy`):
     - `default-src 'self'`
     - `script-src 'self'`
     - `style-src 'self' 'unsafe-inline' https://fonts.googleapis.com`
     - `font-src 'self' https://fonts.gstatic.com data:`
     - `img-src 'self' data: blob: https://*.supabase.co`
     - `connect-src 'self' https://*.supabase.co wss://*.supabase.co`
     - `worker-src 'self'`
     - `manifest-src 'self'`
     - `frame-ancestors 'none'`
     - `base-uri 'self'`
     - `form-action 'self'`
     - `object-src 'none'`
3. Verify in a Vercel preview deploy (or `vite preview` + header check) that:
   - App boots cleanly, Google Fonts load, Supabase auth + Realtime (`wss://`) sync works, PDF bill export (`jspdf`/`html2canvas` with `data:`/`blob:` images) works, and `sw.js` registers without CSP console errors.

---

## Task 5: Upgrade Vulnerable Production Dependencies (DONE)

**Files:**
- Modify: `package.json`, `package-lock.json`

**Why:** `npm audit --omit=dev` currently reports 3 vulnerabilities:
- `dompurify <=3.4.16` (Critical, via `jspdf@4.2.1`)
- `seroval <=1.6.7` (Critical, via `@tanstack/react-router@1.170.17`)
- `@xmldom/xmldom` (High, via `read-excel-file@9.2.0`)

**Steps:**
1. Inspect available non-breaking upgrades:
   ```bash
   npm audit --omit=dev
   npm outdated jspdf @tanstack/react-router read-excel-file
   ```
2. Update packages cleanly (`npm update jspdf @tanstack/react-router read-excel-file` or `npm audit fix`, reviewing any major bumps carefully per TheraNet dependencies policy).
3. Re-run:
   ```bash
   npm audit --omit=dev
   npm run build
   npx vitest run --maxWorkers=2
   ```
4. Confirm `npm audit --omit=dev` shows `0 vulnerabilities` (or document any upstream wait if a transitive maintainer hasn't released a patch yet).

---

## Task 6: Neutralize CSV / Excel Formula Injection Across All Exports (DONE)

**Files:**
- Create or update shared helper (e.g., `src/domain/csv.ts` or export helper in `src/domain/visitsCsv.ts`)
- Modify: `src/domain/visitsCsv.ts`
- Modify: `src/services/reportService.ts` (`toCsv`)
- Modify: `src/features/reports/attributionAuditView.ts` (`toAuditCsv`)
- Update tests: `src/domain/visitsCsv.test.ts` (if exists) / `src/services/reportService.test.ts` / `src/features/reports/attributionAuditView.test.ts`

**Why:** All three CSV exporters escape quotes/commas, but none guard leading `=`, `+`, `-`, `@`, `\t`, or `\r`. When an admin exports clinic data and opens it in Excel or Google Sheets, strings like `=HYPERLINK(...)` or `=CMD|...` can execute formulas.

**Important implementation detail:** Do **not** corrupt legitimate negative numbers! If a cell is passed as a JavaScript `number` (`typeof cell === 'number'`, e.g., negative credit/adjustment numbers in `toCsv` or `toAuditCsv`), leave numbers untouched; only prefix `string` values whose trimmed/raw content starts with `=`, `+`, `-`, `@`, `\t`, or `\r` with a leading apostrophe (`'`).

**Steps:**
1. Create a shared `csvCell(value: unknown): string` helper:
   - Convert null/undefined to `''`.
   - If `typeof value === 'string'` and `/^[=+\-@\t\r]/.test(value)`, prefix with `'`.
   - Quote and double-escape `"` consistently (`"${s.replaceAll('"', '""')}"` — check existing `attributionAuditView.test.ts` and `reportService.test.ts` expectations so quoting behavior remains test-compatible).
2. Wire `visitsCsv.ts`, `reportService.ts`, and `attributionAuditView.ts` to use the shared helper.
3. Add unit tests verifying `=1+1`, `+cmd`, `-foo`, `@SUM`, and `\t=1+1` are neutralized, while numeric `-125.5` stays numeric and existing CSV header/quoting tests still pass.
4. Run `npm run check:fast`.

---

## Task 7: Storage Rules & Shared-Device Offline PHI Hygiene (Design + Policy)

**Files / Areas:**
- Check/enforce in future storage migrations (`supabase/migrations/`)
- Product / UX consideration: optional clinic-device idle lock (`src/app/Shell.tsx`)

**Actions:**
1. **Strict `clinic-assets` bucket policy:**
   - Keep `clinic-assets` (`public = true`) strictly for clinic logos, partner logos, therapist profile photos, and digital signatures.
   - **Rule for any future clinical/patient uploads** (e.g., patient documents, scans, bespoke HEP media): create a **private** bucket (`public = false`) protected by clinic-scoped `storage.objects` RLS + short-lived signed URLs (`createSignedUrl`), never `clinic-assets`.
2. **Evaluate an optional "Shared Device Idle Lock":**
   - Decide with clinic owners whether front-desk PCs/tablets need a lightweight in-app screen lock (e.g., lock after 15 minutes of inactivity, requiring quick password/re-auth to view patient screens while keeping `outbox` safe). Even without an in-app lock, enforce Task 8 below at every clinic.
3. **Future public booking spam guard:**
   - Keep `/book/:slug` frictionless for real patients now, and monitor `appointment_requests` for bot spam. If spam appears, add a lightweight honeypot field or Cloudflare Turnstile check before weakening UX.

---

## Task 8: Clinic Operations, Malware & Hacker Hygiene Checklist

Most real-world clinic data leaks happen on the endpoint rather than via clever cloud exploits:
- **OS auto-lock & separate accounts:** Set every clinic PC/tablet to auto-lock after 2–5 minutes of inactivity. Use separate OS user accounts for front desk vs. personal browsing.
- **Browser extension discipline:** Malicious or compromised Chrome/Edge extensions can directly read `localStorage` (Supabase auth session) and `IndexedDB` (`ClinicDB` offline patients). Allow **no** unapproved browser extensions on clinic computers, and keep Chrome/OS updates turned on.
- **No pirated/cracked software on clinic PCs:** Infostealer malware targets saved browser sessions and cookies; keep clinic machines strictly for clinic work.
- **Same-day offboarding:** When a therapist or receptionist leaves, remove their row from `clinic_members` (and disable/delete their auth user if appropriate) immediately. Server sync stops on removal; if they used a clinic-owned device, explicitly sign out to trigger `clearLocalData()`.

---

## Recommended Execution Order

1. **Today (Ops + Quick Wins):** Task 0 (verify `EDGE_HOOK_SECRET` & MFA) → Task 1 (`hookAllowed` fail-closed) → Task 2 (`brevo-mailer` auth + URL scrubbing).
2. **Next PR (Browser & Package Hardening):** Task 5 (`npm audit` upgrades) → Task 4 (`vercel.json` headers + `public/blank-recovery.js`) → Task 3 (CORS allowlist).
3. **Follow-up Cleanup:** Task 6 (CSV formula escaping) + Task 8 clinic checklist shared with clinic admins + UX decision on Task 7 idle lock.
