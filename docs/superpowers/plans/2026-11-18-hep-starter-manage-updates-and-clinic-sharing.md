> **Superseded by `2026-11-18-theranet-library-curation.md`** (sharing and update badges are deferred to the Public Exercise Library).

# HEP Starter Manage Mode, Starter Updates (Step 2) & Clinic-to-Clinic Sharing (Step 3)

**Goal:**
1. Add a **Manage** toggle inside the **Starter library** modal (`StarterSetSheet.tsx`) so curator clinics (`clinics.starter_curator = true`) can edit, add, and remove Starter exercises directly in one place (including editing/hiding the 28 built-in defaults).
2. **Step 2 — Starter "Update available" sync:** Track which Starter exercise an imported clinic exercise came from, surface a non-destructive **Update available** badge when a curator updates it, and let the clinic apply the update on demand.
3. **Step 3 — Clinic-to-clinic exercise sharing:** Let any clinic bundle selected exercises into a share link (**Draft** or **Publish immediately**, **30-day default expiry**) that another signed-in TheraNet clinic can preview and **copy** into its own independent Library.

**Guardrails (per `THERA_NET.md`):**
- Never edit already-live migrations; create new timestamped migrations later than `20261118120000_hep_pin_options.sql`.
- Maintain strict R2 prefix isolation (`clinics/{clinicId}/...`, `starter/exercises/{id}/...`, `shares/{shareId}/...`).
- Every `<button>` requires an explicit `type` (prefer `<Button>` from `src/components/Button.tsx`), all colours use CSS custom properties (`var(--...)`), and `FEATURES_AND_SCHEMA.md` must be updated in the same change.

---

## Part 1 — Starter Library Manage Toggle & Starter Exercise Management

### Why this is needed
Currently, Starter curation only appears at the bottom of `ExerciseForm.tsx` when editing an existing clinic exercise. Opening **Starter library** (`StarterSetSheet.tsx`) shows only the import checklist (and the 28 static `STARTER_EXERCISES` defaults are not rows in `starter_exercises` until published, so curators cannot edit or remove them directly from the Starter library view).

### 1.1 Database / RPC changes (new migration `20261118130000_hep_starter_manage.sql`)
- Add optional `starter_key text unique` to `public.starter_exercises` (nullable) so each of the 28 built-in `STARTER_EXERCISES` can map 1-to-1 to a DB row when edited or hidden (`active = false`), preventing a removed built-in default from reappearing via the static fallback.
- Update `starterLibraryService.listStarterItems()` to also fetch `starter_key` and `active`:
  - Any `STARTER_EXERCISES` item whose `starter_key` (or lowercased title) exists in `starter_exercises` with `active = false` is **hidden** from the import list (so curators can actually remove built-in defaults too).
  - Active `starter_exercises` rows override matching built-in items by `starter_key` or case-insensitive title.
- Update `publish_starter_exercise` (or add `save_starter_exercise` for direct Starter editing without requiring a source clinic exercise):
  - Guarded by `public.is_starter_curator(p_clinic_id)`.
  - Allows curators to create or update a `starter_exercises` row directly (including setting `starter_key` when promoting/editing one of the 28 built-in defaults).
- Add `unpublish_starter_exercise` support for hiding a built-in default by `starter_key` (inserts/updates an `active = false` tombstone row if no DB row existed yet).

### 1.2 Sync note for `clinics.starter_curator`
- When SQL sets `clinics.starter_curator = true` on a clinic, ensure `updated_at = now()` is bumped so existing browsers' incremental Dexie sync (`src/sync/engine.ts`) pulls `starterCurator: true` automatically on next sync.

### 1.3 UI changes (`StarterSetSheet.tsx` + `StarterExerciseForm.tsx` / `ExerciseForm.tsx`)
- **Header toggle in `StarterSetSheet.tsx`:**
  - When `isStarterCuratorClinic(clinic)` is true, show a **Manage** toggle button/pill in the `SheetDialog` header (`headerAction` or top bar).
- **Manage mode inside `StarterSetSheet.tsx`:**
  - Shows all active Starter exercises (both DB-backed and unpromoted built-in defaults) plus a **+ Add to Starter** button (lets curator pick from their clinic Library or create a new Starter exercise).
  - Each row in Manage mode shows:
    - Badge if **Built-in default** vs **Published** (with date).
    - **Edit** button -> opens an editor prefilled with the Starter item's title, region, types, positions, equipment, instructions, precautions, default dose, and photos/GIF (saves straight to `starter_exercises` + `starter/exercises/{id}/...` via `hep-media`).
    - **Remove** button -> confirmation dialog -> calls `unpublish_starter_exercise` (hides it from Starter library for all clinics; existing clinic copies are untouched).

---

## Part 2 (Step 2) — Starter Library "Update available" Sync

### Goal
When a curator updates a Starter exercise (new photos, improved instructions, updated dose), clinics that previously imported it see an **Update available** indicator and can choose to pull the update—never overwriting local clinic customizations silently.

### 2.1 Database changes (`20261118140000_hep_starter_updates.sql`)
- Add two nullable columns to `public.exercises`:
  - `source_starter_id uuid references public.starter_exercises(id) on delete set null`
  - `source_starter_published_at timestamptz`
- Update `save_exercise` RPC (backward-compatible default `null` params `p_source_starter_id uuid default null, p_source_starter_published_at timestamptz default null`) so:
  - Importing from `StarterSetSheet.tsx` records `source_starter_id` and `source_starter_published_at = starter.publishedAt`.
  - Normal edits preserve `source_starter_id` unless applying a Starter update.
  - Applying a Starter update sets `source_starter_published_at = starter.publishedAt`.
- Update `src/domain/hep.ts`, `src/repositories/rowMapping.ts`, and `src/features/hep/exerciseSaveInput.ts` so `sourceStarterId` and `sourceStarterPublishedAt` round-trip safely (tolerating missing columns until migration is applied).

### 2.2 Update detection & UI
- In `LibraryTab.tsx` / `LibraryBrowser.tsx` and `ExerciseForm.tsx`:
  - Fetch active `starter_exercises` metadata once when online (`starterLibraryService.listStarterItems()`).
  - An exercise has an update available when `exercise.sourceStarterId` matches an active `StarterLibraryItem` whose `publishedAt` is newer than `exercise.sourceStarterPublishedAt`.
  - Show a subtle **"Update available"** badge on the Library card/row and an **"Update available from Starter library"** banner inside `ExerciseForm.tsx` with:
    - **Apply Starter update** (clones updated R2 media via `hep-media` `clone_from_starter` into the clinic's own prefix, updates text/dosage, and saves with the new `sourceStarterPublishedAt`).
    - **Dismiss / keep mine** (updates `sourceStarterPublishedAt` to the current `publishedAt` without changing the exercise content).

---

## Part 3 (Step 3) — Clinic-to-Clinic Exercise Sharing

### Decisions already confirmed
- **Clinic-to-clinic only** (no unauthenticated public library).
- **Draft vs Publish immediately** supported when creating a share.
- **Default expiry: 30 days** (configurable, e.g. 7 / 30 / 90 days, and revocable anytime).
- **Receiving clinic can copy** selected exercises into its own independent clinic Library.

### 3.1 Database & R2 Isolation (`20261118150000_hep_clinic_shares.sql`)
- **`public.exercise_shares`:**
  - `id uuid primary key default gen_random_uuid()`
  - `source_clinic_id uuid not null references public.clinics(id) on delete cascade`
  - `created_by uuid references auth.users(id)`
  - `token text not null unique` (URL-safe random token)
  - `title text not null`
  - `note text`
  - `status text not null default 'draft' check (status in ('draft','published','revoked'))`
  - `expires_at timestamptz not null default (now() + interval '30 days')`
  - `created_at timestamptz not null default now()`
  - `updated_at timestamptz not null default now()`
- **`public.exercise_share_items`:**
  - `id uuid primary key default gen_random_uuid()`
  - `share_id uuid not null references public.exercise_shares(id) on delete cascade`
  - `source_exercise_id uuid`
  - Snapshot columns matching `starter_exercises` (`title`, `other_names`, `body_region`, `also_regions`, `phase`, `also_phases`, `positions`, `equipment`, `instructions`, `stop_if`, `media_type`, `media_keys`, `media_captions`, `thumb_key`, `default_sets`, `dose_type`, `default_reps`, `default_hold_seconds`, `default_duration_seconds`, `default_rest_seconds`, `default_sessions_per_day`, `side`, `sort_order`).
- **R2 isolation (`shares/{shareId}/...`):**
  - Sending clinic's `mediaKeys` are cloned into `shares/{shareId}/{idx}-{rand}` (not `clinics/{sourceClinicId}/...`), so receiving clinics never get signed URLs to the sender's private clinic bucket prefix, and edits/deletes in either clinic never break the share or each other's exercises.
  - Exercises with `hidePicturesInLists = true` are blocked from media cloning (or stripped to text-only with an explicit warning).
- **RPCs (`security definer`, `authenticated` only — never `anon`):**
  - `create_exercise_share(p_clinic_id, p_title, p_note, p_items_json, p_publish_now, p_expires_days default 30)` — guarded by `is_hep_staff(p_clinic_id)`.
  - `update_exercise_share_status(p_clinic_id, p_share_id, p_status, p_expires_days default null)` — lets sender publish a draft, extend expiry, or revoke.
  - `list_clinic_exercise_shares(p_clinic_id)` — lists drafts, published, and expired/revoked shares for the sending clinic.
  - `get_exercise_share_by_token(p_token)` — any signed-in TheraNet staff member (`auth.uid() is not null`) can read a share **only when** `status = 'published'` and `expires_at > now()`.

### 3.2 `hep-media` Edge Function Actions (`supabase/functions/_shared/hepMediaHandler.ts`)
- `clone_to_share`: sender (`is_hep_staff(sourceClinicId)`) clones `clinics/{sourceClinicId}/exercises/...` -> `shares/{shareId}/...`.
- `mint_share_view_urls`: authenticated user with a valid `published` + non-expired share `token` gets short-lived read URLs for `shares/{shareId}/...`.
- `clone_from_share`: receiving staff (`is_hep_staff(receivingClinicId)`) clones `shares/{shareId}/...` -> `clinics/{receivingClinicId}/exercises/{newId}/...`.

### 3.3 UI Flow
- **Sending (`LibrarySelectionBar.tsx` + `ShareExercisesDialog.tsx` + `LibraryTab.tsx`):**
  - In Library Select mode (`LibrarySelectionBar.tsx`), add **Share with clinic** beside Print PDF / Sheet.
  - `ShareExercisesDialog.tsx`:
    - Enter share title, optional note, and expiry (default **30 days**).
    - Choose **Save as Draft** (creates `draft` share; no link active yet) or **Publish immediately** (creates `published` share and displays copyable link `/hep/share/{token}`).
  - Add a **Shared links** drawer/tab button in Library so staff can see existing Drafts / Published links, publish a Draft, copy the link, or Revoke.
- **Receiving (`SharedExercisesPage.tsx` + `src/app/router.tsx` + `OnboardingRoute.tsx`):**
  - Authenticated route `/hep/share/$token`:
    - **Not-logged-in / new clinic flow (Option B — login wall before viewing photos):** Unauthenticated visitors see a clean TheraNet invite/share card (*"Sign in or create a free clinic account to view and copy these shared exercises"*) with **Sign in** and **Create clinic** actions that preserve `?next=/hep/share/$token` through auth and `/onboarding`, automatically returning the user to `/hep/share/$token` once clinic setup finishes.
    - **Prerequisite note:** Before inviting outside clinics to try HEP via share links, either open `hepAvailableForClinic` (`src/domain/hep.ts`) to all clinics (with Free/Lite caps: 10 exercises, 5 active programs) or unlock HEP for invited clinics.
  - Once signed in with an active clinic, shows sender clinic name, share note, expiry date, and exercise cards with signed preview photos, instructions, and default dosage.
  - Checkboxes + **"Copy selected to my Library"** button -> clones R2 media via `clone_from_share` and saves independent `exercises` rows into the active clinic (using `saveExercise` + local Dexie cache).

---

## Verification Plan
- **Unit & Migration Contract Tests (run sequentially, one vitest file at a time):**
  - Migration SQL contract tests for `20261118130000`, `20261118140000`, and `20261118150000`.
  - `StarterSetSheet` Manage mode tests (curator vs non-curator visibility, edit/remove actions, hiding built-in defaults).
  - `starterLibraryService` update-detection & merge tests.
  - `hepMediaHandler` tests for `clone_to_share`, `mint_share_view_urls`, `clone_from_share` (including auth, expiry, and prefix guards).
  - `ShareExercisesDialog` & `SharedExercisesPage` component tests.
- **Build Checks:**
  - `npm run typecheck && npm run lint && npm run build`
- **Docs Check:**
  - Update `FEATURES_AND_SCHEMA.md` and verify `git diff --stat FEATURES_AND_SCHEMA.md`.
