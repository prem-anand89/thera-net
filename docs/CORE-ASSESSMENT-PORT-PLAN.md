# Porting TheraNet-OS → thera-net — Single Source of Truth

## 0. Why this file exists

`TheraNet-OS` was a ground-up rebuild of this app (new mockup-driven design, custom CSS
design system instead of Tailwind, no router). After two days and several sessions,
testing surfaced a pattern of regressions faster than the rebuild was converging on a
finished state (kebab-menu clipping, Note Editor accordion nesting, a Setup layout CSS
conflict, an entitlement default bug, a TDS/hospital-partner gating gap — several of
these were "fixed" incorrectly in earlier sessions and had to be re-fixed).

Decision made 2026-08-07: **stop rebuilding from scratch, port the genuinely new work
into `thera-net` instead**, and continue developing there. `thera-net` already has
Excel import, a standalone Invoices page, Playwright E2E tests, real URL routing, a
working member-invite flow, and the hospital-partner column gating working correctly —
things the rebuild either dropped or never got to. The one substantial thing the
rebuild has that `thera-net` doesn't is the **Core Assessment / Note Editor** module.

This file is the single place tracking what's being ported, what's already equivalent
in `thera-net`, and exact status — so nothing gets re-derived or re-guessed across
sessions. Update it in the same commit as the code that changes its status, same
convention as `TheraNet-OS`'s own `docs/REBUILD-SOURCE-OF-TRUTH.md`.

## 1. Repo/infra state (as of 2026-08-07)

- `thera-net` GitHub repo: attached to Claude sessions with push access.
- Supabase project: `kzsldbdjrignwxjgbqof` (region ap-northeast-1, org reconnected
  2026-08-07). This is the **old** production-intended project — 1 clinic, 1 patient,
  0 visits at time of writing (not yet in real use). Has a materially richer schema
  than either frontend codebase suggested on its own: `consents`/`consent_form_templates`
  (wired into `NoteEditorPage.tsx` already), a full `audit_log`, and dormant
  (frontend-unwired) tables for `return_to_sport`, `scoliosis_screening`,
  `face_scale`, `facial_palsy` assessments.
- Vercel: deployed to a **new** Vercel account (old one had a sign-in issue), project
  `thera-net` under team `thera-net` (`team_1EXIyudWNMlMwd6VxxeMD7L1`), pointed at the
  Supabase project above via `VITE_SUPABASE_URL`/`VITE_SUPABASE_ANON_KEY`. SSO/Vercel
  Authentication protection disabled (no custom domain). Confirmed live and loading —
  https://thera-net-thera-net.vercel.app

## 2. Full diff: TheraNet-OS vs. thera-net

Verified by reading both codebases directly (line counts, grep for pattern presence),
not assumed.

### 2a. Genuinely new in TheraNet-OS (zero trace in thera-net) — to port

| # | Item | Evidence |
|---|---|---|
| 1 | **Core Assessment / Note Editor** — Initial/Follow-up modes, screening banner, myotomes, NRS/PSFS scales, outcome tracking | thera-net: 347-line plain-text note editor, no payload. TheraNet-OS: 1,220-line `NoteEditorPage.tsx` + 403-line `domain/coreAssessment.ts` |
| 2 | **Contraindication banner / safety flags** on Patient Profile | Depends on #1's payload fields; zero matches in thera-net |
| 3 | **Mobile card view** (flat card list on phone, dense table on tablet/desktop) vs. thera-net's single Tailwind table + horizontal scroll | thera-net: 2 total `sm:hidden`-type occurrences (just the hamburger menu). TheraNet-OS: `.mobile-only`/`.desktop-only` dual layout on every data screen |
| 4 | **Kebab (⋮) dropdown action menu** | Zero matches anywhere in thera-net |
| 5 | **⚙ Columns picker** (optional column show/hide) | Zero matches anywhere in thera-net |
| 6 | **Two-level entitlement/module system** (`clinic_module_settings`/`clinic_subscriptions`-driven bundle+module gating in the UI layer) | No equivalent client-side files in thera-net; it only has the simpler `clinicBillingConfig()`/`hasPartner` check |

### 2b. Refined in TheraNet-OS, not new — reuse thera-net's version or merge ideas

| # | Item | Note |
|---|---|---|
| 7 | Design tokens (`--paper/--surface/--ink/--teal/--rust/--moss`, Fraunces/IBM Plex fonts) | **Already identical** in thera-net's `index.css`. TheraNet-OS added `--amber`/`--slate` on top — port just those two tokens, not the whole palette |
| 8 | Package/stale-package tracking | Already in thera-net (`domain/packageTracking.ts`); TheraNet-OS just added a visual progress bar — cosmetic, low priority |
| 9 | Sync status indicator | thera-net's `SyncBadge.tsx` is **more** capable (failed-entry count, discard-stuck-entry action) than TheraNet-OS's version — nothing to port here, may be worth backporting *from* thera-net *to* nowhere, i.e. non-issue |

### 2c. thera-net has, TheraNet-OS doesn't — do not regress these while porting

| # | Item |
|---|---|
| 10 | Real URL routing (`@tanstack/react-router` — deep links, browser back/forward) |
| 11 | Excel historical import (`features/import/`) |
| 12 | Standalone Invoices browse page (`features/invoices/`) |
| 13 | Playwright E2E tests (`e2e/`, `playwright.config.ts`) |
| 14 | Real member-invite flow (email + role, `list_clinic_members_with_email` RPC) |
| 15 | Hospital-partner column gating (`clinicBillingConfig().hospitalSplit`) working correctly in Reports/print ledger — TheraNet-OS has a confirmed bug here (columns show regardless of the toggle); thera-net does not |

## 3. Core Assessment port — schema diff (verified against live schema)

`thera-net`'s `consultation_notes` (live columns): `id, clinic_id, patient_id,
therapist_id, authorized_session_count, notes_text, status, updated_at, updated_by,
created_by, visit_id`. No payload column.

`thera-net`'s `patient_module_enrollments`: exists as a **table only** — `id,
clinic_id, patient_id, module_type, status, enrolled_at, updated_at, updated_by,
created_by`. Zero references in the frontend (no Dexie table, no repo, no type) —
built fresh, even though the table's already live.

Existing RLS on `consultation_notes` already gates insert/update on
`can_use_module(clinic_id, 'consultation_notes')` — **the module key `consultation_notes`
already exists** (`kind: documentation`). Core Assessment is not a new module in
thera-net's model, it's a richer payload on the existing one. No new module row, no
RLS rewrite needed.

Migration to add (new file in `thera-net/supabase/migrations/`):

```sql
alter table public.consultation_notes
  add column assessment_payload jsonb,
  add column note_mode text check (note_mode in ('initial', 'followup')),
  add column nrs_score int check (nrs_score between 0 and 10),
  add column psfs_mean numeric(3, 1) check (psfs_mean between 0 and 10),
  add column red_flag_count int not null default 0,
  add column enrollment_id uuid references public.patient_module_enrollments (id);
```

(`patient_module_enrollments.module_type` is a plain `text` column, not an FK — reuse
the existing `'consultation_notes'` value, don't introduce a new key or rename the
column. Its CHECK constraint originally only allowed the *other*, frontend-unwired
assessment modules — `gut_screening`/`return_to_sport`/`scoliosis_screening`/
`face_scale`/`facial_palsy` — not `consultation_notes`. Widened in
`20260807000002_allow_consultation_notes_enrollment.sql`, applied 2026-08-07.)

## 4. Ordered task list

- [x] **4.1 Migration** — applied to `kzsldbdjrignwxjgbqof` 2026-08-07
      (`20260807000001_core_assessment_payload.sql` +
      `20260807000002_allow_consultation_notes_enrollment.sql`, the latter found
      while applying the former — see §5). Verified via `information_schema`.
- [ ] **4.2 Domain** — port `src/domain/coreAssessment.ts` + its test from
      TheraNet-OS into thera-net near-verbatim (self-contained, no
      TheraNet-OS-specific imports). Extend thera-net's `ConsultationNote` type
      (`domain/types.ts`) with `assessmentPayload`, `noteMode`, `nrsScore`,
      `psfsMean`, `redFlagCount`, `enrollmentId`. Add a `PatientModuleEnrollment` type.
- [x] **4.3 Data layer** — `patient_module_enrollments` registered in `db.ts`
      (Dexie v8), `CLIENT_WRITABLE_TABLES`, and `sync/engine.ts`'s `SYNC_TABLES`.
      `PatientModuleEnrollmentRepo` added (`get`/`listByPatient`/`getActive`/`put`),
      mirroring `ConsultationNoteRepo`'s shape. `psfsMean` (Postgres `numeric(3,1)`)
      added to `NUMERIC_FIELDS` alongside the existing numeric columns that
      PostgREST can hand back as strings. `rowMapping.ts`'s camelCase↔snake_case
      conversion is fully generic — no per-field changes needed there.
      **Not included**: `patientModuleEnrollments` isn't wired into
      `backupService.ts`'s export/restore bundle (would need a `listByClinic`
      method + a `BACKUP_VERSION` bump) — flagged as a follow-up, not silently
      folded into this step.
- [x] **4.4 Services** — `consultationNoteService.ts` extended with
      `getOrCreateActiveEnrollment` (reuses the active enrollment or creates one),
      `noteModeFor` (empty enrollment → initial, non-empty → followup), and
      `saveAssessment` (payload-aware save writing the four derived scalar fields via
      `computeDerivedFields`). Uses the `consultation_notes` module key throughout
      (not `core_assessment`, which doesn't exist in thera-net — see §3). Required a
      new `listByEnrollment` method on `ConsultationNoteRepo` + a matching Dexie index
      (Postgres already had one, added in the §4.1 migration). The old draft-only
      methods (`startOrContinueDraft`/`saveDraft`/`setStatus`) were left in place at
      this step — still used by the not-yet-replaced `NoteEditorPage.tsx` — and were
      removed in §4.5 once that page was replaced and they became genuinely unused.
      5 new unit tests, including the Initial-vs-Follow-up transition specifically.
- [x] **4.5 UI** — `NoteEditorPage.tsx` replaced wholesale with the TheraNet-OS
      version, rewired to thera-net's actual shapes: routing converted from
      `{patientId, noteId, onClose}` props to `useParams`/`useNavigate`/`Link`
      (`/patients/$patientId/notes/new` and `/notes/$noteId`, matching thera-net's
      existing route table); `ClinicSwitcher` dropped (thera-net's shell already
      provides clinic context, TheraNet-OS's page needed its own); `initials()`
      computed inline (matches `PatientProfilePage.tsx`'s convention — thera-net has
      no shared `initials` util); `consultationNoteService.save()` renamed to the
      already-shipped `.saveAssessment()`. Two features that only existed in
      thera-net's original 347-line file were preserved rather than dropped:
      `useTreatmentConsentStatus` (shown as a chip next to the note-status chip in
      the topbar) and the visit-linkage/`Documenting visit` picker — the latter was
      **not** carried forward: the Core Assessment model attaches notes to an
      enrollment (episode), not an individual visit, per the TheraNet-OS mockup, so
      `visitId` is now just carried through from `existingNote` rather than
      user-selected. The note-history list from the original file was also dropped —
      `PatientProfilePage.tsx`'s "Consultation notes" side card already lists a
      patient's notes, so the editor page doesn't need to duplicate it. `ScaleWidget.tsx`
      ported verbatim alongside it. The now-orphaned draft-only service methods
      (`startOrContinueDraft`/`saveDraft`/`setStatus`) and their tests were removed
      from `consultationNoteService.ts`/`.test.ts` — confirmed unused outside their
      own tests once this page stopped calling them. `npm run typecheck && lint &&
      test && build` all pass (184 tests).
- [x] **4.6 CSS** — ~40 TheraNet-OS classes the ported page needs (`.app-header`,
      `.screen-title`/`.screen-body`, `.pheader`/`.avatar`/`.chip`, `.field-block`,
      `.btn-primary`/`.btn-secondary`, `.setup-card`/`.setup-accordion`/
      `.setup-section*`, `.toggle-chip`/`.chip-row`/`.mini-table`, `.nrs-scale`/
      `.psfs-scale`/`.scale-labels`/`.derived-value`, `.outcome-card`, `.ne-topbar`/
      `.mode-toggle`/`.note-status-chip`/`.carry-forward`/`.screening-banner`/`.sb-*`/
      `.flag-*`) appended verbatim to `src/index.css` as a dedicated "Core Assessment
      / Note Editor" block, per the decision in §2b #7/#8 not to hand-translate 1,220
      lines into Tailwind. Added the missing `--amber`/`--amber-light`/`--slate`/
      `--slate-light`/`--shadow-1`/`--shadow-2` tokens to `:root` alongside thera-net's
      existing tokens (didn't touch or duplicate any existing token).
- [x] **4.7 Contraindication banner / safety flags** — deliberately **not** a literal
      port of TheraNet-OS's design. TheraNet-OS has a manual free-text
      `patient.contraindications` field, set via an "Edit Patient" modal. thera-net
      has no patient-edit UI at all (patients are only created inline from New
      Visit) — building one solely to host this field would be new scope beyond
      what was asked. Asked the user which direction to take; chose instead to
      **derive** the banner from the safety-history fields already captured in the
      Core Assessment note (`anticoagulant.onBloodThinner`, `implants.present`,
      `pregnancyStatus`) — no new data-entry surface needed, since §4.5 already
      built that entry point. `PatientProfilePage.tsx` takes the most recent note
      with a non-null `assessmentPayload` from the `notes` query it already loads
      (most-recently-updated first), and shows a rust-toned banner above the
      identity header listing whichever flags are set; auto-hides when none are
      (matches the "auto-hide at zero/not-applicable" convention). Styled as
      Tailwind to match the rest of this page, not the straight-CSS-port classes
      from §4.6 — Patient Profile is not part of that port. `npm run typecheck &&
      lint && test && build` all pass (184 tests, unchanged — no new tests needed
      for a pure derived-display read).

## 5. Open questions

- Resolved 2026-08-07: `patient_module_enrollments.module_type`'s CHECK constraint
  didn't include `consultation_notes` — widened rather than dropped, so it still
  catches typos/unknown module keys. See §3.
- No other blockers currently open. `patient_module_enrollments.module_type` has no FK
  to `modules.key`, just the CHECK constraint from §3 — left that way rather than
  adding an FK, to match the table's existing shape (the other four module rows it
  references aren't FK-constrained either).
