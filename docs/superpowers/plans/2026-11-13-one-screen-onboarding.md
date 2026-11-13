# Short Onboarding (Practice + Services) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A new clinic goes from sign-up to a usable Workspace through two short screens on one page: **Your practice** (practice name, your name, "I treat patients myself", where you see patients) and **Your services** (at least one service priced above 0), then one tap. Everything else is asked later, when it is needed.

**Architecture:** `create_clinic_with_admin` gains optional parameters (code, time zone, country code, care locations, complete-onboarding) and marks onboarding complete in the same transaction, so Shell never blocks. Nothing is created until the final **Start** tap (both screens are client state only), so there is never a clinic without services. The client then writes the owner's therapist row and the priced services through the normal local-first repos (Dexie first, outbox after), so they are on the device at once and the first New Visit works offline-fast. The old `/onboarding` wizard stays only for clinics created before this change that never finished it.

**Tech Stack:** React 18 + TypeScript, Tailwind v4, Dexie (offline-first) + Supabase (RPC + outbox sync), Vitest + jsdom, TanStack Router.

**Spec:** Agreed in conversation on 2026-11-12/13 (no separate spec file). The decisions are restated in "Decisions" below and are binding.

## Decisions (binding)

1. Screen 1 **Your practice**: **Practice or clinic name** (required, blank, placeholder "e.g. Apex Physio"), the derived code line "Bills and patient IDs start with {CODE} · Edit", **Your name** (required, pre-filled from the account's `full_name`/`name` metadata), checkbox **I treat patients myself** (ticked), **Where do you see patients?** with **At the clinic** (ticked) and **Home visits** (unticked). Button **Next: your services**. No address, phone, email, logo or team.
1b. Screen 2 **Your services** (same route, client state; **Back** returns to screen 1 with everything kept): the existing `ServiceCatalogTemplateEditor` showing `STARTER_CATALOG_TEMPLATE` with **prices blank** (no example amounts), the dashed "+ Add a service" row, and the hint "Price at least one service to start logging visits. Unpriced ones aren't added; you can add more in Settings." Button **Start using Thera.Net** is disabled until at least one included row has a price **above 0** (₹0 does not count; the old "We don't charge patients" shortcut is not offered here). Duplicate-name check as today. Only rows with a price above 0 are saved.
2. The clinic code is `clinicCode(name)` until the user edits it; edits go through `cleanClinicCode` and must be 2–6 characters. If the signed-in user already has another clinic with the same code, show "Your other clinic {name} also uses {CODE}." (warning only, never blocks).
3. Time zone comes from the browser; `UTC`, `Etc/*` or an unknown zone sends `null` and the database default applies. Country code comes only from a small sure table keyed by time zone; anything else sends `null`. Currency and tax regime are **not** set (they are stored-only today).
4. Services saved = the rows from screen 2 that are included and priced above 0 (owner decision 2026-11-13, replaces the earlier ₹0 seeding).
5. "Price your services" is done only when an active service has a price above 0, or the clinic chose "We don't charge patients" (the existing manual tick on the `price-services` step).
6. No therapist (box unticked): setup gets an "Add your first therapist" essential step before prices; Workspace shows "Add a therapist to start logging visits" with a button to Settings → Team.
7. **Dropped** (2026-11-13: services are priced in onboarding, so there are no ₹0 starter services). Original text kept for reference: New Visit: when a chosen single-visit service has price 0 and the clinic hasn't chosen "We don't charge", show an inline notice with a price box (empty, no example amount). Admins get **Save price** (updates the catalog item; the row's price follows). Everyone gets **This visit is free** (hides the notice for this visit). Non-admins also see "Ask an admin to set the price." **Packages are included**: a new package purchase at ₹0 shows it too (the price typed is the whole package's price, e.g. "Physiotherapy Package · 5 sessions"). Only package **continuation** rows (`row.continuation`, a session of a package already paid for) never show it. (Review 2026-11-13: `isPackageRow` is true for any multi-session item, so using it would hide the notice for the unpriced starter package and let it save at ₹0.)
8. No "Set your prices" card (dropped with 7). The install-app banner shows only after the first visit is saved. New Visit's code is preloaded while Workspace is idle.
9a. Setup checklist gets an **optional** step "Set a password" shown only when the signed-in user has no password identity (`hasPasswordIdentity` from `src/domain/onboarding.ts`), linking to My account (which already offers "Set a password"). Never blocks.
9b. A ₹0 visit that is not a package continuation shows no **Give bill** on the post-save card (`VisitLoggedCard`): there is nothing to bill.
9c. Schedule with no active therapist shows "No therapists yet" with a button to Settings → Team instead of an empty grid.
9. Setup bar: a **Hide** button appears once a visit has been logged; hiding writes the existing `setupDismissedKey` flag. `/setup` stays reachable from the account menu.
10. One-login plans (Lite, Solo: `maxMembers <= 1`): Settings → Team shows a locked row "Invite a colleague with their own login · Available on Clinic and Clinic+" with the existing upgrade link (`upgradeMailto`); "Add a colleague without a login" stays as today.
11. Out of scope (later, separate): Google-first sign-in and email codes; deleting the old wizard; currency/tax auto-detect.

## Global Constraints

- Money: `formatAmount(paise)` and `currencySymbol()` from `@/domain/money`; never type `₹` in `src/` (ESLint error) and never call `formatINR`.
- Time: never write `Asia/Kolkata` or `+91` in new client code; use `clinicTimezone`, `canonicalTimezone`, the database defaults.
- Every `<button>` has an explicit `type`; prefer `<Button type="button">` from `src/components/Button.tsx`.
- Schema change = migration file in `supabase/migrations/` **and** the user applies it live; executors never touch the live database. Claude then inserts the `supabase_migrations.schema_migrations` row with the file's version and name.
- Update `FEATURES_AND_SCHEMA.md` (every duplicated copy of a section) in the same task as the behavior change.
- Stage explicit paths only (`git add <paths>`), never `-A`; never stage `docs/superpowers/plans/2026-11-09-hep-module.md` or `public/hep-preview.html`. Never push.
- Per task: `npm run check:fast`. At the end: `npm run typecheck`, `npm run lint`, `npm run test`, `npm run build`.

## Review Focus

1. Deployed old clients still call `create_clinic_with_admin` with the old five named arguments: it must keep working (new parameters all have defaults; the old overload is dropped so PostgREST never sees two). → Task 1 SQL check.
2. A second clinic added from the header (`AddClinicDialog`, `variant="dialog"`) goes through the same form and must not navigate the page away or leave the old wizard showing. → Task 3 test.
3. The tab closes in the instant between the RPC and the local writes: the clinic exists with no therapist and no services. Setup must then show "Add your first therapist" and "Price your services" with an empty list, not crash. → Task 4 test.
4. Services screen: a 0 typed in a row must not count as priced; a priced row that is then unticked must not count; a 5-session package priced alone is enough to start. → Task 2 and Task 3 tests.
5. A browser reporting `UTC` (VPNs, misconfigured phones) must not set the clinic to UTC. → Task 2 test.

---

### Task 1: `create_clinic_with_admin` v2 (migration)

**Files:**
- Create: `supabase/migrations/20261113100000_one_screen_onboarding_rpc.sql`
- Modify: `FEATURES_AND_SCHEMA.md` (the clinic onboarding wizard section and every `onboarding_completed_at` schema line)

**Interfaces:**
- Produces: RPC `create_clinic_with_admin(p_name text, p_email text default null, p_phone text default null, p_address text default null, p_invoice_prefix text default 'INV', p_walk_in_mrno_prefix text default null, p_timezone text default null, p_default_country_code text default null, p_care_locations text[] default null, p_complete_onboarding boolean default false) returns clinics`.

- [ ] **Step 1: Write the migration.** Start from the body in `20261002200458_rename_bm_hv_to_clinic_partner.sql` (no-return reasons, referring sources, treatments seeds unchanged). `drop function if exists public.create_clinic_with_admin(text, text, text, text, text);` then create the new signature above. Rules inside:
  - `p_timezone` used only when `exists (select 1 from pg_timezone_names where name = p_timezone)`; otherwise the column default.
  - `p_default_country_code` used only when it matches `^\+[0-9]{1,4}$`; otherwise the column default.
  - `p_care_locations` used only when non-empty and `<@ array['clinic','home','ward']`; otherwise the column default.
  - `walk_in_mrno_prefix = nullif(p_walk_in_mrno_prefix, '')` when given.
  - `onboarding_completed_at = case when p_complete_onboarding then now() end`.
  - Re-grant `execute` to `authenticated` exactly as the previous migration did (copy its grant lines; if it had none, add `grant execute on function public.create_clinic_with_admin(text,text,text,text,text,text,text,text,text[],boolean) to authenticated;`).
- [ ] **Step 2: Write the check script** at the bottom of the migration as a comment block (Claude runs it live after the user applies, inside `begin; … rollback;`): call with five named args (old client) → returns a row with `onboarding_completed_at is null`; call with all args incl. `p_timezone => 'Mars/Base'` → default zone kept; `p_default_country_code => '91'` → default kept; `p_care_locations => '{}'` → default kept; `p_complete_onboarding => true` → timestamp set.
- [ ] **Step 3: Update `FEATURES_AND_SCHEMA.md`**: new RPC parameters, and that new clinics are marked complete at creation.
- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/20261113100000_one_screen_onboarding_rpc.sql FEATURES_AND_SCHEMA.md
git commit -m "feat(onboarding): create_clinic_with_admin takes code, region, care locations and completes onboarding"
```

### Task 2: Domain helpers

**Files:**
- Modify: `src/domain/clinicRegion.ts`, `src/domain/clinicCode.ts`, `src/domain/onboardingCatalogTemplates.ts`
- Test: `src/domain/clinicRegion.test.ts`, `src/domain/clinicCode.test.ts`, `src/domain/onboardingCatalogTemplates.test.ts` (create any that don't exist)

**Interfaces:**
- Produces:
  - `browserTimezone(): string | null` — `Intl.DateTimeFormat().resolvedOptions().timeZone` through `canonicalTimezone`; `null` for `UTC`, `GMT`, `Etc/*`, empty or throwing.
  - `countryCodeForTimezone(tz: string | null): string | null` — table: `Asia/Kolkata → '+91'`, `Asia/Dubai → '+971'`, `Asia/Singapore → '+65'`, `Asia/Kathmandu → '+977'`, `Asia/Colombo → '+94'`, `Asia/Dhaka → '+880'`, `Europe/London → '+44'`, `Australia/Sydney → '+61'`, `Australia/Melbourne → '+61'`; anything else `null`.
  - `isValidClinicCode(code: string): boolean` — `cleanClinicCode(code) === code && code.length >= 2 && code.length <= CLINIC_CODE_MAX`.
  - `createBlankStarterCatalogDrafts(): CatalogTemplateDraft[]` — `createStarterCatalogDrafts()` with every `basePricePaise` set to `null` (blank box).
  - `hasPositivePricedDraft(drafts: CatalogTemplateDraft[]): boolean` — true when an `enabled` draft has `basePricePaise > 0`.
  - `catalogItemsFromDrafts(clinicId: UUID, drafts: CatalogTemplateDraft[], now: string): CatalogItem[]` — one item per `enabled` draft with `basePricePaise > 0`, `id: d.key`, `category: d.group.trim()`, `name: d.name.trim()`, `sessionCount: Math.max(1, d.sessionCount)`, `active: true`, `updatedAt: now` (same mapping as `OnboardingPage.finishOnboarding`).

- [ ] **Step 1: Write failing tests**: `browserTimezone` returns `null` when `Intl` reports `'UTC'` and `'Etc/GMT+5'`, and `'Asia/Kolkata'` when it reports `'Asia/Calcutta'` (mock `Intl.DateTimeFormat`); `countryCodeForTimezone('Asia/Dubai') === '+971'`, `('America/New_York') === null`, `(null) === null`; `isValidClinicCode('DP')` true, `('D')` false, `('dp')` false, `('ABCDEFG')` false, `('A-B')` false; `createBlankStarterCatalogDrafts()` has the template's length and every price `null`; `hasPositivePricedDraft` is false for all-blank, false when the only price is 0, false when the only priced row is disabled, true for one enabled row at 80000; `catalogItemsFromDrafts` drops blank, 0 and disabled rows and keeps a 5-session package at 350000.
- [ ] **Step 2: Run** `npx vitest run src/domain/clinicRegion.test.ts src/domain/clinicCode.test.ts src/domain/onboardingCatalogTemplates.test.ts` → FAIL.
- [ ] **Step 3: Implement** the four functions with the signatures above.
- [ ] **Step 4: Run** the same command → PASS.
- [ ] **Step 5: Commit** `feat(onboarding): helpers for browser time zone, country code, clinic code and onboarding services` (stage the six files).

### Task 3: The two-screen form (Your practice → Your services)

**Files:**
- Modify (rewrite the fields and submit): `src/features/settings/CreateClinicForm.tsx` (keep the file name and export so `Shell.tsx` and `AddClinicDialog.tsx` don't change)
- Modify: `src/features/onboarding/ServiceCatalogTemplateEditor.tsx` only if it can't show blank prices or the new hint as it is (prefer passing props)
- Test: `src/features/settings/CreateClinicForm.test.tsx` (create or replace)

**Interfaces:**
- Consumes: Task 1 RPC; Task 2 `browserTimezone`, `countryCodeForTimezone`, `isValidClinicCode`, `createBlankStarterCatalogDrafts`, `hasPositivePricedDraft`, `catalogItemsFromDrafts`, `firstDuplicateName` (as used in `OnboardingPage`), `clinicCode`, `cleanClinicCode`.
- Produces: unchanged props `{ onSuccess: () => void; variant?: 'page' | 'dialog' }`.

- [ ] **Step 1: Write failing tests** (mock `getSupabase`, `repos`, `catalogService`, `setActiveClinic`, router `useNavigate`):
  - `screen 1 renders only the four fields and Next` — queries by label: "Practice or clinic name", "Your name", "I treat patients myself" (checked), "At the clinic" (checked), "Home visits" (not checked); no "Address"/"Phone"/"Email" labels.
  - `shows the derived code line` — typing "Apex Physio" shows "Bills and patient IDs start with AP".
  - `blocks Next with a one-letter code` — Edit → type "A" → Next disabled and the hint "2 to 6 letters or numbers" shows.
  - `Next shows the services screen with blank prices` — every price box empty; Start disabled; hint "Price at least one service to start logging visits."
  - `Start stays disabled with only ₹0 prices` — type 0 in one row → still disabled.
  - `Back keeps screen 1 values` — Next → Back → practice name and ticks unchanged.
  - `nothing is created before Start` — Next alone → `rpc` not called.
  - `duplicate service names block Start` with the existing message.
  - `calls the RPC with the new parameters` — price one row 800 → Start → `rpc('create_clinic_with_admin', expect.objectContaining({ p_name: 'Apex Physio', p_invoice_prefix: 'AP', p_walk_in_mrno_prefix: 'AP', p_care_locations: ['clinic'], p_complete_onboarding: true }))`.
  - `writes the owner therapist and only the priced services locally` — `repos.therapists.put` called once with `userId` = session user, `name` = typed name, `profileConfirmedAt` set, `active: true`; `catalogService.addServices` called with exactly the rows priced above 0 (one item at 80000 when one row was priced).
  - `skips the therapist when unticked` — untick → submit → `repos.therapists.put` not called.
  - `page variant lands on /workspace` — `navigate({ to: '/workspace' })`.
  - `dialog variant does not navigate` — `variant="dialog"` → `onSuccess` called, `navigate` not called.
  - `Home visits ticked sends both locations` — `p_care_locations: ['clinic','home']`.
  - `unticking both locations blocks Next` — hint "Choose at least one place".
- [ ] **Step 2: Run** `npx vitest run src/features/settings/CreateClinicForm.test.tsx` → FAIL.
- [ ] **Step 3: Implement.** Keep the existing `getUser()` signed-in check and its message. Submit order: RPC → `repos.clinics.putLocal(clinic)` (map the returned row with `rowToDomain<Clinic>` instead of the hand-written object) → therapist `repos.therapists.put` (fields as in `OnboardingTeamStep.linkSelfToRoster`, color from `nextUnusedColor([])`) → `catalogService.addServices(catalogItemsFromDrafts(...))` → `setActiveClinic` → `void syncEngine.schedule(0)` → page: `navigate({ to: '/workspace' })`; dialog: `onSuccess()`. A failure after the RPC shows the error but still activates the clinic (the setup guide covers the missing pieces). Button text while busy: "Setting up your practice…". Same-owner duplicate code warning from `repos.clinics` list (Decision 2). Remove the logo upload and the bill preview from this form (they live in Settings → General). Screens are a local `step: 'practice' | 'services'` state; both screens' values live in this component until Start. On phones (360px) screen 2 scrolls and the Start button stays visible at the bottom (sticky footer as in the current Step 3).
- [ ] **Step 4: Run** the test file → PASS; `npm run check:fast` → PASS.
- [ ] **Step 5: Commit** `feat(onboarding): short clinic setup (practice, then services)` (stage the changed files).

### Task 4: Setup guide — real price check, no-therapist step, Hide

**Files:**
- Modify: `src/domain/setupGuide.ts`, `src/features/setup/useSetupProgress.ts`, `src/features/setup/SetupProgressBar.tsx`
- Test: `src/domain/setupGuide.test.ts`, `src/features/setup/SetupProgressBar.test.tsx` (create if missing)

**Interfaces:**
- Produces: `SetupSignals.servicesPriced` now means "an active item with `basePricePaise > 0`"; new `SetupSignals.hasTherapist: boolean` (any active therapist); new step id `'add-therapist'`; `SetupState.canHide: boolean` (true when `visitLogged`); `SetupState.hide(): Promise<void>` (writes `db.meta` `setupDismissedKey(clinicId)` = `'1'`).

- [ ] **Step 1: Write failing tests**:
  - `servicesPriced is false when every service is ₹0` and true when one is 50000.
  - `add-therapist is the first essential step when there is no therapist` and is absent (or done) when `hasTherapist`.
  - `nudge shows when there is no therapist` and `when no service is priced`.
  - `empty clinic does not crash` — no therapists, empty catalog → steps build, `next.id === 'add-therapist'`.
  - `set-password step shows only without a password identity`, is optional (never counts toward the essentials) and links to My account.
  - Bar: `Hide is not shown before the first visit`; `Hide shows after a visit and calls hide()`; after hide the bar renders nothing.
- [ ] **Step 2: Run** `npx vitest run src/domain/setupGuide.test.ts src/features/setup` → FAIL.
- [ ] **Step 3: Implement.** Step `'add-therapist'`: group `essentials`, title "Add your first therapist", why "Visits are credited to a therapist.", link Settings → Team (`teamView: 'members'`), action "Add therapist", `auto: s => s.hasTherapist`; insert before `'price-services'`. `isSetupNudgeVisible` also returns true for `!signals.servicesPriced` or `!signals.hasTherapist` (when not dismissed and not all done). The bar's Hide is a `<button type="button">` beside "Continue" (outside the `Link`: restructure the bar into a `div` holding the `Link` and the button).
- [ ] **Step 4: Run** → PASS; `npm run check:fast`.
- [ ] **Step 5: Commit** `feat(setup): price check needs a real price, add-therapist step, Hide after the first visit`.

### Task 5: (dropped 2026-11-13)

Services are priced during onboarding, so the ₹0 price notice is not built. Keep the task number so later references stay valid.

### Task 6: Workspace landing — no-therapist message, Give bill on ₹0, Schedule empty state, install banner timing, preload

**Files:**
- Create: `src/features/workspace/FirstRunCards.tsx`
- Modify: `src/features/visits/VisitLoggedCard.tsx` (hide Give bill when `justSaved.billPaise === 0` and the visit is not a package continuation), `src/features/schedule/ScheduleBookingsView.tsx` (empty state when there are no active therapists)
- Modify: `src/features/workspace/WorkspacePage.tsx` (render `FirstRunCards` at the top; gate `<InstallAppBanner />` at line ~941 on "a visit exists"; add the idle preload)
- Test: `src/features/workspace/FirstRunCards.test.tsx`

**Interfaces:**
- Consumes: Task 4 signals via `useSetupProgress(clinicId)` (`servicesPriced`, `hasTherapist`, `visitLogged` — expose them on `SetupState` if not already).
- Produces: `FirstRunCards({ clinicId, isAdmin }: { clinicId: UUID; isAdmin: boolean })` (only the no-therapist card for now).

- [ ] **Step 1: Write failing tests**:
  - `no therapist shows "Add a therapist to start logging visits"` with a button to Settings → Team.
  - `hidden once a therapist exists`; `non-admin does not see it`.
  - In `src/features/visits/VisitLoggedCard.test.tsx`: `no Give bill for a ₹0 visit` (billPaise 0, no continuation) and `Give bill still shows for a priced visit`.
  - In the Schedule tests (`src/features/schedule/ScheduleBookingsView` test file, or a new `NoTherapistsNotice.test.tsx`): `no active therapist shows No therapists yet with a link to Settings → Team`.
- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement.** Preload: in `WorkspacePage`, a `useEffect` that calls `requestIdleCallback` (fallback `setTimeout(…, 1500)`) to `import()` the same module the router lazily loads for `/visits/new` (copy the import path from `src/app/router.tsx`). Install banner renders only when `useSetupProgress(...)?.visitLogged` is true.
- [ ] **Step 4: Run** → PASS; `npm run check:fast`.
- [ ] **Step 5: Commit** `feat(workspace): no-therapist prompt, no Give bill on ₹0, Schedule empty state, install banner after the first visit, preload New Visit`.

### Task 7: Locked invite row on one-login plans

**Files:**
- Modify: `src/features/settings/TeamSection.tsx`
- Test: `src/features/settings/TeamSection.test.tsx` (extend; create if missing)

**Interfaces:**
- Consumes: `useEntitlements(clinicId)` (`enforcementEnabled`, `maxMembers`), `upgradeMailto` from `@/lib/support`, the plan label helper in `src/domain/plans.ts`.

- [ ] **Step 1: Write failing tests**:
  - `one-login plan shows the locked invite row` — text "Invite a colleague with their own login" and "Available on Clinic and Clinic+", with an upgrade link when `upgradeMailto` returns a URL and the text "Contact us to upgrade" when it returns `null`.
  - `one-login plan still offers Add a colleague without a login`.
  - `multi-login plan shows no locked row` (Clinic: `maxMembers: 5`).
- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement** the row above the member list when `enforcementEnabled && maxMembers <= 1`: a lock icon (the app's SVG icon set, no emoji), muted text, not a disabled form.
- [ ] **Step 4: Run** → PASS; `npm run check:fast`.
- [ ] **Step 5: Commit** `feat(team): show invites as locked with an upgrade link on one-login plans`.

### Task 8: Docs and full gates

**Files:**
- Modify: `FEATURES_AND_SCHEMA.md` (Clinic onboarding wizard section → "Clinic setup (one screen)"; Setup guide; New Visit pricing; Team on one-login plans; every duplicated copy), `README.md` onboarding line if it describes the wizard.

- [ ] **Step 1:** Rewrite the onboarding section: the one screen, what the RPC sets, local writes, the old wizard kept only for clinics created before 2026-11-13 that never finished it, and the "later" prompts (prices card, ₹0 notice, setup Hide, locked invites, install banner after the first visit).
- [ ] **Step 2:** Run in parallel: `npm run typecheck`, `npm run lint`, `npm run test`, then `npm run build`. Expected: all exit 0.
- [ ] **Step 3: Commit** `docs: one-screen onboarding` (stage the doc files only).
- [ ] **Step 4:** Report: commits, the migration path for the user to apply, and the tails of the four gate outputs. Do not push.
