# HEP Portal, Profile and Photo-Consent Refinements Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the approved refinements mockup: photo consent and a per-exercise "Hide pictures in lists" switch (replacing the automatic pelvic-floor hiding), a patient portal with Home and Exercises tabs (next visit, package, programs), a richer exercise page, a redesigned Home program tab, and a reorganised patient profile.

**Architecture:** Branch `feat/hep`, worktree `/home/theranet/TN Project/thera-net-1-hep`. One new migration adds consent/hide columns, extends `save_exercise`, adds a list-hiding flag to the public exercise payload and a new PIN-gated public RPC for the patient Home tab. The patient portal reuses its existing components (so the therapist preview keeps matching). Staff screens consume the new flag instead of `isSensitiveExercise`.

**Tech Stack:** React 18 + TypeScript, Tailwind v4, vitest + RTL, Supabase Postgres (security-definer RPCs, PIN/device verification via `hep_verify`).

**Spec:** `docs/superpowers/specs/2026-11-15-hep-refinements-mockup.html` (tabs: Patient portal, Home program tab, Patient profile, Exercise photos), plus the owner decisions below.

## Owner decisions (2026-11-15, binding)

1. Pictures: when uploaded, show them everywhere (pelvic floor included), with consent. Consent = the therapist ticks "I have consent from the person shown" when an exercise has pictures; recorded with who and when. No picture uploaded → show only the text (no placeholder tile). Pictures are hidden only when the therapist switches on "Hide pictures in lists" for that exercise (lists hide them; the exercise page still shows them).
2. Patient Home tab now, in full: greeting, today's program, this week, next clinic visit, package sessions left, other and earlier programs, Book a visit, Call the clinic.
3. Refine before merging: the merge waits until this plan is done.

## Global Constraints

- CLAUDE.md: explicit `type` on every `<button>`; money via `formatAmount`/`currencySymbol` (no ₹ typed); phone via `clinicCountryCode`/`splitPhone`; time via the clinic's zone; dates via the app's date helper (e.g. `formatDateDM`); docs updated in the same change (FEATURES_AND_SCHEMA.md); new India-only surfaces listed in section 0e (none expected).
- Schema change = new migration file + live apply **only after the owner says go** + `schema_migrations` row with the file's version and name. Never edit applied migrations (`20261113200000_hep_module.sql`, `20261113200100_hep_pain_push.sql`, `20261114100000_hep_exercises_audit_columns.sql`, `20261114200000_hep_exercise_positions.sql`). To push from the worktree, copy main's live migrations it lacks into the folder temporarily, push, delete them; never `migration repair --status reverted`.
- Public data: the patient page may only learn what the PIN/device-verified RPCs return. The Home RPC returns only this patient's own next appointment, open package progress and programs — never other patients, prices or staff-only notes.
- Machine is short on memory: tsc/vitest in the background to log + done file; read logs.
- Per task: focused vitest + `npx tsc --noEmit` + eslint on touched files before commit; final task runs `npm run typecheck && npm run lint && npm run test && npm run build`.
- Copy (patient screens stay plain): "Hi {first name}", "Here is where things stand.", "Today", "Start my exercises" / "Continue my exercises", "This week", "Next visit", "Your package", "{n} of {total} left", "Valid until {date}", "Other programs", "Earlier programs ({n})", "Book a visit", "Call clinic", "Sets · tap each one when done". Staff: "I have consent from the person shown to use these pictures with patients.", "Recorded with your name and the date.", "Tick consent to save these pictures, or remove them.", "Hide pictures in lists", "Library, picker and the patient's checklist show the name only. The pictures still show on the exercise page itself."

## Review Focus

1. Existing exercises that already have pictures but no consent: they keep showing (no data loss), the form asks for consent only when the therapist next saves that exercise with pictures, and the server refuses a save with pictures and neither existing nor new consent. Test in Tasks 1 and 3.
2. A patient with no appointment, no open package, or no other/earlier programs: the Home tab hides those cards, never shows empty shells or errors. Test in Task 2.
3. Remembered-device and wrong-PIN paths for the new Home RPC behave exactly like `get_public_hep` (same `hep_verify`, rate limits, lockout). Test in Task 1 (contract) and Task 2 (UI).
4. "Hide pictures in lists" must hide thumbnails in every list (Library grid/table, picker cards and packs, program/template rows, preview checklist, the patient's checklist) but keep pictures on the exercise page. Test in Tasks 3 and 2.
5. Patient profile reorganisation must keep every existing action reachable (call, WhatsApp, edit, new visit, admission actions, session notes, clinical notes, payments, care plan) for each role that has it today. Test in Task 5.

---

### Task 1: Migration — consent, hide flag, public payload, patient Home RPC

**Model:** Opus.

**Files:** Create `supabase/migrations/20261115100000_hep_photo_consent_and_portal_home.sql`, `src/domain/hepPortalMigration.test.ts`. Modify `src/services/hepService.ts` (save input + exercise row mapping), `src/services/publicHepService.ts` (`PublicHepItem.hidePicturesInLists`, new `getPublicHome`), `src/domain/hep.ts` (`Exercise.pictureConsentAt`, `pictureConsentBy`, `hidePicturesInLists`).

**Decided content:**
1. `exercises` adds `picture_consent_by uuid references auth.users(id)`, `picture_consent_at timestamptz`, `hide_pictures_in_lists boolean not null default false` (all `add column if not exists`).
2. Recreate `save_exercise` (drop the 25-arg signature from `20261114200000`, same body) with two more params: `p_picture_consent boolean default false`, `p_hide_pictures_in_lists boolean default false`. Rules: if the saved row will have media (`media_keys` non-empty) and it has no `picture_consent_at` and `p_picture_consent` is not true → `raise exception 'Consent is needed for these pictures.'`. When `p_picture_consent` is true and consent is not yet recorded (or media keys changed), set `picture_consent_by = auth.uid()`, `picture_consent_at = now()`. Always write `hide_pictures_in_lists`. Exception: rows saved with `p_deleted = true` or `p_active = false` (archive/delete) skip the consent check. Grants as before (authenticated only).
3. `get_public_hep`: recreate it (same signature and body) so each item carries `hidePicturesInLists` from its source exercise (`left join exercises on source_exercise_id`, false when no source). Nothing else changes in its payload.
4. New `public.get_public_hep_home(p_token text, p_pin text, p_device text default null) returns jsonb`, security definer, `set search_path = pg_catalog, public, platform_admin`, using `hep_verify` and the same rate-limit helpers and failure shape as `get_public_hep`. Returns `{ ok: true, firstName, nextVisit: { at, therapistName, location } | null, package: { name, done, total, expiresOn } | null, programs: [{ id, title, status, startDate, durationDays, itemCount }] }`. Next visit = this patient's earliest appointment with `scheduled_at >= now()` and status in ('confirmed','rescheduled'). Package = this patient's newest open package from visits (`package_group_id`, `package_total`, counted sessions < total, not past its expiry; mirror `groupOpenPackages`/`packageExpiresOn` in `src/domain/packageTracking.ts`), with the service name from the catalog. Programs = this patient's programs (active, paused, completed), newest first. Grant execute to anon and authenticated (like `get_public_hep`; check its grant).
5. Contract test: the file never edits earlier migrations; contains the three columns, the consent exception text, the new 27-arg `save_exercise` grant, `hidePicturesInLists` in `get_public_hep`, and `get_public_hep_home` calling `hep_verify`.

- [ ] Step 1: failing tests (contract; `hepService.saveExercise` sends `p_picture_consent` / `p_hide_pictures_in_lists`; `publicHepService.getPublicHome` maps the payload and failures like `getPublicHep`).
- [ ] Step 2: run → FAIL. Step 3: implement. Verify the SQL on a throwaway local Postgres if a server binary exists (`/usr/lib/postgresql/*/bin/initdb`), else say so.
- [ ] Step 4: tests + tsc → PASS. Step 5: commit `feat(hep): photo consent, hide-in-lists flag and patient home RPC`.
- [ ] Step 6: **owner go-ahead before the live apply** (controller). Continue Tasks 2–5 meanwhile.

### Task 2: Patient portal — Home and Exercises tabs, exercise page

**Model:** Opus.

**Files:** `src/features/publicHep/` (`PublicHepPage.tsx`, `HepExercises.tsx`, `HepChecklist.tsx`, `HepExerciseScreen.tsx`, new `HepHome.tsx`, `hepSession.ts` if needed) and tests.

**Decided behaviour (match the mockup's Patient portal tab):**
- After sign-in, a bottom tab bar Home / Exercises (Home first, home icon + exercise icon, 56px tall, active tab teal top border). The page header (clinic logo/name, 🔔 reminder, 📞 call) stays on both tabs.
- Home: "Hi {firstName}", "Here is where things stand."; Today card (shown program title, "From {prescribedBy} · n exercises · {1× daily…}", "Day N of M", "x of y done", progress bar, button "Start my exercises"/"Continue my exercises" → Exercises tab); This week (Mon–Sun cells from the existing logs: completed / partly / missed / not due, today outlined); Next visit card (date and time in the clinic's zone, "With {therapist} · {clinic}") only when present; Your package card ("{name}", "{done… } of {total} left", bar, "Valid until {date}") only when present; Other programs (other active ones with Open → switches the shown program) and folded "Earlier programs (n)" (title and date range); buttons "Book a visit" (to `/book/{slug}` only when the clinic has a booking slug — include `bookingSlug` in the Home RPC's clinic part if not already in `clinic`) and "Call clinic" (tel via the clinic phone). Home data comes from `getPublicHome`; if it fails, Home shows just the greeting and Today card (built from the existing payload).
- Exercises tab: the current checklist with sections. Rows show a thumbnail only when the item has pictures and `hidePicturesInLists` is false; otherwise just the tick, name, dose and ›. Remove any pelvic-floor auto-hiding from the patient side (`showThumb` default stays "show if pictures").
- Exercise page: the picture area only when the item has pictures (no title tile when none); Sets / Reps (or seconds) / Hold boxes; set circles "Sets · tap each one when done" when sets > 1 (local state for this screen visit only — not logged); the existing Start/Rest buttons, timer band, finished prompt, steps, therapist note, Stop if, Skip / ✓ Done · Next.
- The therapist preview (`src/features/hep/PatientPreview.tsx`) keeps using these components; update it so it shows the Exercises tab look (no tab bar needed in the exercise-form preview; the program preview may show the tab bar with Home built from local data — no Home RPC call).

- [ ] Step 1: failing tests (Home renders cards from a mocked `getPublicHome`, hides absent cards, Start switches tab; Exercises row without pictures has no img; hidden-in-lists item has no thumb but its exercise page shows the picture; set circles toggle; preview still makes no service writes).
- [ ] Step 2–4: RED, implement, GREEN (`npx vitest run src/features/publicHep src/features/hep/PatientPreview.test.tsx`), tsc, eslint.
- [ ] Step 5: commit `feat(hep): patient portal home and exercises tabs, richer exercise page`.

### Task 3: Staff side — consent tick, hide switch, list thumbnails

**Model:** Sonnet.

**Files:** `src/features/hep/ExerciseForm.tsx` / `ExerciseFormSections.tsx`, `src/features/hep/exerciseSaveInput.ts`, `LibraryParts.tsx`, `LibraryTable.tsx`, `LibraryBrowser.tsx`, `PickerPacks.tsx`, `ProgramItemsEditor.tsx`, `PatientPreview.tsx`, `useHepData.ts` (`useThumbUrls`), `src/domain/hep.ts` (`isSensitiveExercise` usage), tests.

**Decided behaviour:**
- Media and instructions section: when the exercise has ≥1 picture, show the consent checkbox (exact copy) — pre-ticked and read-only-labelled "Consent recorded {date}" when `pictureConsentAt` exists; and the "Hide pictures in lists" switch (`role="switch"`, exact copy and hint). Saving with pictures and no consent (neither recorded nor ticked) is blocked in the form with "Tick consent to save these pictures, or remove them." and the Media section opens. Send `p_picture_consent` (true only when newly ticked) and `p_hide_pictures_in_lists`. Archive / Delete / Restore don't ask for consent.
- Replace every staff-side `isSensitiveExercise` thumbnail rule with `hidePicturesInLists` (from the exercise; for program/template items, from the source exercise via the cache). `useThumbUrls` mints for all exercises with pictures except hidden-in-lists ones. Keep `isSensitiveExercise` only if still used for something else; otherwise remove it and its tests.
- Starter library exercises have no pictures, so no consent needed.

- [ ] Steps: failing tests (save blocked without consent; save sends the two flags; recorded consent shows its date; a pelvic-floor exercise with pictures now shows its thumbnail; hidden-in-lists hides it in Library grid/table, picker and editor rows) → RED → implement → GREEN (`npx vitest run src/features/hep src/domain`) → tsc/eslint → commit `feat(hep): photo consent and hide-in-lists replace automatic pelvic-floor hiding`.

### Task 4: Home program tab redesign

**Model:** Opus.

**Files:** `src/features/hep/HomeProgramTab.tsx` (split into small files in the same folder if it passes ~350 lines), `homeProgram.ts` helpers, `DayStrip.tsx`, tests.

**Decided layout (mockup "Home program tab"), top to bottom:**
1. Program chips row: one chip per active program ("{title} · active"), "Earlier ({n})" chip that unfolds the earlier list, and "+ New program" on the right.
2. Alert banner when a pain report is waiting (existing data/actions: Call via clinic country code, Mark reviewed).
3. Program card: title, status pill, actions (Edit program, Message patient, ⋮ with the existing menu items); one sub line ("{freq} · n exercises · about n min · completion target n% · prescribed by … · review in …"); day progress bar "Day N of M" with the date range (dates via the app helper); the patient-link line moved here (status dot + "Patient link on · opened {when} · PIN set", Copy link, Send on WhatsApp, Reset PIN…, Stop sharing) — reuse the existing link actions.
4. Stats row (Today, Adherence, Streak, Last active, Pain · effort).
5. Two columns from `desktop:` (stacked below): left = Last 14 days strip (existing DayStrip, tap a day keeps current behaviour) + "Pain and effort after each session" trend from `trendSeries` (small inline SVG, two lines, tokens `--rust` and `--sky`, legend); right = Today card (existing today data) with a "Yesterday:" summary line.
6. By exercise table grouped Warm-up / Main exercises / Cool-down (via `programBlocks`): Exercise (thumb only if pictures and not hidden), Dose, Done (n of last 7 days), Last 7 days mini strip, Notes flags ("felt hard ×n", "skipped ×n" from existing logs/feedback). Phone width: cards.
7. "Earlier programs (n)" folded at the bottom.
Use `th`/`td`/`cellSub`; `tableTypography.test.ts` must pass.

- [ ] Steps: failing tests (chips, banner actions, link line moved into the card, trend renders points from feedback, By exercise grouped with flags) → RED → implement → GREEN (`npx vitest run src/features/hep src/components/tableTypography.test.ts`) → tsc/eslint → commit `feat(hep): redesigned Home program tab`.

### Task 5: Patient profile layout

**Model:** Opus (shared core page; roles and actions must survive).

**Files:** `src/features/patients/PatientProfilePage.tsx` (extract `PatientHeaderCard.tsx`, `PatientSideRail.tsx` in the same folder), `PatientAdmissionBar.tsx`, `PatientViewTabs.tsx`, tests (`PatientProfileDepartmentScoping.test.tsx`, `PatientViewTabs.test.tsx`, others touching the page).

**Decided layout (mockup "Patient profile"):**
- One header card: name, status pills (admission "Admitted · {dept} · day N" when admitted; "Pain reported" when the HEP dot shows), meta line (Patient ID, age · sex, phone, primary condition, referral), second meta line (Next appointment, Package n of m left when present), actions on the right (Call, WhatsApp, Edit, New visit — same permissions and handlers as today).
- Tabs directly under the header (existing `PatientViewTabs`, same tabs and rules).
- Right rail from `desktop:`: "Needs attention" (sessions needing a note → Write session notes; pain to review → opens Home program tab), "Stay" card replacing the admission bar (Bill this stay / Edit stay / Discharge — same permissions), Payments, Care plan, Clinical notes (existing cards). Below `desktop:` the rail cards stack under the tabs' content, with Needs attention first above the tabs.
- Every existing action and role gate stays reachable; no behaviour changes beyond layout.

- [ ] Steps: failing tests (header shows next appointment/package; Needs attention links work; admission actions present in the Stay card for the same roles; tabs unchanged) → RED → implement → GREEN (`npx vitest run src/features/patients src/features/hep`) → tsc/eslint → `npm run build` → commit `feat(patients): profile header card, tabs higher, side rail with needs-attention and stay`.

### Task 6: Docs, verification, final review

**Model:** Sonnet for docs; Opus final review.

- [ ] Update FEATURES_AND_SCHEMA.md (HEP section 11 and the HEP schema block: consent/hide columns, `save_exercise` params, `get_public_hep` hide flag, `get_public_hep_home`; patient portal tabs; Home program tab; patient profile layout in the Patients section) and README if needed.
- [ ] Full `npm run typecheck && npm run lint && npm run test && npm run build`.
- [ ] Commit `docs(hep): portal home, photo consent, home program tab and patient profile`.
- [ ] Whole-range review (Opus), one fix wave, re-review.
