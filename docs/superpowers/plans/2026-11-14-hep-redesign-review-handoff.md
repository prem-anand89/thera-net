# HEP Library & Program Redesign — Plan Review & Handoff for Claude

**Reviewed plan:** `docs/superpowers/plans/2026-11-14-hep-library-and-program-redesign.md`  
**Reviewed mockup:** `docs/superpowers/specs/2026-11-14-hep-redesign-mockup.html`  
**Target worktree:** `/home/theranet/TN Project/thera-net-1-hep` (`feat/hep`)  
**Date:** 2026-11-15

---

## Executive Summary

The updated plan (`2026-11-14-hep-library-and-program-redesign.md`) and HTML mockup cleanly resolve the major UX, taxonomy, and patient-flow issues from the initial HEP implementation. Separating the 6 clinical `EXERCISE_TYPES` from the session structure (`Warm-up` / `Main` / `Cool-down` blocks via `program_items.phase`) and adding `positions` is clinically accurate and avoids unnecessary item-table migrations.

Before or during execution of Tasks 1–9, please review the **9 specific findings below** (grouped by severity and mapped to exact tasks and files). Three of them are **functional blockers/regressions** if the current plan text is followed literally.

---

## Part 1: Blockers & Regressions to Patch in the Plan

### 1. [Task 8] Missing `patients(phone)` in `PROGRAM_SELECT` breaks the `"Call"` CTA on red alerts
- **Plan reference:** Task 8 (lines 277–278) specifies that in `ProgramsTab.tsx`, a row whose first alert is `red` renders `"Call"` (`tel:` link built from the patient's phone using the clinic country code helpers) as its primary action.
- **Codebase reality:** In `src/services/hepService.ts:225`:
  ```ts
  const PROGRAM_SELECT = '*, patients(name), therapists(name), program_items(*, program_logs(*)), program_session_feedback(*)';
  ```
  `patients(phone)` is not selected, and `patientPhone` does not exist on `ProgramRow` (`src/domain/hep.ts:179`) or `rowToProgram` (`src/services/hepService.ts:156`).
- **Recommendation:**
  1. Update `PROGRAM_SELECT` in `src/services/hepService.ts:225` to `'*, patients(name, phone), therapists(name), program_items(*, program_logs(*)), program_session_feedback(*)'`.
  2. Add `patientPhone: string | null` to `ProgramRow` in `src/domain/hep.ts` and populate it in `rowToProgram` (`patients?.phone ?? null`).
  3. In `ProgramsTab.tsx`, if the primary alert is `red` but `patientPhone` is `null` (phone is optional on patients), fall back cleanly to `"Open"` (linking to the patient chart).

---

### 2. [Tasks 6 & 7] Moving `"Start from"` into `ExercisePicker` tabs drops `source_template_id` and template title
- **Plan reference:** Task 6 adds `Exercises | Templates | {Patient}'s earlier programs` tabs inside `ExercisePicker.tsx`, and Task 7 (line 258) removes the `"Start from"` section (`Blank` / `Same as last time` / `From a template`) from `ProgramSheet.tsx`.
- **Codebase reality:** Currently, `ProgramSheet.applyTemplate(t)` (`src/features/hep/ProgramSheet.tsx:113-122`) does three things when a therapist starts from a template:
  1. Sets `templateId` (`t.id`), which is passed as `sourceTemplateId` to `hepService.createProgram` so `listTemplates` (`src/services/hepService.ts:315`) increments the template's `used N×` counter.
  2. Pre-fills `draft.title` with `t.title` if `draft.title` is still blank.
  3. Passes `fromTemplate={Boolean(templateId)}` to `HandOverPanel` so the therapist isn't prompted to `"Save as template"` right after prescribing from a template.
  - Because `ExercisePickerProps.onAdd` (`src/features/hep/ExercisePicker.tsx:14`) currently has signature `(items: HepItemInput[]) => void`, moving Templates into the Picker means `templateId` and `t.title` are lost when clicking `Add all N`!
- **Recommendation:**
  1. Extend `ExercisePickerProps.onAdd` to pass optional source metadata:
     ```ts
     onAdd: (items: HepItemInput[], meta?: { templateId?: string; suggestedTitle?: string }) => void;
     ```
  2. When clicking `Add all N` on a template in `ExercisePicker`, call `onAdd(items, { templateId: t.id, suggestedTitle: t.title })`.
  3. When clicking `Add all N` on an earlier program in `ExercisePicker`, call `onAdd(items, { suggestedTitle: prog.title })`.
  4. In `ProgramSheet`, if `meta?.templateId` is provided, set `templateId(meta.templateId)`; if `meta?.suggestedTitle` is provided and `draft.title.trim() === ''`, pre-fill `draft.title`.

---

### 3. [Task 5] Preserving `Archive` / `Delete` / `Restore` in `ExerciseForm.tsx`
- **Plan reference:** Task 5 (lines 198–221) replaces `ExerciseForm.tsx` with 4 folding sections (`1 · Basics`, `2 · Instructions & cues`, `3 · Default dosage`, `4 · Classification`) and a footer (`Cancel · Create progression · Save`).
- **Codebase reality:** `src/features/hep/ExerciseForm.tsx:336-351` currently renders the quiet lifecycle bar (`Archive`, `Delete`, `Restore` with confirmation dialog) for existing exercises. It is not mentioned in Task 5.
- **Recommendation:**
  1. Explicitly keep the quiet `Archive` / `Delete` / `Restore` block at the bottom of the left column (below Section 4, above the footer) when editing an existing exercise, preserving `THERA_NET.md` Rule 3 (*destructive actions placed quietly at the bottom of the body, never beside Save in the footer*).
  2. When clicking `Create progression` in the footer while editing an existing exercise (which starts with all 4 sections folded), automatically unfold **Section 1 (Basics)** and **Section 3 (Default dosage)** so the therapist immediately sees the cloned title and dosage fields they need to adjust.
  3. Keep `positions` optional for the form's `valid` check (even though Section 4's `✓` completion pill checks `positions.length > 0`). Otherwise, opening a legacy exercise (where `positions` is `[]`) just to fix a typo in Section 2 while Section 4 stays folded would leave `Save` disabled with no visible explanation.

---

## Part 2: Architectural & Workflow Gaps

### 4. [Task 7 / Task 8] Fix `HomeProgramNoteLine.tsx` opening `mode="new"` when an active program exists
- **Codebase reality:** In `src/features/hep/HomeProgramNoteLine.tsx:30-43`, `refresh()` fetches `listPatientPrograms`, finds the active program `cur`, stores only a summary object, and hardcodes `<ProgramSheet mode="new" ... />` at line 96.
- **Impact:** Now that Task 7 removes `"Start from -> Same as last time"` from `ProgramSheet`, clicking the patient's active home program pill inside a consultation note will open a completely blank *New home program* dialog instead of editing/progressing their active program.
- **Recommendation:** Update `HomeProgramNoteLine.tsx` to retain `activeBundle: ProgramBundle | null` in state and render `<ProgramSheet mode={activeBundle ? 'edit' : 'new'} bundle={activeBundle ?? undefined} ... />`.

---

### 5. [Task 6] Avoid an unbounded client-side `program_items` query in `exerciseUseCounts`
- **Plan reference:** Task 6 (line 240) adds `hepService.exerciseUseCounts(clinicId): Promise<Record<string, number>>` counting `program_items` per `source_exercise_id`.
- **Impact:** If implemented like `recentlyUsedExerciseIds` (`supabase.from('program_items').select('source_exercise_id, programs!inner(clinic_id)')`), PostgREST's default 1,000-row response limit will silently truncate counts once a clinic prescribes ~150 programs (~6 items each), and pulls thousands of rows to the browser on every Library mount.
- **Recommendation:** Either add a small `security definer` SQL RPC in Task 3's migration (`20261114120000_hep_exercise_positions.sql`) that runs `SELECT pi.source_exercise_id, count(*)::int FROM public.program_items pi JOIN public.programs p ON p.id = pi.program_id WHERE p.clinic_id = p_clinic_id AND pi.source_exercise_id IS NOT NULL GROUP BY 1`, or use a PostgREST view/grouped count with graceful fallback if the migration isn't applied yet.

---

### 6. [Tasks 6 & 8] `tableTypography.test.ts` compliance on new/updated `<table>` elements
- **Codebase reality:** `src/components/tableTypography.test.ts` statically inspects every `<table>` in `src/` to verify `<th>` and `<td>` use the shared typography tokens (`th` and `td` from `src/components/ui.tsx`).
- **Recommendation:** Ensure both the new Library table in `LibraryBrowser.tsx` (Task 6) and the updated Programs table in `ProgramsTab.tsx` (Task 8) import and apply `th` and `td` from `src/components/ui.tsx`.

---

## Part 3: UX / UI & Patient Refinements

### 7. [Task 7] Mobile Settings Summary Card when `needsPatient === true`
- **Plan reference:** Task 7 (lines 260–261) collapses the 7 program settings into a compact summary card (`"Ravi Kumar · 2× daily · 4 weeks..."` + `Edit`) on screens narrower than `desktop:`.
- **Edge case:** When a therapist clicks `"Use for a patient"` on `TemplatesTab.tsx`, `ProgramSheet` opens with `patient={null}` (`needsPatient = true`). If the settings panel starts collapsed on mobile/tablet when `!patient`, the patient search input is hidden inside the collapsed summary card.
- **Recommendation:** Initialize `editSettings` to `true` whenever `needsPatient && !patient` so selecting the patient is immediately visible on mobile/tablet.

---

### 8. [Task 7] Empty state in `ProgramItemsEditor` after removing `"Start from"`
- **Plan reference:** Task 7 removes `"Start from"` at the top of `ProgramSheet`. When a therapist clicks `+ New program` from a patient's chart, the right column starts with 0 exercises.
- **Recommendation:** In `ProgramItemsEditor.tsx`, when `items.length === 0`, show clear quick-start actions inside the empty state (or allow `ExercisePicker` to accept `initialTab?: 'exercises' | 'templates' | 'earlier'`) so the therapist sees immediately that templates and earlier programs live one click away inside `+ Add exercises`.

---

### 9. [Task 4] Hide redundant `All done` / `Skip ›` section header buttons on 1-exercise sections (`HepChecklist.tsx`)
- **Context:** With `SESSION_ORDER` having 9 buckets (`Warm-up`, `Mobility`, `Stretching`, `Activation`, `Strengthening`, `Balance`, `Functional`, `Other`, `Cool-down`), a typical 5-exercise prescription often spans 4 or 5 sections that contain only **1 exercise each**.
- **Impact:** In `src/features/publicHep/HepChecklist.tsx:67-84`, every section header currently renders `All done` and `Skip ›` buttons whenever `open.length > 0`. For a 1-exercise section, that repeats `All done · Skip ›` directly above a single exercise row that already has its own checkbox.
- **Recommendation:** In `HepChecklist.tsx`, render the section-level `All done` and `Skip ›` buttons in the section header only when `open.length >= 2`.

---

## Quick Checklist by Task

| Task | File(s) | Action to Fold In |
| :--- | :--- | :--- |
| **Task 3** | `supabase/migrations/20261114120000_hep_exercise_positions.sql` | Optionally include a tiny `get_exercise_use_counts(p_clinic_id uuid)` RPC (with client fallback) so `exerciseUseCounts` doesn't pull all `program_items` rows to JS. |
| **Task 4** | `src/features/publicHep/HepChecklist.tsx` | Only show section header `All done` / `Skip ›` buttons when `open.length >= 2`. |
| **Task 5** | `src/features/hep/ExerciseForm.tsx` | Keep the quiet `Archive` / `Delete` / `Restore` block at the bottom of the left column body; keep `positions` optional for `valid`; unfold Section 1 & 3 on `Create progression`. |
| **Task 6** | `src/features/hep/LibraryBrowser.tsx`, `src/features/hep/ExercisePicker.tsx` | Pass `meta?: { templateId?: string; suggestedTitle?: string }` in `ExercisePickerProps.onAdd`; support `initialTab`; use `th`/`td` from `src/components/ui.tsx` on the Library `<table>`; ensure `@container` wrapper on `LibraryBrowser` so table/card switch responds to container width inside the Picker. |
| **Task 7** | `src/features/hep/ProgramSheet.tsx`, `src/features/hep/ProgramItemsEditor.tsx` | Apply `meta?.templateId` and `meta?.suggestedTitle` from Picker; default mobile settings card to expanded when `needsPatient && !patient`. |
| **Task 7/8** | `src/features/hep/HomeProgramNoteLine.tsx` | Pass `mode={activeBundle ? 'edit' : 'new'}` and `bundle={activeBundle ?? undefined}` to `ProgramSheet`. |
| **Task 8** | `src/services/hepService.ts`, `src/domain/hep.ts`, `src/features/hep/ProgramsTab.tsx` | Add `patients(name, phone)` to `PROGRAM_SELECT` and `patientPhone` to `ProgramRow` so red-alert `"Call"` links have the phone number; fall back to `"Open"` if `patientPhone` is null; use `th`/`td` from `src/components/ui.tsx`. |
