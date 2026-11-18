# TheraNet Library: curation tools, provenance and origin tracking

**Supersedes** `2026-11-18-hep-starter-manage-updates-and-clinic-sharing.md` (clinic-to-clinic sharing and the "Update available" badge are deferred to the Public Exercise Library, `2026-11-13-public-exercise-library.md`).

## Goal

The owner is building a catalogue of basic exercises, region by region, that every clinic will get as a starting point once HEP is unlocked for all clinics. This plan gives them the tools to grow it and keeps the data honest:

1. Rename "Starter library" to **TheraNet Library** (what users see) and the clinic's own tab "Library" to **My exercises**.
2. **Bulk publish** from the clinic's own Library into the TheraNet Library, with a record of where the pictures came from.
3. A **Coverage** view (region by exercise type) so gaps are visible.
4. **Record where each copy came from** when a clinic adds an exercise from the TheraNet Library (so "a newer version is available" can be built later, also for the future Public Library).
5. **Count library imports against the free-plan exercise limit** (already enforced by the server; make the screen say so up front).

## How to work (owner's rules)

- **One Sonnet session, done by hand, in order. No sub-agents, no per-task review loops.**
- **Opus is needed once:** a single review of the SQL in Task 2 (a security-definer function and a new table). Everything else is Sonnet.
- Work on `main` in small commits (one per task). Never edit a migration that is already live; the new migration is `supabase/migrations/20261118130000_hep_library_curation.sql`.
- **Do not apply the migration, deploy anything, or push.** Claude (with the owner's yes) dry-runs the SQL on the live database inside a rolled-back transaction, applies it, records the migration history row, and pushes. No edge function changes are needed in this plan (bulk publish reuses `clone_to_starter`).
- Never replace or shorten `FEATURES_AND_SCHEMA.md`: edit specific lines only and check `git diff --stat FEATURES_AND_SCHEMA.md` before each commit.
- Run only one test process at a time. Tests that need a longer wait get `{ timeout: 5000 }` like the existing ones.
- Every `<button>` has an explicit `type` (use `Button` from `src/components/Button.tsx`). Colours use CSS variables. No new India-only wording (see `CLAUDE.md`).
- Before each commit: `npm run typecheck && npm run lint` and the test files you touched. Before the last commit: the whole `npm run test` once, and `npm run build`.

## Decisions already made by the owner

- Name: **TheraNet Library**. Clinic's own tab: **My exercises** (keep the `library` key and `?tab=library` URL).
- Pictures are AI-generated and checked by the owner for biomechanical correctness; own photography and licensed pictures may follow. Keep a record of the source.
- Record the origin of every copy; library imports **and later public-library imports** count against the clinic's exercise limit (no exemption).
- Public Library, clinic-to-clinic sharing and "Update available" are **out of scope** here.

## Task 1: rename what users see (no behaviour change)

Rename text only. Do not rename the table `starter_exercises`, the component `StarterSetSheet`, types, files or routes.

- Find every user-visible "Starter library" / "Starter" in `src/` (`grep -rni "starter" src --include=*.tsx --include=*.ts`) and read each hit: `LibraryTab.tsx` (button), `StarterSetSheet.tsx` (dialog title and comment), `ExerciseForm.tsx` (section heading, buttons, notices, the confirm dialog text), `ExercisePicker.tsx` if it mentions it, `starterLibraryService.ts` (error text), empty-state copy.
- New wording: "TheraNet Library"; buttons "Share to TheraNet Library", "Update in TheraNet Library", "Remove from TheraNet Library"; notices "Shared to TheraNet Library.", "TheraNet Library entry updated.", "Removed from TheraNet Library.".
- `HepPage.tsx`: `LABELS.library` becomes `'My exercises'`. Update tests that look for the "Library" tab by name.
- `FEATURES_AND_SCHEMA.md`: edit only the lines that say "Starter library" (section 11 and the HEP schema block); say "TheraNet Library (table `starter_exercises`)" once so the table name stays findable.
- Commit: `feat(hep): rename Starter library to TheraNet Library`.

## Task 2: migration `20261118130000_hep_library_curation.sql` (needs the Opus review)

Write the SQL, then stop and have Opus review it before it goes to Claude for applying. The earlier PIN migration had a Postgres error that string-matching tests could not catch, so ask the reviewer to read every `select ... into` and every grant.

1. **Provenance on library items.** `alter table public.starter_exercises add column if not exists image_source text check (image_source in ('own_photography','ai_generated','illustration','licensed'))` and `add column if not exists image_note text check (length(image_note) <= 200)`.
2. **`publish_starter_exercise` gets two parameters at the end:** `p_image_source text default null, p_image_note text default null`. Drop the live 25-argument overload first (copy its exact signature from `20261118110000_hep_starter_library.sql`), create the new one with the same body plus the two columns in the insert and the `on conflict` update, then `revoke ... from public, anon` and `grant ... to authenticated` with the new signature. Server rule: when `p_media_keys` is not empty, `p_image_source` must not be null, else `raise exception 'Say where the pictures come from.'`. The curator check stays exactly as is.
3. **`public.exercise_origins`:** `exercise_id uuid primary key references public.exercises (id) on delete cascade`, `clinic_id uuid not null references public.clinics (id) on delete cascade`, `source_kind text not null check (source_kind in ('library','public'))`, `source_id uuid not null`, `source_published_at timestamptz`, `imported_by uuid references auth.users (id)`, `imported_at timestamptz not null default now()`. Enable RLS; one select policy `using (public.is_hep_staff(clinic_id))` for `authenticated`; no insert/update/delete policies; `revoke all ... from anon, authenticated` then `grant select ... to authenticated`. No foreign key on `source_id` (the public library table does not exist yet).
4. **`public.record_exercise_origin(p_clinic_id uuid, p_exercise_id uuid, p_source_kind text, p_source_id uuid, p_source_published_at timestamptz default null) returns void`:** `security definer`, `set search_path = pg_catalog, public`. Checks in this order: `is_hep_staff(p_clinic_id)`; the exercise exists in this clinic and is not deleted; `p_source_kind = 'library'` (for `'public'` raise "not available yet"); an **active** row exists in `starter_exercises` with `id = p_source_id`. Then upsert on `exercise_id`, setting `imported_by = auth.uid()`. `revoke all ... from public, anon; grant execute ... to authenticated`.
5. A contract test `src/domain/hepLibraryCurationMigration.test.ts` in the style of the existing migration tests (columns, checks, grants, that the old publish overload is dropped, that `record_exercise_origin` checks staff first).
6. Commit the file and the test. Do not apply it.

## Task 3: publish dialog and bulk publish

- New `src/features/hep/PublishToLibraryDialog.tsx` (props: `open`, `count`, `hasPictures`, `busy`, `onConfirm({ imageSource, imageNote })`, `onCancel`). Fields: **Where do the pictures come from?** (Own photography / AI-generated / Illustration / Licensed), required when `hasPictures`; optional note (200 chars, hint "for example: generated with <tool>, checked by <name>"); a required tick **"I have checked that the movements are shown correctly"** when the source is AI-generated; a required tick **"I have the right to share these pictures with all TheraNet clinics"** when `hasPictures`. Follow the dialog patterns already in `src/components/ui.tsx`.
- `starterLibraryService.publishExercise(clinicId, ex, existingStarterId, provenance)` passes `p_image_source` and `p_image_note` (nulls when the exercise has no pictures). Add `publishMany(clinicId, exercises, provenance, onProgress)`: one exercise at a time, continues after a failure, returns `{ published: number; skipped: Array<{ title: string; reason: string }> }`; exercises with `hidePicturesInLists` are skipped with a clear reason.
- Replace the single-exercise confirm in `ExerciseForm.tsx` with the new dialog.
- Select mode: `LibrarySelectionBar.tsx` gets an optional `onPublish` button **Add to TheraNet Library**, shown only for curator clinics (`isStarterCuratorClinic(clinic)`) and disabled offline. `LibraryTab.tsx` owns the dialog and the result message ("Published 12. Skipped 2: ...").
- Tests: dialog validation, curator-only visibility of the button, `publishMany` skipping hidden-picture exercises and continuing after an error.
- Commit.

## Task 4: record the origin and show room under the free-plan limit

- `hepService.recordExerciseOrigin(clinicId, exerciseId, sourceId, publishedAt)` (RPC `record_exercise_origin`, `source_kind: 'library'`) and `hepService.listExerciseOrigins(clinicId)` (select from `exercise_origins`; returns `[]` when offline or on error).
- `StarterSetSheet.tsx` `add()`: after `saveExercise` succeeds, call `recordExerciseOrigin` for items that came from the database. **Skip** built-in items (their `id` starts with `static-`; there is nothing to link). Failure to record must not undo the import: catch it, and retry once.
- `ExerciseForm.tsx`: for an existing exercise, when online, show the line "Copied from the TheraNet Library on {date}" using the same date helpers as the surrounding code. Nothing when there is no origin.
- **Room under the limit** (same pattern as `ProgramSheet.tsx` line ~114: `ent.enforcementEnabled ? TIER_LIMITS[ent.tier]?.exercises ?? null : null`): in `StarterSetSheet`, when a limit applies, show "Free plan: room for N more exercises" where N = limit minus the clinic's exercises that are not deleted (archived ones count, as on the server). Stop ticking beyond N (including the per-region "select all"), and when N is 0 show the server's wording: "You have reached the free-plan limit of 10 exercises. Visit theranet.in to upgrade." The server still enforces; this is only a courtesy. A later public-library import uses this same path.
- Tests: origin recorded for a database item, not recorded for a built-in item, import still succeeds when recording fails, limit line and tick clamp.
- Commit.

## Task 5: Coverage view (curators only)

- Pure helper `coverageGrid(items: StarterLibraryItem[])` in a new `src/domain/hepCoverage.ts`: rows are the regions in `HEP_BODY_ORDER` (only regions that exist), columns are the six exercise types (an exercise counts under its `phase` and each `alsoPhases`; ignore warm_up / cool_down / other), each cell `{ total, withPictures }`. Unit-test it.
- `LibraryCoverage.tsx` and a **Coverage** toggle in the `StarterSetSheet` header, visible only to curator clinics. A compact table: counts per cell, empty cells highlighted, a total row and column, and "n of m have pictures". Must work at 360px wide (scroll the table inside its own container).
- Commit.

## Task 6: docs

- `FEATURES_AND_SCHEMA.md` (edit lines, do not rewrite): the TheraNet Library paragraph (publish dialog, bulk publish, provenance, coverage, origin, limit rule), the HEP schema block (`image_source`, `image_note`, `exercise_origins`, `record_exercise_origin`), the migration list (one line for `20261118130000_hep_library_curation.sql`).
- `docs/superpowers/plans/2026-11-13-public-exercise-library.md`, the line about `exercises.source_public_id`: replace with "Clinic copies carry their origin in `exercise_origins` (`source_kind` library or public); see `2026-11-18-theranet-library-curation.md`."
- First line of the superseded plan file: add "Superseded by `2026-11-18-theranet-library-curation.md`."
- Commit.

## Task 7: finish

- Run the whole `npm run test` once, `npm run build`, `npm run typecheck`, `npm run lint`. If a test fails, run that file alone before changing anything.
- Do not push. Tell the owner the work is ready; Claude then reviews the diff, dry-runs and applies the migration (with the owner's yes), records the history row, and pushes.
- Manual checks for the owner on a phone and a laptop: the new names; publish three exercises at once with a source; the Coverage table; adding two exercises from the library to a second clinic and seeing "Copied from the TheraNet Library" on them; a free-plan clinic near its limit.

## Where Opus is needed

Only the review of Task 2's SQL. If the owner wants to save Opus, a Sonnet read of that one file is acceptable only if the owner accepts the risk; the previous migration shows why a second look at SQL is worth it.
