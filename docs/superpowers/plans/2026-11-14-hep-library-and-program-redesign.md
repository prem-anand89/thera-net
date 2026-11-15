# HEP Library, Exercise Form and Program Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the approved v3 mockup: six exercise types plus a new Position field, a Library with a table view and type/position filters, a sectioned pill-based exercise form with a live patient preview, a picker with template and earlier-program tabs, a program sheet with Warm-up / Main / Cool-down blocks and "Preview as patient", clearer Programs list signals, the patient-page refinements, and a professional wording pass.

**Architecture:** All work is on branch `feat/hep` in the worktree `/home/theranet/TN Project/thera-net-1-hep`. Domain rules (types, session order, blocks, filters, sorting) live in pure, tested modules (`src/domain/hep.ts`, `src/domain/hepLibrary.ts`, `src/features/hep/hepItems.ts`). Screens consume them. The patient's own components (`HepChecklist`, `HepExerciseScreen`) are reused for the therapist preview inside a phone frame, so the preview can never drift from what the patient sees. Warm-up and Cool-down are stored on each program/template item's existing `phase` column, so only Position needs a schema change.

**Tech Stack:** React 18 + TypeScript, Tailwind (app tokens in `src/index.css`), vitest + React Testing Library, Dexie offline cache, Supabase Postgres (RPC `save_exercise`).

**Spec:** `docs/superpowers/specs/2026-11-14-hep-redesign-mockup.html` (the v3 clickable mockup, open it in a browser; its "Wording" tab is the copy table), plus the owner decisions below.

## Owner decisions (2026-11-14, binding)

1. Exercise types are exactly six: Mobility, Stretching, Activation, Strengthening, Balance, Functional. No Breathing type. "Other" stays available.
2. The patient sees the same section names as the therapist.
3. Position is a new field and filter: Standing, Sitting, Supine, Prone, Side-lying, Quadruped, Kneeling. Multiple per exercise. Not shown to patients.
4. Warm-up and Cool-down are optional blocks at the top and bottom of a program/template, not exercise types. Exercises get in via "+ Add a warm-up / cool-down" (picker adds into that block) or the row ⋯ menu ("Move to warm-up", "Move to cool-down", "Move to main exercises"). Drag is left out (it would need a new dependency); the menu does the same job.
5. The exercise form keeps pills (no typing for dosage). Sections fold into a one-line summary with ✓ once set; the remaining sections stay visible. Editing an existing exercise opens with every section folded.
6. Professional wording on therapist screens (table in Global Constraints). Patient screens keep plain language.
7. Earlier approval ("go ahead with all", 2026-11-14) covers: Preview as patient, Library redesign, picker refinements, timer moved under the picture, sticky Start/Continue, › on checklist rows, timer-finished prompt, iOS Safari tip, `/p/*` noindex header, unsaved-changes guards, Lite cap meter, starter set in the picker's empty state, Templates region filter and clickable cards.

## Review amendments (Argon review, 2026-11-15)

From `docs/superpowers/plans/2026-11-14-hep-redesign-review-handoff.md`. Each one was checked against the code. Accepted items are written into their tasks below and marked **[R#]**.
- R1 accepted: Programs list "Call" needs the patient's phone (`PROGRAM_SELECT` selects only `patients(name)`); with no phone, the action falls back to "Open". → Task 8
- R2 accepted: template "Add all" in the picker must keep `templateId` (usage count, `sourceTemplateId`, `fromTemplate` on hand-over) and suggest the title. → Tasks 6, 7
- R3 accepted: keep Archive / Delete / Restore in the exercise form; Position is not required to save; Create progression unfolds Exercise details and Default dosage. (The cited "THERA_NET.md Rule 3" doesn't exist; the existing layout already follows the principle.) → Task 5
- R4 rejected: `HomeProgramNoteLine` already opens the current program in edit mode (commit 06a61fb).
- R5 accepted: use counts come from a grouped-count RPC, not by pulling every `program_items` row (PostgREST caps responses at 1,000 rows). → Tasks 3, 6
- R6 accepted, restated: `tableTypography.test.ts` checks cell font sizes (primary values not at 12px or smaller), not imports; new and changed tables use `th` / `td` / `cellSub` from `ui.tsx` and must pass that test. → Tasks 6, 8
- R7 accepted: with no patient chosen yet, the phone-width settings card starts expanded so the patient search is visible. → Task 7
- R8 accepted: an empty program shows quick starts ("Add exercises", "Start from a template", "Repeat an earlier program"), and the picker takes `initialTab`. → Tasks 6, 7
- R9 accepted: on the patient checklist, a section's "All done" / "Skip ›" show only when it has 2 or more open exercises. → Task 4

## Global Constraints

- CLAUDE.md applies: every `<button>` has an explicit `type`; money via `formatAmount`/`currencySymbol` (no ₹); no new India-only assumptions.
- Schema change = migration file in `supabase/migrations/` **and** live apply **only after the owner says go**; after applying, `supabase_migrations.schema_migrations` must hold the file's version and name. Never edit an already-applied migration (`20261113200000_hep_module.sql`, `20261113200100_hep_pain_push.sql`, `20261114100000_hep_exercises_audit_columns.sql`).
- HEP writes are online-only. Front desk has no HEP access. Patients never see Position, alternative names or anything therapist-only.
- Pelvic floor exercises never get thumbnails in lists (`isSensitiveExercise`), including in the preview's checklist rows.
- Tests: vitest + RTL. Component test files start with `// @vitest-environment jsdom`, `import '@testing-library/jest-dom/vitest'`, and `afterEach(cleanup)` when not already set up.
- The machine is short on memory: run `npx tsc --noEmit` and vitest in the background with output to a file, and wait for the done-file.
- Per task: `npx vitest run <touched test files>` and `npx tsc --noEmit` and `npx eslint <touched files>` must pass before commit. Final task: `npm run typecheck && npm run lint && npm run test && npm run build`.
- Commit trailer: `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>` (use the trailer of the model doing the work).
- Copy (therapist screens), exact:

| Now | New |
|---|---|
| Basics | Exercise details |
| Name (exercise form) | Exercise name |
| How to do it (form section) | Media and instructions |
| Pictures | Photos or GIF |
| Steps | Instructions (hint: "One step per line. Shown to the patient as numbered steps.") |
| Stop if (form label) | Precautions (hint: "Shown to the patient as “Stop if: …”.") |
| Default dose | Default dosage |
| How it's done | Dosage type |
| Reps / Reps with a hold / Timed | Repetitions / Repetitions with hold / Timed |
| Reps (count) | Repetitions |
| Hold each rep | Hold |
| Time | Duration |
| No side | Not applicable |
| Times a day: Once / Twice / 3 times | Frequency: 1× daily / 2× daily / 3× daily |
| Find it later | Classification |
| Also show under | Additional body regions |
| Other names | Alternative names (hint: "Used for search only, for example SLR. Not shown to patients.") |
| Duplicate (progression) button | Create progression |
| Starter set (button and sheet title) | Starter library |
| Length | Duration |
| Start | Start date |
| Check in | Review in (choices "In 7 days", "In 14 days", "No review") |
| A note for this patient (optional, any language) | Note to patient (optional, any language) |
| Advanced | More settings |
| After each session, ask about | Session feedback |
| Counts as completed at | Completion target |
| Set my own 4-digit PIN (optional) | Custom PIN (optional) |
| Habit | Adherence |
| Too early | Not enough data |
| Signals | Alerts |
| Needs your attention (chart) | Alerts |
| Mine / Everyone | My patients / All therapists |
| Ended / Past (filters) | Recently ended / Archived |
| Hand-over panel title | Share with patient |
| Show PIN on screen | Show PIN |
| Discard changes? | Discard unsaved changes? |

Patient screens are **not** renamed ("How to do it", "Stop if", "Lost your PIN?" stay).

## Review Focus

1. **Existing exercises with legacy types** (`warm_up`, `cool_down`, `other`) and **no positions**: the form must show and keep their type until the therapist changes it, the Library must still list and filter them, and old cached rows without `positions` must not crash (`positions ?? []`). Test in Task 1 and Task 5.
2. **Moving between blocks and back**: "Move to main exercises" on an item whose source exercise was deleted or is itself a legacy `warm_up` must land in a valid section (`other`), never lose the item. Test in Task 2.
3. **Saved order equals shown order**: after any block move, the saved `sortOrder` (via `orderBySection`) must put Warm-up first, then the six types, then Other, then Cool-down, so the patient page shows the same order. Test in Task 2.
4. **Preview with unsaved pictures**: the form's live preview must show new, unsaved pictures (object URLs) and saved ones (minted URLs), and must work offline with text-only tiles. Test in Task 4.
5. **Picker adding into a block when some exercises are already in the program**: already-present exercises are disabled ("In program") and template "Add all" skips them, adding the rest into the requested block. Test in Task 6.

---

### Task 1: Domain — types, positions, session order, Library filter and sort

**Model:** Sonnet.

**Files:**
- Modify: `src/domain/hep.ts` (types, positions, labels, `Exercise.positions`, search)
- Modify: `src/domain/hepLibrary.ts` (`LibraryFilter.position`, sort)
- Modify: `src/domain/hepStarterSet.ts` (positions on all 28, retype 3 warm-ups)
- Modify: `src/lib/db.ts` only if a typed default is needed for cached rows (no index change)
- Test: `src/domain/hep.test.ts`, `src/domain/hepLibrary.test.ts` (create if absent), `src/domain/hepStarterSet.test.ts`

**Interfaces (Produces):**
- `export const EXERCISE_TYPES = ['mobility','stretching','activation','strengthening','balance','functional'] as const; export type ExerciseType = (typeof EXERCISE_TYPES)[number];`
- `export const isMainType = (p: ExercisePhase): p is ExerciseType`
- `export const SESSION_ORDER: readonly ExercisePhase[] = ['warm_up','mobility','stretching','activation','strengthening','balance','functional','other','cool_down']`
- `export const EXERCISE_TYPE_DEFINITIONS: Record<ExerciseType, string>`: copy verbatim from the mockup's TYPE_HINT (e.g. mobility: "Active or assisted range of motion. Default dosage: repetitions.").
- `export type TypeTone = 'sky'|'plum'|'amber'|'rust'|'moss'|'teal'|'slate'; export const EXERCISE_TYPE_TONE: Record<ExercisePhase, TypeTone>` = mobility sky, stretching plum, activation amber, strengthening rust, balance moss, functional teal, warm_up/cool_down/other slate.
- `EXERCISE_PHASE_LABELS` unchanged (already "Stretching", "Strengthening", "Warm-up", "Cool-down").
- `export const HEP_POSITIONS = ['Standing','Sitting','Supine','Prone','Side-lying','Quadruped','Kneeling'] as const; export type HepPosition = (typeof HEP_POSITIONS)[number];`
- `Exercise.positions: string[]` (doc comment: "Starting positions; a filter for staff, never shown to patients.")
- `export const positionsOf = (ex: Pick<Exercise,'positions'>): string[] => ex.positions ?? []` and use it everywhere positions are read.
- `hepLibrary.ts`: `LibraryFilter` gains `position: string` (`'All'` = none); `EMPTY_LIBRARY_FILTER.position = 'All'`; `filterLibrary` keeps an exercise only if `position === 'All' || positionsOf(ex).includes(position)`; `activeFilterChips` adds `{ key: 'position', label: <position> }`.
- `export type LibrarySort = 'used' | 'az' | 'recent'; export function sortLibrary<T extends LibraryExercise>(list: T[], sort: LibrarySort, useCounts: Record<string, number>): T[]` — used: count desc then A–Z; az: title A–Z; recent: `createdAt` desc.

- [ ] **Step 1: Write failing tests**
  - `hep.test.ts`: `SESSION_ORDER` puts `warm_up` first, `cool_down` last, `other` second to last; `EXERCISE_TYPES` has exactly the six; every `ExercisePhase` has a tone; `exerciseMatches` finds "Supine" via positions.
  - `hepLibrary.test.ts`: `filterLibrary([...], {...EMPTY_LIBRARY_FILTER, position: 'Prone'})` keeps only prone; an exercise object **without** a `positions` property is kept by `position: 'All'` and dropped by `position: 'Prone'` without throwing; `sortLibrary` for each of the three sorts; `activeFilterChips` includes the position chip.
  - `hepStarterSet.test.ts`: every starter has `positions.length >= 1`, every value in `HEP_POSITIONS`, and `phase` in `EXERCISE_TYPES`.
- [ ] **Step 2: Run** `npx vitest run src/domain/hep.test.ts src/domain/hepLibrary.test.ts src/domain/hepStarterSet.test.ts` — expect FAIL.
- [ ] **Step 3: Implement.** Starter positions: take them from the mockup's data where it overlaps (`POS_BY_POSE` / `POS_OVERRIDE`), otherwise from each exercise's first step (e.g. "Lie on your back" → Supine, "Lie on your side" → Side-lying, "Start on hands and knees" → Quadruped, "Kneel" → Kneeling, "Sit" → Sitting, "Stand" → Standing; "Sit or stand" → both). Retype: Pendulum Swings → `mobility`, Ankle Pumps → `mobility`, Marching on the Spot → `functional`. Add `positions` to the starter entry type and pass it through wherever starters become `SaveExerciseInput` (Task 3 wires the service).
- [ ] **Step 4: Run** the same tests, then `npx tsc --noEmit` (background). Fix every type error caused by the new required `Exercise.positions` (test fixtures: add `positions: []`).
- [ ] **Step 5: Commit** `feat(hep): six exercise types, positions, session order, library position filter and sort`.

### Task 2: Program/template item blocks (pure)

**Model:** Opus (ordering rules are easy to get subtly wrong).

**Files:**
- Modify: `src/features/hep/hepItems.ts`
- Test: `src/features/hep/hepItems.test.ts`

**Interfaces:**
- Consumes: `SESSION_ORDER`, `EXERCISE_TYPES`, `isMainType` (Task 1).
- Produces:
  - `groupItemsByPhase` and `orderBySection` now follow `SESSION_ORDER` (not `EXERCISE_PHASES`).
  - `export type ItemBlock = 'warm_up' | 'main' | 'cool_down';`
  - `export const blockOf = (phase: ExercisePhase): ItemBlock`
  - `export interface ItemBlocks { warmUp: ItemSection['rows']; main: ItemSection[]; coolDown: ItemSection['rows'] }`
  - `export function programBlocks(items: HepItemInput[]): ItemBlocks` — main = sections for the six types then Other, each keeping insertion order.
  - `export function mainPhaseFor(item: Pick<HepItemInput,'sourceExerciseId'>, library: Pick<Exercise,'id'|'phase'>[]): ExercisePhase` — source exercise's phase if `isMainType`, else `'other'`.
  - `export function moveToBlock(items: HepItemInput[], index: number, block: ItemBlock, mainPhase: ExercisePhase): HepItemInput[]` — sets `phase` to `'warm_up'`, `'cool_down'` or `mainPhase`; moves the item to the end of its new section; returns a new array.
  - `export function intoBlock(items: HepItemInput[], block: ItemBlock): HepItemInput[]` — for picker additions: `'main'` leaves phases as they are; otherwise sets every phase to the block.

- [ ] **Step 1: Failing tests** — `orderBySection` of [cool_down A, strengthening B, warm_up C, other D, mobility E] gives C, E, B, D, A; `programBlocks` splits accordingly; `moveToBlock(…,'warm_up',…)` then `orderBySection` puts it first; `moveToBlock(…,'main', mainPhaseFor(item, []))` with an unknown source gives `'other'`; a legacy-`warm_up` source exercise also gives `'other'`; `intoBlock(items,'cool_down')` sets all phases; `moveWithinSection` still never crosses sections.
- [ ] **Step 2: Run** `npx vitest run src/features/hep/hepItems.test.ts` — FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** tests + `npx vitest run src/features/hep src/features/publicHep` (sections are shared) — PASS.
- [ ] **Step 5: Commit** `feat(hep): warm-up, main and cool-down blocks for program and template items`.

### Task 3: Position column, save RPC and service

**Model:** Opus (SQL + live-database rules).

**Files:**
- Create: `supabase/migrations/20261114200000_hep_exercise_positions.sql`
- Create: `src/domain/hepPositionsMigration.test.ts`
- Modify: `src/services/hepService.ts` (`SaveExerciseInput.positions?: string[]`, pass `p_positions`), `src/features/hep/exerciseSaveInput.ts`, `src/features/hep/starterSet.ts` (pass starter positions)
- Test: `src/services/hepService.test.ts`

**Migration content (decided):**
1. `alter table public.exercises add column if not exists positions text[] not null default '{}'::text[];` plus `constraint exercises_positions_check check (positions <@ array['Standing','Sitting','Supine','Prone','Side-lying','Quadruped','Kneeling']::text[])` (add with `do $$ … if not exists … $$` so it is re-runnable).
2. `drop function if exists public.save_exercise(uuid, uuid, text, text, text, text[], text[], text, text, text[], smallint, smallint, smallint, smallint, text, text, boolean, text, smallint, smallint, text[], boolean, text[], text);`
3. `create or replace function public.save_exercise(...)` — **the body of the current definition in `20261113200000_hep_module.sql` lines 425–532, unchanged**, plus a final parameter `p_positions text[] default '{}'::text[]`, written in both the insert and the update as `positions = coalesce(p_positions, '{}'::text[])`.
4. `grant execute on function public.save_exercise(<the 25-type signature>) to authenticated;` and `revoke … from anon, public` matching the original's grants.
5. **[R5]** `create or replace function public.exercise_use_counts(p_clinic_id uuid) returns table (exercise_id uuid, uses int)`, `language sql stable security definer set search_path = pg_catalog, public`, guarded by `public.is_hep_staff(p_clinic_id)` (return no rows otherwise): `select pi.source_exercise_id, count(*)::int from public.program_items pi join public.programs p on p.id = pi.program_id where p.clinic_id = p_clinic_id and pi.source_exercise_id is not null group by 1`. Grant execute to authenticated only.
- Contract test (reads the new file): contains the drop of the 24-arg signature, `p_positions text[]`, the check constraint listing all seven positions, the grant with the 25-arg signature, and `exercise_use_counts` with the `is_hep_staff` guard.

- [ ] **Step 1: Failing tests** — contract test; `hepService.test.ts`: `saveExercise({...input, positions: ['Supine']})` calls `rpc('save_exercise', expect.objectContaining({ p_positions: ['Supine'] }))`, and omitting positions sends `[]`.
- [ ] **Step 2: Run** them — FAIL.
- [ ] **Step 3: Implement** migration, service and save-input mapping. Test the SQL against the local scratch Postgres (`/tmp/claude-1000/pgtest`, stubs) if available: apply `hep_module` then this file, call `save_exercise` with and without `p_positions`, and confirm the check rejects `'Lying'`.
- [ ] **Step 4: Run** tests + tsc — PASS.
- [ ] **Step 5: Commit** `feat(hep): exercise positions column and save_exercise p_positions`.
- [ ] **Step 6: Owner go-ahead for the live apply.** Ask the owner; while waiting, carry on with Tasks 4–8 (none needs the live column). On yes: `supabase db push --linked` from the worktree, then confirm `schema_migrations` has version `20261114200000` (main's newest is `20261114110100`, so the order is fine). Until it is applied, saving an exercise against the live database fails (the app sends `p_positions`), including from the dev server, so **do not merge or deploy before this step is done**, and Task 9's click-through needs it.

### Task 4: Patient preview building blocks + patient-page refinements

**Model:** Sonnet.

**Files:**
- Modify: `src/features/publicHep/HepExerciseScreen.tsx` (`framed?: boolean`; timer band under the picture; finished prompt)
- Modify: `src/features/publicHep/HepTimer.tsx` (`HepTimerLayer` renders as a band, not an overlay)
- Modify: `src/features/publicHep/HepChecklist.tsx` (sticky Start/Continue; › on each row)
- Modify: `src/features/publicHep/HepSignIn.tsx` (iOS tip)
- Modify: `vercel.json` (header for `/p/(.*)`: `X-Robots-Tag: noindex, nofollow`)
- Create: `src/features/hep/patientPreview.ts`, `src/features/hep/PatientPreview.tsx`
- Test: `src/features/publicHep/PublicHepPage.test.tsx`, `src/features/publicHep/HepTimer.test.tsx`, `src/features/hep/PatientPreview.test.tsx`, `src/features/hep/patientPreview.test.ts`

**Interfaces:**
- `HepExerciseScreenProps.framed?: boolean` — `absolute inset-0` instead of `fixed` for the screen and its bottom bar, so it fits inside a phone frame.
- Timer: while running, a band directly **below** the picture shows the ring, phase word, "Rep n of N" and Stop; the picture stays visible and swipeable. When a timer sequence ends naturally, show a bar above the bottom buttons: "All {N} holds done. Tap ✓ Done when you're ready." (for timed: "Time's up. Tap ✓ Done when you're ready."), cleared on Done, Skip, Undo or leaving the screen.
- Checklist: the Start/Continue button is `sticky bottom-0`; each row shows a `›` (aria-hidden) at the end. **[R9]** A section header shows "All done" and "Skip ›" only when the section has 2 or more open exercises (test: a one-exercise section has neither button).
- Sign-in: when `/iPhone|iPad|iPod/.test(navigator.userAgent)`, under "Remember this phone" show "On iPhone, open this link in Safari so it remembers you. Links opened inside WhatsApp may forget."
- `patientPreview.ts`: `export function toPreviewItems(items: HepItemInput[], opts: { today: string; sessionsPerDay: SessionsPerDay; mediaUrls: Record<string, string> }): PublicHepItem[]` — ids `preview-${index}`, `mediaUrls` from `mediaKeys` mapped through `opts.mediaUrls` (missing keys dropped), `sessionsSchedule: [{ from: today, sessionsPerDay }]`, `addedOn: today`, `sortOrder` = index after `orderBySection`.
- `PatientPreview.tsx`:
  - `export function PhoneFrame({ children, label }: { children: ReactNode; label: string })` — 360×680 max, scales down to fit; `aria-label={label}`; a ribbon "Preview · what the patient sees · nothing is saved".
  - `export function ProgramPreviewDialog({ open, onClose, clinicId, clinicName, title, items, sessionsPerDay }: {...})` — `SheetDialog` holding a `PhoneFrame` with the real `HepChecklist` (local done/skip state only) and, on open of a row, `HepExerciseScreen framed readOnly`. Pictures minted with `hepMediaService.mintViewUrls(clinicId, keys)`; offline → no pictures.
  - `export function ExercisePreviewPhone({ clinicId, item, pictures }: { clinicId: string; item: HepItemInput; pictures: Picture[] })` — single exercise screen; new pictures use `picture.preview`, saved ones minted.

- [ ] **Step 1: Failing tests** — timer band is rendered after the picture element in DOM order and the picture is still present while running; finished prompt appears after the last phase (fake timers) and disappears on Done; sticky Start button exists and each row has a `›`; iOS tip shows only with an iPhone UA; `toPreviewItems` mapping and order; `ProgramPreviewDialog` shows the checklist with the ribbon, tapping a row opens the exercise screen, tapping ✓ Done changes nothing outside the dialog (no service calls); `ExercisePreviewPhone` shows an `<img>` with the object URL for an unsaved picture.
- [ ] **Step 2: Run** them — FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** `npx vitest run src/features/publicHep src/features/hep/PatientPreview.test.tsx src/features/hep/patientPreview.test.ts` + tsc — PASS.
- [ ] **Step 5: Commit** `feat(hep): patient preview frame, timer under the picture, sticky start, finished prompt, iOS tip, noindex for /p`.

### Task 5: Exercise form — folding sections, pills, Position, live preview

**Model:** Opus (largest UI change; many states).

**Files:**
- Modify: `src/features/hep/ExerciseForm.tsx` (split into section components in the same folder if it passes ~400 lines: `ExerciseFormSections.tsx`)
- Modify: `src/features/hep/ExerciseDoseEditor.tsx` (copy only)
- Test: `src/features/hep/ExerciseForm.test.tsx`, `src/features/hep/ExerciseDoseEditor.test.tsx`

**Behaviour (decided):**
- Sheet `wide="xl"`. Desktop (`desktop:` breakpoint): form left, right column "Patient view" with `ExercisePreviewPhone` (sticky). Below desktop: a "Preview" button in the header opens the same phone in a dialog.
- Four sections, in order, each a card with a status dot (number, or ✓ when done), title, and — when folded — a one-line summary and "Edit":
  1. **Exercise details**: Exercise name (input), Body region (pills: the fixed regions, clinic regions, and "Other region…" which reveals the existing text input), Type (pills for the six with their tone dot, plus "Other"; under the pills the selected type's definition from `EXERCISE_TYPE_DEFINITIONS`). If the exercise's current phase is `warm_up` or `cool_down`, also show that value as a pressed pill so it is kept until changed. Done = name, region and a type chosen. "Type chosen" is a `typeChosen` flag: true when editing an existing exercise, false for a new one until a Type pill is tapped (the form's state starts at `'other'`, so the phase value alone can't tell). Summary: "Name · Region · Type".
  2. **Media and instructions**: Photos or GIF (`PictureField` unchanged), Instructions, Precautions. Done = instructions not empty. Summary: "2 photos · 3 steps · precautions set".
  3. **Default dosage**: `ExerciseDoseEditor` (pills already). Done = dose valid. Summary = the existing dose description, e.g. "3 × 10 · each side · rest 30 s · 1× daily".
  4. **Classification**: Position (multi pills, `HEP_POSITIONS`), Equipment (multi pills, existing list, "optional"), Additional body regions (multi pills, "optional"), Alternative names (tag input, "optional"). Done = at least one position. Summary joins positions, equipment, "+ Region", and quoted names.
- New exercise: section 1 open, the rest folded. Each open section ends with "Next: <title> ›" (opens the next not-done section and folds this one) or "Done" on the last. Editing an existing exercise: all folded. Opening one section folds the others.
- Choosing a type when the dosage is untouched applies `suggestedDoseType` (existing behaviour; keep).
- Unsaved-changes guard: Cancel / ✕ / Esc on a changed form shows `ConfirmDialog` "Discard unsaved changes?" (confirm "Discard", cancel "Keep editing").
- Footer: Cancel · Create progression (existing exercise only; the existing duplicate action) · Save.
- **[R3]** Keep the existing quiet Archive / Delete / Restore bar for existing exercises, at the bottom of the form body below Classification, never in the footer. Position is **not** required to save (Classification's ✓ needs it; `valid` does not). Create progression opens Exercise details and Default dosage, so the copied name and dosage are in view. Tests: Archive/Delete still shown for an existing exercise; Save is enabled for a legacy exercise with no positions; after Create progression, both sections are expanded.
- `ExerciseDoseEditor` copy per Global Constraints ("Dosage type", "Repetitions", "Repetitions with hold", "Hold", "Duration", "Side: Not applicable", "Frequency: 1× daily / 2× daily / 3× daily"). It is shared with the program sheet and template editor, so the copy changes there too.
- Save sends `positions`.

- [ ] **Step 1: Failing tests** — new form: only "Exercise details" is expanded; "Next: Media and instructions ›" folds it with summary text; Save sends `positions: ['Supine']` after choosing the pill; an existing exercise with phase `warm_up` opens all folded, shows "Warm-up" in the summary, and saves `phase: 'warm_up'` when untouched; an exercise without `positions` opens without crashing and its Classification summary reads "Not set"; Cancel after an edit shows "Discard unsaved changes?"; the preview phone shows the typed title; ExerciseDoseEditor shows "Frequency" and "1× daily".
- [ ] **Step 2: Run** — FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** `npx vitest run src/features/hep` + tsc + eslint on touched files — PASS.
- [ ] **Step 5: Commit** `feat(hep): exercise form in four folding sections with pills, position and live patient preview`.

### Task 6: Library and picker

**Model:** Sonnet.

**Files:**
- Modify: `src/features/hep/LibraryBrowser.tsx`, `src/features/hep/LibraryTab.tsx`, `src/features/hep/ExercisePicker.tsx`, `src/features/hep/StarterSetSheet.tsx` (title "Starter library"), `src/features/hep/HepPage.tsx` (button label)
- Modify: `src/services/hepService.ts` (`exerciseUseCounts(clinicId): Promise<Record<string, number>>` — **[R5]** calls `rpc('exercise_use_counts', { p_clinic_id })`; on any error returns `{}`; online only)
- Modify: `src/features/hep/useHepData.ts` (`useExerciseUseCounts(): Record<string, number>`, `{}` offline)
- Test: `LibraryBrowser.test.tsx`, `LibraryTab.test.tsx`, `ExercisePicker.test.tsx`, `hepService.test.ts`

**Behaviour (decided):**
- One flat result set (no region/type group headings). Filters: ★ Favourites, Body region, Type (with tone dots), **Position**, Equipment — each value with its count. Desktop: left rail; narrower: chip rows (region, type, position) plus the Equipment menu. Active filters show as removable chips with "Clear all".
- Sort select: Most used (default) / A–Z / Recently added (`sortLibrary`). Offline "Most used" falls back to A–Z silently.
- View toggle: **Grid** / **Table**. Grid card: 4:3 picture or tinted tile (region colour), two-line name, type tag (dot + label), muted "Region · Positions · Equipment", default dosage, ★ button. Table (≥ ~620px of container): picture, Exercise (+ "also …" alternative names), Region, Type, Position, Equipment, Default dosage, Used (n×), ★; header buttons sort Exercise / Region / Type / Used. Narrower: two-line rows. The choice is remembered in localStorage `hep-library-view` (try/catch).
- Picker: the same browser in grid view inside the sheet. Tabs: **Exercises** · **Templates** · **{Patient first name}'s earlier programs** (the last only when a patient is known).
  - Templates tab: region chips + template cards (name, up to 5 thumbnails, exercise names, "n exercises · used n×", "Add all n").
  - Earlier programs tab: that patient's previous programs (`hepService.listPatientPrograms`) with "Add all n" (doses as prescribed last time). Templates come from `hepService.listTemplates` (already returns `usedCount`).
  - Exercises already in the program are faded with an "In program" badge and cannot be chosen; "Add all" skips them.
  - Side panel (desktop): "Adding · n", the chosen rows with ✕, "About n more minutes per session", primary "Add n". Phone: bottom strip of chosen chips with ✕ and "Add n".
  - Empty Library: "Your Library is empty" + "Add the starter library" (opens `StarterSetSheet`) + "Or create your own exercise".
  - Title: "Add exercises", or "Add to the warm-up" / "Add to the cool-down" when opened for a block.
- **Interface change:** `ExercisePickerProps` becomes `{ open; onClose; onAdd: (items: HepItemInput[], meta?: { templateId?: string; suggestedTitle?: string }) => void; disabledIds?: ReadonlySet<string>; patientId?: string; patientName?: string; target?: ItemBlock; initialTab?: 'exercises' | 'templates' | 'earlier' }`. The picker converts with `exerciseToItem`, the template-item converter in `hepItems.ts`, and program items as-is, then applies `intoBlock(items, target ?? 'main')`. **[R2]** Template "Add all" passes `{ templateId, suggestedTitle: template.title }`; earlier-program "Add all" passes `{ suggestedTitle: program.title }`. **[R8]** `initialTab` picks the opening tab.
- **Task boundary:** because Task 6 changes `onAdd` and must pass `npx vitest run src/features/hep` + tsc on its own, Task 6 also updates the existing callers and their test mocks to the new signature: `ProgramSheet.tsx` and `TemplateEditor.tsx` (minimal change: append the received `HepItemInput[]` as they append items today; keep `templateId` handling for Task 7), plus `ProgramSheet.test.tsx` and `TemplatesTab.test.tsx`. Task 7 then builds the blocks, `meta`, and `initialTab` wiring on top.
- **[R6]** The Library table uses `th` / `td` / `cellSub` from `src/components/ui.tsx`; `src/components/tableTypography.test.ts` must pass. The browser's root gets `@container` (Tailwind v4) so grid/table/rows switch on the container's width, also inside the picker.

- [ ] **Step 1: Failing tests** — position filter chip narrows results and shows counts; table view renders the Position and Used columns and sorts by Type; view choice persists across remount; picker: an exercise in `disabledIds` shows "In program" and is not added by "Add all"; Templates tab "Add all" calls `onAdd` with that template's items minus disabled ones; `target: 'warm_up'` makes every added item `phase: 'warm_up'`; empty Library shows "Add the starter library"; `exerciseUseCounts` counts per id.
- [ ] **Step 2: Run** — FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** `npx vitest run src/features/hep src/services/hepService.test.ts` + tsc — PASS.
- [ ] **Step 5: Commit** `feat(hep): flat library with position filter, table view and sorting; picker with templates and earlier programs`.

### Task 7: Program sheet and template editor

**Model:** Opus (largest stateful sheet; edit mode, change summary and blocks interact).

**Files:**
- Modify: `src/features/hep/ProgramSheet.tsx` (split out `ProgramItemsEditor.tsx` shared with the template editor), `src/features/hep/TemplateEditor.tsx`, `src/features/hep/TemplatesTab.tsx`, `src/features/hep/programDraft.ts` (copy of choices only)
- Test: `ProgramSheet.test.tsx`, `TemplatesTab.test.tsx`, create `ProgramItemsEditor.test.tsx`

**Behaviour (decided):**
- `ProgramItemsEditor({ items, setItems, sessionsPerDay, library, editingLive?, live?, bundle?, today?, onAdd: (target: ItemBlock) => void })` renders three blocks:
  - **Warm-up** (optional): its rows, then a dashed button "+ Add a warm-up — Done first, before the main exercises" (when it has rows: "+ Add to warm-up").
  - **Main exercises · n**: sections by type in `SESSION_ORDER` (tone dot + label, "Optional" checkbox per section as today), rows inside.
  - **Cool-down** (optional): same pattern, "Done last, after the main exercises".
  - Row: drag handle, thumbnail (none for pelvic floor), name, dose line; tap to expand (dose pills, "Note to patient (optional, any language)", "So far: …" in edit mode — all existing); ⋯ menu with "Move to warm-up" / "Move to cool-down" (main rows) or "Move to main exercises" (block rows), then "Move up" / "Move down"; ✕ remove.
  - No drag in this plan: `@dnd-kit` is not a dependency and none is added. The ⋯ menu (block moves, Move up / Move down) covers it; no drag handle is drawn.
- Program sheet layout: `SheetDialog wide="xl"`. Desktop: items editor left; right panel with Patient (search/browse/new as today), Program name, Frequency, Duration, Start date, Review in, Prescribed by, "More settings" (session feedback, completion target, custom PIN), then "Preview as patient" and the primary save. Below desktop: settings collapse into one summary card ("Ravi Kumar · 2× daily · 4 weeks · starts today · review in 7 days" + Edit).
- Header line (new programs only): "Free plan · n of {limit} active programs". The limit comes from `TIER_LIMITS[tier].activePrograms` via `useEntitlements()` (`null` = unlimited → no line). The count comes from a new `hepService.countActivePrograms(clinicId): Promise<number>` (`from('programs').select('id', { count: 'exact', head: true }).eq('clinic_id', clinicId).eq('status', 'active')`, the same rule the server's cap uses); offline or on error → no line.
- The "Start from" section is removed; templates and earlier programs are reached from the picker tabs. Entry points that pass a template or an earlier program into the sheet keep working.
- **[R2]** `onAdd(items, meta)`: when `meta.templateId` is set, the sheet stores it as `templateId` (so `sourceTemplateId` and `fromTemplate` work as today); when `meta.suggestedTitle` is set and the program name is still blank, it fills the name. Test: adding a template from the picker, then saving, calls `createProgram` with `sourceTemplateId` and the template's title.
- **[R7]** On the phone-width layout, the settings card starts expanded when the sheet needs a patient and none is chosen. Test: opened from "Use for a patient" at narrow width, the patient search is visible.
- **[R8]** With no exercises, the editor shows three quick starts: "Add exercises" (picker, Exercises tab), "Start from a template" (Templates tab) and, when the patient has an earlier program, "Repeat an earlier program" (earlier-programs tab). Test: "Start from a template" opens the picker on the Templates tab.
- "+ Add exercises" / block buttons open `ExercisePicker` with `target`, `patientId`, `patientName`, and `disabledIds` from current items.
- Footer: Cancel · Preview as patient (`ProgramPreviewDialog`) · "Save and share" (new) / "Save changes" (edit).
- Template editor: uses `ProgramItemsEditor`, gets "Preview as patient", and the unsaved-changes guard ("Discard unsaved changes?").
- Templates tab: region chips (from template items' regions, with counts) and the whole card opens the editor (keyboard: the card is a button; inner actions stop propagation).

- [ ] **Step 1: Failing tests** — "+ Add a warm-up" opens the picker titled "Add to the warm-up" and added items appear in the Warm-up block; ⋯ → "Move to cool-down" moves a row and the saved items end with it; "Move to main exercises" restores the source exercise's type; saved order (spy on the create/update call) is warm-up, types, other, cool-down; the summary card shows on narrow layout; "Preview as patient" opens the dialog with the program title; Templates tab region chip filters cards and clicking a card opens the editor; template editor Cancel after an edit asks "Discard unsaved changes?".
- [ ] **Step 2: Run** — FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** `npx vitest run src/features/hep` + tsc + eslint — PASS.
- [ ] **Step 5: Commit** `feat(hep): program and template editor with warm-up, main and cool-down blocks, settings panel and preview`.

### Task 8: Programs list, patient chart and remaining copy

**Model:** Sonnet.

**Files:**
- Modify: `src/services/hepService.ts` (`PROGRAM_SELECT`, bundle `patientPhone`), `src/features/hep/programRows.ts` (bucket `'ending'`; `ProgramRow.days: DayCell[]`; `ProgramRow.patientPhone`), `src/features/hep/ProgramsTab.tsx`, `src/features/hep/HomeProgramTab.tsx`, `src/features/hep/HandOverPanel.tsx`, any other file still showing an old label from the Global Constraints table
- Test: `programRows.test.ts`, `ProgramsTab.test.tsx`, `HomeProgramTab.test.tsx`, `HandOverPanel.test.tsx`

**Behaviour (decided):**
- `ProgramBucket = 'attention' | 'active' | 'ending' | 'ended' | 'past'`; `'ending'` = active (not paused) with an end date from today through today + 6; such programs are in both Active and Ending this week. Filter labels: Needs attention · Active · Ending this week · Recently ended · Archived.
- Owner toggle labels: My patients · All therapists.
- Table: Patient · Program · Today ("n of m sessions") · "Adherence, last 14 days" (14 coloured squares from `dayStrip` — completed / partial / missed / not due, today outlined — plus "86%" or "Not enough data" under it) · Alerts · Last active · action. The row's primary action follows its first alert: red → "Call" (`tel:` via the patient's phone, built with the clinic country code helpers), amber → "Message", otherwise "Open". Phone layout shows the same strip.
- **[R1]** `PROGRAM_SELECT` in `src/services/hepService.ts` becomes `'*, patients(name, phone), therapists(name), program_items(*, program_logs(*)), program_session_feedback(*)'`; the program bundle carries `patientPhone: string | null`, and `ProgramRow` (in `programRows.ts`) gets `patientPhone`. With a red alert but no phone, the action is "Open". Test both cases.
- **[R6]** The Programs table keeps using `th` / `td` / `cellSub` from `ui.tsx`; the strip's percentage line is secondary (muted) text, so `tableTypography.test.ts` passes.
- Chart (HomeProgramTab): "Habit" → "Adherence", "Too early" → "Not enough data", "Needs your attention" → "Alerts".
- Hand-over: title "Share with patient", button "Show PIN".
- Sweep: `grep -rn` every "Now" string from the copy table in `src/features/hep` and fix leftovers (patient-facing files excluded).

- [ ] **Step 1: Failing tests** — `countBuckets`/`filterRows` for `'ending'`; ProgramsTab shows the five filter labels, the strip (14 cells) and "Call" for a pain alert; HomeProgramTab shows "Adherence"; HandOverPanel title "Share with patient".
- [ ] **Step 2: Run** — FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** `npx vitest run src/features/hep` + tsc — PASS.
- [ ] **Step 5: Commit** `feat(hep): programs list adherence strip, ending-this-week filter, alert actions and professional wording`.

### Task 9: Docs and full verification

**Model:** Sonnet for the docs; the final whole-branch review on Opus.

**Files:**
- Modify: `FEATURES_AND_SCHEMA.md` (HEP section: types and blocks, Position column and RPC parameter, Library/picker/program sheet behaviour, preview, programs list, copy), `README.md` (one line if HEP is listed), `docs/superpowers/plans/2026-11-09-hep-module.md` (note that this plan supersedes its Library/form/program-sheet UI details)
- No India-only surface is added; state that in the doc update.

- [ ] **Step 1:** Update the docs.
- [ ] **Step 2:** Run `npm run typecheck && npm run lint && npm run test && npm run build` (background; read the logs, not just the exit code). Expected: all pass.
- [ ] **Step 3:** Open the app on port 5174 (`npx vite --config vite.hep.config.ts --port 5174 --strictPort`) and click through: new exercise (all four sections, preview), Library table and filters, a program with a warm-up and cool-down, Preview as patient, the Programs list. Note anything that differs from the mockup.
- [ ] **Step 4: Commit** `docs(hep): library, exercise form and program redesign`.
- [ ] **Step 5:** Whole-branch review (Opus), fix findings in one pass, re-run Step 2.
