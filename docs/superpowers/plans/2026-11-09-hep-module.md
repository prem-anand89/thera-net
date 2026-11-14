# Home Exercise Prescription (HEP) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. After each task, use `superpowers:requesting-code-review` to verify the task's diff against the locked rules in this plan before moving to the next task.

**Goal:** Build the clinic-owned Home Exercise Prescription (HEP) module inside TheraNet: therapists create exercises with private R2 media (GIF or 2–4 stills), save templates, prescribe programs onto patients, share a PIN-protected `/p/$token` magic link via WhatsApp (without the PIN in the message), and monitor finished-day adherence and high pain ($\ge 7$).

**Architecture:** Clinic-owned `exercises` (`clinic_id` required; zero starter seed) sync read-only into Dexie (`ALL_SYNCED_TABLES`, not `CLIENT_WRITABLE_TABLES`, clinic-wide across OP/Home/IP) for instant offline browsing, while all writes (`save_exercise`, `save_template`, `create_program`, `update_program`, `copy_template_to_program`, `save_program_as_template`) execute online via `SECURITY DEFINER` Postgres RPCs that enforce Lite-tier caps (10 exercises, 5 active programs) and snapshot exercise fields so library, template, and program edits never flow backward or forward. Media files live in a private Cloudflare R2 bucket (`clinics/{clinicId}/exercises/{id}/{n}`) accessed exclusively via short-lived presigned upload and view URLs; the patient portal (`/p/$token`) mints view URLs only after passing the 4-digit PIN check (with a 5-attempt / 15-minute lockout) and quietly refreshes expiring URLs in memory.

**Tech Stack:** React 18, TypeScript, TanStack Router, Dexie.js (IndexedDB), PostgreSQL / Supabase RLS & RPCs, Cloudflare R2 (SigV4 presigned URLs via Web Crypto), Tailwind CSS with CSS custom properties, Vitest, Testing Library.

**Spec:** Locked Product Plan (2026-11-10 `/grill-me` decisions + UX/PM/Architect review refinements & codebase alignment embedded in this document; supersedes the 2026-11-09 draft).

---

## Global Constraints

- **Do not build out-of-scope items:** No starter exercise library or 50-exercise seed; no public catalog, upvotes, AHP UI, or "Added from public"; no exercise UI on `theranet.in`; no sixth phone tab; no feedback or Google review buttons on `/p/$token` (Book an appointment arrives in Slice 2, amendment 40); no easier/harder exercise variants, week engine, or backend PDF engine (browser `@media print` print-sheet is included); no in-app checkout; no video files or photo-to-animation (1 GIF or 2–4 stills only); **never put the PIN digits (or patient name/PII) in the WhatsApp message** — only include the clinic name, `/p/$token` link, generic `"Use your 4-digit clinic PIN to unlock."` prompt, and consent line.
- **Phase 1 Usability & Speed Boosters (Locked):**
  - **Favorites & Quick Rail (`is_favorite`):** 1-tap star toggle on clinic exercises; Prescribe sheet filters by Favorites first.
  - **1-Tap Duplication:** `duplicate_program` (copies active/past program snapshot into a fresh editable program) and `duplicate_template`.
  - **Native Share Sheet (QR code DEFERRED, owner decision 2026-11-12):** the share sheet shows the WhatsApp `wa.me` button and a one-click link copy. No QR code in this build (no `generateHepQrSvg`, no printed QR).
  - **Browser Print Stylesheet (`@media print`):** Fallback 1-page clean print layout showing clinic name, patient name, 2-column exercise cards, dosage grid, without generating server PDFs.
  - **Active Tab Triage Filters:** Sort/filter running programs by `Needs Attention (Pain ≥ 7 or 0% Adherence)`, `Recent Activity`, or `All`, showing `Last active` timestamp and `Today: X of Y done`.
  - **Blank library (owner decision 2026-11-12):** no blueprints and no prefilled exercises. The empty Library shows "No exercises yet. Add your first exercise" with the add button. How to prefill (if at all) is the owner's later call.
  - **Card timers and the end-of-session check:** hold, timed and rest timers on each exercise card (amendments 41 and 56) and the optional Pain | Effort check after each session (amendment 53). There is no player screen.
- **No new npm dependencies:** Build all UI, SigV4 R2 URL signing (Web Crypto `crypto.subtle`), PIN inputs, soft face blur canvas tool, and player carousels with native Web APIs and existing primitives (`SheetDialog`, `Button`, `ErrorNote`, `Pill`).
- **CSS variables & UI invariants:** Use `var(--teal)`, `var(--ink)`, `var(--border)`, `var(--paper)`, `var(--surface)`, `var(--rust)`, `var(--muted)`. Never hardcode hex values. Every `<button>` must have an explicit `type` attribute. Any `<table>` must satisfy `src/components/tableTypography.test.ts` (primary dates/amounts at 14px `--ink`). Modals use `SheetDialog` with `<ErrorNote>` above footer and quiet destructive Delete at the bottom of the body.
- **Clinic-wide scope across places:** Exercises, templates, and active HEP programs belong to the clinic/patient regardless of `DepartmentContext` (`OP` / `Home` / `IP`) so home programs stay continuous across care settings.
- **Copies, not live links:** Saving a template snapshots `title`, `body_region`, `instructions`, `media_type`, `media_keys`, `sets`, `reps`, `hold_seconds`, `sessions_per_day`, `side`, and `stop_if`. Copying a template to a patient snapshots again into `program_items`. "Save as template" on a program snapshots the program into a new template. Editing the library never mutates saved templates or programs; editing a template never mutates programs.
- **Temporal adherence rules:** Adherence is computed over **finished days only**: `sessions completed ÷ (exercises on the program that day × sessions per day that day)`. Today shows `"Today: 1 of 2 sessions done"` separately from `"Overall habit: X% across finished days"` and does not move the percent until the day ends. Adding an exercise today sets `added_on = today` so earlier days' denominators are untouched. Changing `sessions_per_day` today appends a schedule entry effective **tomorrow** (`today + 1`), keeping today's target unchanged. Removing an exercise sets `removed_on = today` (hiding it from the patient immediately while keeping stored logs for the therapist).
- **Reversible skip:** a skipped session can be undone the same day (Undo, `undo_exercise_skip`), and doing the exercise later overwrites the skip (`submit_exercise_log`). There is no queue and no reordering on the patient page (amendment 41).- **Lite tier caps (server + client):** Lite clinics are capped at **10 non-deleted exercises** and **5 active programs** (`status = 'active'`). Templates, paused programs, and completed programs do not count. Solo, Clinic, Clinic+, or any clinic marked paid in `platform_admin.subscription_payments` (or when `not tier_enforcement_enabled()`) have no cap. When `tier === 'lite' && enforcementEnabled`, show proactive `X / 10 exercises` and `X / 5 active programs` counters (including at the top of `PrescribeProgramSheet`) with guidance to complete older programs or upgrade at `theranet.in`.
- **Private R2 media & auto-refresh:** Store object keys (`clinics/{clinicId}/exercises/{exerciseId}/{n}`), never permanent public URLs. Short-lived (900s) view URLs are minted only for authenticated clinic members or after `get_public_hep(token, pin)` validates the PIN; `/p/$token` keeps the verified PIN in React state only and quietly re-hydrates expiring URLs (~13.5m or single-retry `<img>` `onError`) without returning the user to the PIN gate.
- **Offline rule (a recorded, deliberate EXCEPTION to the app's offline-first design, owner decision 2026-11-12):** HEP is online-only for writes. Browsing cached exercises works offline; saving an exercise, template or program, minting or revoking a link, resetting a PIN and uploading media need a connection and are disabled when offline (with an inline "Needs a connection" note). Reasons: caps and snapshots are enforced by the server, media goes to R2, and the patient portal is online by nature. Record this as an exception in `FEATURES_AND_SCHEMA.md` (Task 9).

---

## Review amendments (2026-11-12) — these OVERRIDE anything later in this file

Decided with the owner after a review against the current code. Where a code block or step below disagrees, this section wins; the blocks below have been patched for items 1 to 5, and the rest are carried by the tasks named.

1. **PIN lockout must persist (bug fix).** A Postgres `raise exception` rolls back the whole call, including the `failed_attempts` update, so the old design never locked. New contract: `public.hep_verify(p_token, p_pin)` returns `(patient_id, outcome, attempts_left)` with `outcome` one of `ok | wrong_pin | locked | unavailable` and **never raises**; the public RPCs (`get_public_hep`, `submit_exercise_log`, `undo_exercise_skip`) return `jsonb` with `ok: true/false`, `reason` and `attemptsLeft`, so the counter commits. `PublicHepPage` and `hepService` read `{ ok, reason, attemptsLeft }` instead of catching errors. **Test against a real database** (not only SQL text): 5 wrong PINs lock, the counter survives, a right PIN after the lock window clears it, and a wrong PIN returns no titles, clinic name or URLs.
2. **PIN is never derived from the phone and never stored in plain text.** `patient_hep_access.pin_hash` (pgcrypto `crypt`/`gen_salt('bf')`, `extensions` on the function search path) replaces `pin_override`. `create_program` generates a random 4-digit PIN the first time a patient gets a link (or takes the therapist's own 4 digits) and returns it ONCE as `pin` so the therapist can tell the patient (by voice or on the printed sheet), never in the WhatsApp message. A new `reset_hep_pin(p_patient_id) returns text` issues a new one. No phone number is needed, so patients without a phone work. Remove `extractExpectedPin` and its tests.
3. **Prescribing never creates a patient.** `create_program` takes an existing `p_patient_id` (required); `p_patient_name`/`p_patient_phone` and the phone-tail lookup are gone. A new patient is added first through the normal Add patient sheet (the app's own patient-number scheme, duplicate checks, Dexie). Drop the "phone-reuse lookup" from `hepService`. No `+91`/10-digit assumption anywhere.
4. **Lite caps live in the shared plan limits.** Add `exercises` (Lite 10, others null) and `activePrograms` (Lite 5, others null) to `TIER_LIMITS` in `src/domain/plans.ts`; mirror them in a `public.hep_tier_limits(p_tier)` SQL function; extend `src/domain/planLimits.parity.test.ts` to compare them (as it does for seats and visits). `LITE_MAX_*` are removed; the UI reads `TIER_LIMITS`. `clinic_has_unlimited_hep` stays as the one HEP helper but must use the same tier/status/payment rule as the existing server plan checks (admissions, roster cap); do not invent a variant.
5. **Public link safety.** `hep_verify` returns `unavailable` when the link is revoked (`patient_hep_access.link_revoked_at`), the patient is hidden (`patients.deleted_at is not null`) or the program set is empty. New `revoke_hep_link(p_patient_id)` and "Stop sharing" in the patient's Exercises tab. `rotate_hep_token` also clears the revoked flag. A one-line consent note belongs in the share sheet ("This link shows the patient's exercises. Share it only with the patient."). Health data stays behind token + PIN; retention follows the patient (hard delete cascades; hidden stops the link).
6. **The day a log counts for is the clinic's, not the phone's.** `submit_exercise_log`/`undo_exercise_skip` ignore any client date beyond a sanity check and use `platform_admin.clinic_today(clinic_id)`; a client `p_log_date` is accepted only if it is today or yesterday in the clinic's zone (a patient finishing just after midnight), otherwise today is used.
7. **Storage stays on Cloudflare R2** (owner decision: Supabase storage limits). Keep the edge-only signer, but add `[functions.hep-media] verify_jwt = false` to `supabase/config.toml` (the function authenticates the caller itself: a user JWT for clinic uploads and previews, token + PIN for patient views), document the three secrets (`R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, plus bucket name) in the deploy notes, and note the object-key prefix check is the access rule.
8. **Deferred (owner decision 2026-11-12):** the in-clinic QR code. Kept: favourites (`is_favorite`, star, favourites first in the Prescribe sheet), templates, duplication, the browser print sheet (without a QR).
9. **Patient pain reports notify the therapist (new, owner request).** See Task 1b.
10. **Backup and docs.** `exercises`, templates, programs, items and logs are included in `backupService` (absent in older backups) or the docs state exactly what is not backed up; Task 9 also records the online-only exception, the PIN/lockout contract, the `/p/` route in `isPathAllowedDuringClinicOnboarding` and `Shell` bypass, and a `noindex` header for `/p/*` in `vercel.json`.
11. **Order.** Build the Inpatients/nav-redesign plan first (it removes Settings from `NAV` "with room for HEP"); HEP's Exercises entry then lands in `Shell.tsx` without a conflict.
12. **Migration:** `20261113200000_hep_module.sql` and `20261113200100_hep_pain_push.sql` (renumbered 2026-11-13: the newest repo migration was `20261113100000_one_screen_onboarding_rpc.sql`). After applying, make `schema_migrations` hold this file's version and name (CLAUDE.md).

13. **Who can use HEP (owner decision 2026-11-12): admins and therapists only, to create, edit and prescribe. Front desk gets no Exercises tab, no route, no patient Exercises tab, no More row and no data.** Server: `public.is_hep_staff(clinic)` (member and not front desk) replaces `is_clinic_member` in every HEP policy, RPC and in `hep-media`, so front desk cannot read the tables even by calling the API; the exercises sync simply returns no rows for them. Client: `usePermissions` gains `canUseExercises` (admin or therapist); `Shell` `filterNavItems`, `MorePage`, the `/exercises` route (redirect to Workspace), `PatientViewTabs` and Note Section 8's button all check it. Test: a front-desk user sees no entry anywhere and the RPCs refuse.
14. **Exercise type under each region (new).** Every exercise, template item and program item carries `phase`: Warm-up, Stretching, Mobility, Activation, Strengthening, Balance, Functional, Cool-down, Other (`EXERCISE_PHASES`, default Other). Library: region chips, then a second row of type chips; the list groups by region then type. Prescribe sheet and the patient's program list order items by `EXERCISE_PHASES` (stable within a type, by the therapist's drag order), so a patient sees warm-up first and cool-down last. The patient portal shows the type as a small label. Copied and snapshotted exactly like `body_region`.
15. **Blank library (owner decision):** no blueprints and no seed; how to prefill is decided later.
16. **Region chips come from the clinic's own exercises** (with counts), a **Favourites** chip first. Region is free text with suggestions from the clinic's existing regions plus a short default list in the form.
17. **Library rows** show thumbnail (or a text-only mark), title, region, type, default dose, a star, and "in N programs" (live active programs whose items came from it, via `source_exercise_id`); 10 at a time with the app's show-more pattern; search matches title, region and type. Tapping a row edits it.
18. **Exercise sheet:** dose is chosen by **kind** (Reps, Reps with hold, Timed; amendment 62 replaced the earlier `dose_unit`); hold is a stepper (5, 10, 30 s) plus a typed value; side reads None, Left, Right, **Each side**; media choices read "Text only", "One GIF", "2 to 4 photos"; the blur is an optional "Blur a face" tool with the line "Only upload photos of people who agreed" and no privacy promise; a note says defaults can be changed per patient; hint "Programs already given to patients keep their own copy"; Save is disabled offline with "Needs a connection"; unsaved-changes guard; Delete says existing programs are unaffected.

19. **Finding one exercise in several places (owner request).** Three facets, not one category:
   - **Main region** (`body_region`, one value): where the exercise lists and groups.
   - **Also under** (`also_regions text[]`, any number): extra regions it should appear under when filtering (a bridge is Hip main, also Core and Pelvic floor).
   - **Equipment** (`equipment text[]`, any number): a multi-select from `HEP_EQUIPMENT` plus "Other" typed names. Filtering "Theraband" returns every exercise tagged Theraband, in any region.
   - **Type** (`phase`, one value) as in item 14.
   Filters combine: choices inside one facet are OR (Shoulder or Knee), facets together are AND (Theraband AND Shoulder AND Strengthening). An exercise matches a region chip if the chip is its main region or is in `also_regions`. The list groups by main region, so nothing is shown twice. Equipment is **snapshotted** onto template and program items so the patient page can say "You will need: Theraband". Region/also-regions are not snapshotted (the program only needs the main region for grouping).
20. **Fixed starter lists** in `src/domain/hep.ts`, matched case-insensitively and canonicalised so "shoulders" and "Shoulder" are one: `HEP_REGIONS` = Neck, Shoulder, Elbow / Wrist / Hand, Spine / Back, Hip, Knee, Ankle / Foot, Core, **Face**, **Pelvic floor: Women**, **Pelvic floor: Men**, Whole body (chips show "Pelvic floor" as one group with Women and Men inside it); `HEP_EQUIPMENT` = None, Theraband / resistance band, Dumbbell, Ankle weight, Swiss ball, Foam roller, Towel, Chair, Wall, Step, Stick / wand, Pulley, Balance board, Mat. Clinics may type another name in either list; it is stored canonicalised and shown as a chip for that clinic. Filtering runs in memory over the Dexie cache (a library is hundreds of rows, not thousands), no server index.
21. **Sensitive regions.** For Pelvic floor (either) the sheet recommends "Text only" and shows "Don't upload photos of the patient"; for Face, the blur tool is off by default (the face is the content) with the same consent line. These are notes, not blocks.
22. **Library filter UI:** region chips (Favourites first), a Type chip row, and an **Equipment** dropdown (multi-select with counts, "Theraband (6)") beside Search; an active-filters line with "Clear"; the count reads "12 exercises". Chip counts count memberships (main or also).

23. **Pictures in the Library (owner question 2026-11-12).** The Library has a **List | Grid** switch (remembered per device; List default on the Library, Grid default inside the Prescribe picker because prescribing is done by looking). 
   - **List row:** a 56 px square thumbnail, then title, dose and the "also under / equipment / in N programs" line. **Grid tile:** 3 across on phones, 4 to 6 on desktop, picture with the title under it and a star.
   - **Text-only exercises** never show an empty box: in List a neutral tile with a small document mark and the type initial; in Grid a typographic tile (the title set large on the tile, type label below), so a mixed region looks deliberate and rows stay aligned. Photos, GIFs and text tiles are the same size.
   - **Thumbnails are small:** on upload the browser also makes a ~160 px WebP of the first still (or the GIF's first frame) and stores it at `.../thumb` (`exercises.thumb_key`). Lists never download a GIF or full photo. A GIF is a still in lists and only plays in the edit sheet and the patient player.
   - **Lazy and batched:** view URLs for thumbnails are minted by `hep-media` in one batched call for the rows currently on screen (IntersectionObserver), 900 s, refreshed on scroll; no request for rows off screen.
   - **Offline:** metadata comes from the Dexie cache, so the list works offline with the text tile standing in for pictures; thumbnails return when online.
   - **Sensitive regions:** rows whose main or also-regions include Pelvic floor show the text tile in every list and grid (the picture is visible only inside the edit sheet and on the patient's page), so nothing private shows on a shared screen. Face rows show their thumbnails normally.
   - **Selecting a region** shows that region's exercises with pictures in the current view; it does not switch views.

24. **Face rows show their pictures normally** (owner decision); only Pelvic floor is hidden in lists (item 23).
25. **GIFs are made outside the app** (the app only accepts a ready GIF up to 1 MB (amendment 76), or 2 to 4 photos; no video). The GIF box in the exercise sheet carries a collapsed **"How to make a GIF"** help: "Record a short clip (5 to 10 seconds) on your phone. Turn it into a GIF with a free converter such as ezgif.com (video to GIF), Canva or Giphy. Keep it short and small (about 480 px wide, 10 frames a second) so it stays under 2 MB. No GIF? Choose 2 to 4 photos instead." The sheet rejects a larger file with "That GIF is over 2 MB. Make it shorter or smaller, or use photos." Tool names are suggestions and their screens change, so the help names no buttons.

26. **Templates screen (owner decisions 2026-11-12).** Row = title, the exercises grouped in session order (warm-up first), "Needs: Theraband, Towel" (union of equipment), "used N times", last edited; no "Snapshot copy" pill. Tapping a row opens the editor; the one main action is **Use for a patient** (patient picker, then the Prescribe sheet pre-filled); Duplicate and Delete live in the ⋮ menu. Editor: name, optional one-line **note** (`exercise_templates.note text`, searched with the name), exercises ordered by type with the dose editable per item, a Grid picker to add exercises, the line "Editing a template never changes programs already given", Save disabled offline. Empty state "No templates yet. Save a program as a template, or build one."
27. **Active screen (owner decisions).** **Mine | All** like the Workspace: therapists default to Mine, admins to All (a therapist can switch to All to see colleagues' programs). Filter row (not beside the title): **Needs attention** (unreviewed pain of 7 or more, a worse check-in, or no activity for 2 or more days) and **All**; needs-attention rows sort first. Columns: Patient, Program, Last active, Today (2 of 3), Habit (shows "Too early" until 2 finished days), Signal pills. Phones show cards, not the table. Row ⋮ menu: Open chart, Pause, Mark completed, **Message patient** (item 31). **Inactivity prompt:** 21 days with no log shows "Inactive 21 days. Mark completed?" so forgotten programs stop using the Lite cap. Empty state "No active programs. Prescribe from a patient's chart or from a template."
28. **Pain review is shared, stored on the program.** `programs.pain_reviewed_through timestamptz` plus `public.mark_pain_reviewed(p_program_id) returns void` (is_hep_staff), set when any therapist opens the program's Exercises view. The "Pain 8/10" signal and the Exercises-hub count of unreviewed reports show only session-feedback rows with `pain_score >= 7` and `created_at > pain_reviewed_through` (amendment 53); a new report of 7 or more shows again. This replaces the per-device storage in Task 1b.
29. **Progress tracking in the patient's Exercises tab (therapist view).** Source: `program_logs` (done = row with `skipped = false`; **Skipped** = row with `skipped = true`; **Not done** = no row once the day has finished). Layout: (a) header with Habit % over finished days, finished-days count, current streak, last active, and a small trend of session pain and effort per day (amendment 53); (b) a 14-day strip, one cell per day (all done, partly done, missed, today, not started yet), tap a day; (c) the day opens as a timeline like "What you've completed": Morning / Afternoon / Evening sessions, each exercise with a tick and the time, "Skipped" or "Not done", and the pain score chip; (d) per-exercise adherence over the program ("Wall Slides 9 of 10 sessions"). Skipped and not-done are always different words and colours. Everything dates by the clinic's day (item 6).
30. **End-of-day check-in from the patient (new).** After the last session of the day the portal asks "How are you feeling today?" with Better / Same / Worse and an optional note (200 characters). Table `program_checkins (id, program_id, log_date, feeling smallint check (feeling in (1,2,3)), note text, created_at, unique (program_id, log_date))`, written by `submit_hep_checkin(p_token, p_pin, p_program_id, p_feeling, p_note)` returning `{ ok, reason? }` like the other public calls (clinic day, never raises on a bad PIN, not in a revoked/hidden link). Shown in the day timeline. **Worse**, or a note, sends the same push as a high pain report (one switch, renamed "Patient exercise alerts") and sets the Active signal "Worse today". Pelvic floor and sensitive notes: the push body never includes the note text.
31. **Reminders and check-ins (owner question).** v1 is therapist-initiated: **Message patient** (Active ⋮ menu and the patient's Exercises tab) offers three presets, each editable before sending: "Reminder to do your exercises", "How are you feeling with your exercises?", "Time for a check-in with us" (clinic name and `/p/$token` link only, no PIN, no patient name or health details). It sends through the existing `whatsappSend` path (Business API when the clinic has it on, otherwise wa.me) and is logged with a new `message_log.kind = 'hep_reminder'` (add it to the kind check in the migration). **Check-in date:** an optional "Check in on" date when prescribing (`programs.checkin_on date`, default 7 days, can be none); on that date the program shows the signal "Check-in due" in Active until the therapist messages the patient or reviews the program. Automatic daily nudges are future scope (needs the Business API with an approved template and patient consent).

32. **Skip reason (owner decision, now in scope).** When a patient skips a slot the page offers one tap: Pain, No time, Forgot, Didn't understand, Other (optional, can be left blank). Stored as `program_logs.skip_reason text check (skip_reason in ('pain','no_time','forgot','didnt_understand','other'))`; `submit_exercise_log` gains `p_skip_reason text default null` (update the signature in the grant lines and the contract test); a skip with reason `pain` counts as a pain signal in Active ("Skipped for pain"). Shown in the day timeline next to "Skipped". Check-in wording stays Better / Same / Worse (owner), default check-in date 7 days, and `message_log.kind` gains `hep_reminder` (owner: yes).
33. **Program length and the minimum (new).** At prescribe the therapist picks **Length**: 1 week (default), 2 weeks, 3 weeks, 4 weeks or Ongoing (`programs.duration_days smallint null`, 1 to 90, null = ongoing; the end date is `start_date + duration_days - 1`, worked out on read) and **Minimum to count as completed** (`programs.target_pct smallint default 70 check between 1 and 100`, under "Advanced"). The goal is "habit over the finished days of the program is at least the minimum". Logs after the end date no longer move the percent. Template items carry no length (set per program).
34. **Automatic end-of-program screen on the patient page.** When the program's last day has finished, the page opens on an outcome screen before the list (the list stays available underneath as "Keep doing these until your therapist updates them"). The percent is computed on the page from the same finished-day math (`computeProgramAdherence`), not a second copy in SQL; the server stores what was shown.
   - **Met:** "Well done! You finished your program (92% of your sessions). Please contact <clinic name> to plan your next step." plus **Message the clinic** (wa.me to the clinic phone when the clinic has one; otherwise just the clinic name) and one tap on how it felt: Too easy / About right / Too hard, plus an optional note.
   - **Not met:** "This was hard to keep up. What got in the way?" with chips (Pain, No time, Forgot, Didn't understand the exercises, Felt better, Other) and an optional note, then "Please contact <clinic name>".
   - Stored in `program_outcomes (id, program_id unique, outcome 'met' | 'not_met', habit_pct smallint, reasons text[], difficulty smallint null (1 easy to 3 hard), note text, submitted_at)` via `submit_hep_outcome(p_token, p_pin, p_program_id, p_reasons text[], p_difficulty smallint, p_note text) returns jsonb` (the same `{ ok, reason? }` shape, clinic day, one outcome per program, ignored before the end date). The patient is asked once; reopening shows the thank-you.
   - **Therapist side:** the program shows "Ended" in Active with the outcome ("Met 92%" or "Not met: Pain"), a push to the prescribing therapist ("<Patient first name> finished their program (92%)" or "did not meet the minimum: <reason>"; no note text), and the actions **Extend** (+1, +2 or +4 weeks), **Mark completed** and **Prescribe next**. If the patient never opens the page, the program shows "Ended: no response" and the Message patient preset "Your program has ended. How did it go?" is one tap away.
   - A program that has ended and is untouched goes to Completed on its own after 21 days of no activity (item 27), so it stops using the Lite cap.
35. **If the therapist does not open the app (owner question).** Three layers, all on the existing infrastructure:
   - **Instant push** (already in item 9 and 30): pain of 7 or more, Worse or a note, program ended. Needs the device's push switch; the Workspace's notification reminder already nudges people to turn it on.
   - **The evening agenda email** (`send-agenda`, pg_cron, one row per therapist per day in `agenda_log`) gains an **Exercise programs** block: unreviewed pain, "Worse" check-ins, no activity for 2 or more days, check-in due, ended with no response. Only shown when there is something; no patient health details beyond first name and the signal. Email is the fallback for people who never turn push on.
   - **Re-reminders:** a pain report still unreviewed after 24 hours sends the therapist one more push; after 48 hours the clinic's admins get one. (A scheduled check, like the other cron jobs, with the same hook secret; one reminder per report, tracked on the log row.) Nothing re-reminds forever.
   The therapist sees each patient's last activity in Active (item 27). A therapist's own last login is not tracked or shown.

36. **Patient chart Exercises tab (owner decisions 2026-11-12).** Top to bottom: program header (title, status, "Day 4 of 7", minimum, prescribed by) with the actions **Share link** (main), **Message patient** and a ⋮ menu (Edit program, Duplicate, Save as template, Pause, Mark completed, Extend, Reset PIN, Stop sharing); signal pills (pain not reviewed, check-in due, worse today, ended); a **Patient link** card (sharing on or stopped, last opened, Copy link, Reset PIN, Stop sharing); the summary band (Today, Habit with finished days, Streak, Last active); the 14-day strip and day timeline; per-exercise adherence; check-ins. The PIN is shown once, only when created or reset. Several programs: active ones as cards, past ones under "Completed (n)" with their outcome. Tab dot while pain is unreviewed; opening the program marks it reviewed (item 28). Empty state "No exercises yet." with Use a template and Pick from library. Offline: actions disabled with "Needs a connection". The WhatsApp message reads: clinic name line, the link, "Use your 4-digit PIN to unlock.", "Share this link only with the patient or the person helping them." (no PIN, patient name or health details).
37. **Prescribe sheet (owner decisions).** If the patient already has an **active program, the default is "Add to current program"** (an edit of that program; no extra Lite slot); "Start a separate program" is the other choice and counts against the cap. Start from: Current program, Template, Earlier program, Library. Items are compact rows ordered by type, expanding to edit sets, reps or seconds, hold, times per day and an optional special instruction for this patient; Add exercise opens the Grid picker (all filters); reorder within a type by dragging. Settings: Title, Length (1, 2, 3, 4 weeks or Ongoing), Start (today or tomorrow), Check in on (7 days by default, 14 days or none), Prescribed by (current user), and under **Advanced**: counts as completed at (50 / 70 / 90 %, default 70) and "Set my own 4-digit PIN (optional)". **The PIN is automatic** (random, hashed); after saving, the sheet shows it once with Copy, then Share on WhatsApp and Copy link. Lite meter only near or at the cap, with a link to Active to complete an older program. When sessions per day change on a live program the sheet says "Today stays 2x; the new number starts tomorrow". Cancel asks "Discard changes?" only if something was edited. Full-screen sheet with a sticky footer on phones.
38. **Note Section 8** keeps its manual rows untouched and gains the read-only line "Digital program: <title>, day N, X%" with one **Open Exercises** link; opening or cancelling Prescribe never marks the note changed.

39. **Remember this phone (owner decision 2026-11-12: option C, link plus PIN, remembered).** After a correct PIN the portal offers a checkbox, **on by default**, "Remember this phone for 30 days". If kept, `hep_remember_device(p_token, p_pin)` returns a random device token once (only its SHA-256 is stored in `hep_device_sessions`); the page keeps it in `localStorage` under a key scoped to the link token and sends it as `p_device` on later calls, so the PIN is not asked again. Rules: it slides 30 days from each use and is capped at 180 days from creation; at most 5 remembered phones per patient (oldest dropped); **Stop sharing, Reset PIN and a new link delete every remembered phone**; a remembered phone is never locked out by someone else's wrong guesses (the device check runs before the lock check) and never counts a wrong attempt; an unknown or expired device token returns `pin_needed` (no attempt counted) and the page shows the PIN screen. The PIN itself is still never stored on the phone. `get_public_hep`, `submit_exercise_log`, `undo_exercise_skip` and `submit_exercise_log`'s siblings (`submit_hep_checkin`, `submit_hep_outcome`) each gain a trailing `p_device text default null` passed to `hep_verify` (update their signatures in the grant lines and the contract test), and `hep-media` forwards it. The `reason` values are now `wrong_pin | locked | unavailable | pin_needed | not_in_program`. UI: untick the box on a shared or borrowed phone; a short "Forget this phone" link in the page footer clears the stored token. Tests: remembered phone opens without a PIN; expired and revoked tokens fall back to the PIN screen; Reset PIN, Stop sharing and rotate clear them; 6th phone drops the oldest; a locked link still opens on a remembered phone; wrong PIN with a stale token counts one attempt, not two.

40. **The patient page is a small web app: Home + Exercises (owner decisions 2026-11-13; these REPLACE the Task 8 "3-screen portal" and the Do/Skip queue, reshuffle, Player, stepper, summary and "no booking buttons" wording in Task 8, Global Constraints and Review Focus).** `/p/$token` has three states, link plus 4-digit PIN only (no phone-number sign-in, no OTP):
   - **Sign in.** Shows the clinic name and logo, the heading **"Your Home Exercise Program"** and "Sign in to see the exercises your therapist prepared for you" (a bare, brandless page looks like a phishing link and people will not trust it). It never shows the patient's name or any program detail before the PIN. The brand comes from a public RPC `hep_clinic_brand(p_token) returns jsonb { name, logoUrl }` that returns the clinic name and logo for a **valid, non-revoked** link and nothing for an unknown or revoked one (generic page then). The logo is the one the public booking page already shows; with none, a 2-letter initial badge. Below it: the PIN field (auto-submit on the 4th digit), **"Remember this phone for 30 days"** (ticked by default, item 39), "Lost your PIN? Ask your clinic for a new one", and wrong-PIN text "That PIN isn't right. 2 tries left." / locked "Too many tries. Please try again in 15 minutes." No "last 4 digits of your phone" hint anywhere, no demo PIN, no developer notes on screen.
   - **Home tab** (after the PIN): "Hi <first name>" (the owner accepts that a forwarded link shows a first name once signed in), a clinic bar with the clinic logo, name and a **Call** button (`tel:` the clinic phone), then cards: (a) **Your current program** (title, "From <therapist first name>", exercise count, "Day N of M", Today: X of Y done, "You have done 5 of the last 7 days", **Open my exercises**); (b) **Next session at the clinic** (date, time, therapist); (c) **Your package** (name, sessions left, valid until); (d) **Other programs** (further active programs, each with Open) and a collapsed **Earlier programs (N)** list (title, dates, exercise count, Completed); (e) **Book an appointment** (opens the clinic's existing public booking page `/book/<booking_slug>`) and **Refer a friend** (item 47). Home never shows invoices, bills or clinical notes (**owner removed these; no request flow either**). The "current" program is the most recently started active one; others active are "Other programs"; completed/ended ones are "Earlier".
   - **Exercises tab:** the cards of one program (item 41). A small blue banner "Updated by Dr. Meera on 12 Nov: Band External Rotation is new" appears after a therapist edit (item 45). Footer: "Not using this phone? **Forget this phone**" (clears the device token, item 39).
   - Data comes from one server call after the PIN: `hep-media` `get_public_hep` returns, in addition to programs and `mediaUrls`, `patientFirstName`, `clinic { name, logoUrl, phone, bookingSlug, referralPhone }`, `cards { appointments, packages, book, refer }` (the clinic's switches, item 48), `nextAppointment { startsAt, therapistFirstName } | null`, and `package { name, sessionsLeft, validUntil | null } | null`. The two extra reads sit in the SECURITY DEFINER RPC behind the same PIN check and return **only those fields** (no price, no notes, no other patients' data, nothing when the switch is off). Each program carries `status`, `startedOn`, `durationDays`, `prescribedByFirstName`, `changeSummary`, `patientNote`, `lastChangedAt` (item 45).
   - Chrome: `<meta name="robots" content="noindex, nofollow">` while mounted (kept), the "Saved" indicator under the clinic name (offline, item 49), bottom tab bar Home | Exercises, 44 px minimum touch targets (this page is for patients of all ages; the 32 px rule of the clinic app does not apply).

41. **Exercises tab = "reference mode with helpers" (owner decision; guided mode, set circles, the rep counter, queue, Do/Skip toggle, reshuffle arrows, the stepper and the summary screen are DROPPED).** Each exercise is a card, collapsed by default (tick, title, dose line, status pill), opened with a tap (one open at a time). An open card shows: the picture(s), moving picture or a text-only tag with the **type** pill (Warm up, Stretching ...); the instructions; **"You will need: <equipment>"** when set; the **dose cells** (item 43); "Each side" when set; the helper timers below; the red "Stop if: ..." line; then the buttons **Mark as done** (primary, 44 px), **Do later** and **Skip**. Wording is fixed by the owner: the primary button reads **"Mark as done"** (not "I have done this"); after it the card shows a Done tag and **Undo**.
   - **Sessions per day (owner confirmed 2026-11-13: Morning / Evening labels).** The data model keeps `sessions_per_day` and the slot logging of Task 3 (adherence math unchanged). Slots are labelled by count, not by clock time: 1 a day shows no label, 2 a day shows **Morning, Evening**, 3 a day shows **Morning, Afternoon, Evening**. A card with more than one slot shows one labelled tick per slot (for example "Morning ✓  Evening ○"), and **Mark as done** logs the **next open slot** ("Mark as done: Evening"); the patient may do any slot at any time. "Do later" and "Skip" also act on the next open slot. **Skip** opens one-tap reasons (Pain, No time, Forgot, Did not understand, Other), stored in `program_logs.skip_reason` (item 32) and undoable with **Undo** (`undo_exercise_skip`).
   - **Do later** is a page-only reminder (item 46).
   - **Timers (the only helpers).** Pure, tested phase builders in `src/domain/hepTimers.ts` (Task 3). Constants: `PT_READY = 5`, `PT_RELAX = 3`, `PT_BACK = 4` seconds, fixed (not patient- or therapist-editable). The patient taps one start button, then it runs without further taps:
     - **Hold exercises** ("Start N holds", N = the patient's reps number): **Get into position (5)**, then for each rep **Hold (the hold seconds)** then **Relax (3)**, and **Back to position (4)** before the next rep (none after the last). Total phases = 1 + 2N + (N - 1).
     - **Timed exercises** ("Start S s"): **Get into position (5)**, **Go (S)**, **Relax (3)**.
     - **Rest** ("Rest R s"): a single phase of the exercise's rest seconds, with **Skip rest**. Never started by itself. Reps-only exercises with no hold or seconds have **no start button other than Rest**.
     - `buildHoldPhases(reps, holdSeconds, eachSide): TimerPhase[]`, `buildTimedPhases(seconds, eachSide): TimerPhase[]`, `buildRestPhases(seconds): TimerPhase[]`, with `TimerPhase = { kind: 'ready' | 'hold' | 'work' | 'relax' | 'back' | 'switch' | 'rest'; label: string; seconds: number; rep?: number; side?: 1 | 2 }` (amendment 56).
     - **Look.** Only **Hold / Go** get the big teal ring (a sweeping stroke with a 52 px number and "HOLD" or "GO", plus "Rep 3 of 10"). **Get into position, Back to position, Relax and Rest** are flat tinted bars (amber for getting into position, blue for relax and rest) with the phase name, a one-line hint and a small number in a circle, so only one big number is ever on screen. Colour is never the only signal (the phase name is always written).
     - **Sound and feel.** A soft short beep on each of the last 3 seconds of any phase; a longer, higher beep when a Hold or Go begins; the same two cues as vibration where the device supports it. All inside try/catch (audio and vibration can be blocked). A best-effort screen wake lock while a timer runs (try/catch; released on stop).
     - Starting a timer on another card stops the running one. Closing the card or the page stops it. There is no pause and no saved timer state.
   - **No rep counter, no tempo.** A "count 1, 2, 3 each way" rep display and `tempo` fields were tried in the preview and **parked by the owner "until we figure out something better"**; do not build them and do not add `tempo_*` columns.

42. **Ranges instead of one number (owner question 2026-11-13: yes).** Sets, reps, seconds and hold can each be a range such as "2 to 3 sets", "10 to 15 reps", "20 to 30 s", "hold 5 to 10 s". Rest stays a single number.
   - Schema: next to each existing prescription column (sets, reps, seconds, hold) add a nullable `<name>_max smallint` on **`exercises`, `exercise_template_items` and `program_items`** (copied like the other snapshotted fields); `check (<name>_max is null or <name>_max >= <name>)`. `NULL` means a single number. The RPCs that save and snapshot exercises, template items and program items copy these columns exactly like `side`; the patient-facing JSON carries them.
   - Therapist UI: the exercise form, the template/program item rows and the Prescribe row show the single number with a small **"+ range"** link that reveals an upper box ("to"); the link becomes "- range" and clears the upper value when closed. The summary reads "2-3 sets × 10-15 reps · 5-10 s hold". Validation: upper not below lower.
   - Pure helpers in `src/domain/doseRange.ts`: `formatDose(value, max): string` ("10", "10-15" with an en dash), `isOutsideRange(actual, min, max): 'below' | 'above' | null` (inside the range, endpoints included, returns `null`).
   - Patient page: the dose line and cells show the range; **the timers and steppers start from the lower number**.

43. **The patient can change the numbers for today (owner decision 2026-11-13: "directly give the option", not a "did you manage it?" question).** The three dose cells on an open card (Sets, Reps or Seconds, Hold) are buttons with a small pencil. Tap one: a **- / +** stepper opens (starts at the lower end of the range, 1 to 99; seconds and hold 1 to 120) showing "Prescribed: 10-15", with **Use prescribed** and **OK**. The timers use the cells' current values ("Start 6 holds"). A value outside the prescribed range turns the cell amber and reads "was 10-15" with the words "your therapist will see this change"; a value inside the range is not flagged.
   - Stored on the day's log: `program_logs.actual_sets smallint null`, `actual_reps smallint null`, `actual_hold_s smallint null` (and `actual_duration_s` for timed exercises, amendment 62). `NULL` means untouched (the prescribed amount). They are sent with the existing `submit_exercise_log` as one optional `p_actual jsonb` argument (`{ sets?, reps?, seconds?, holdSeconds? }`, validated 1 to 120, ignored when null). The change applies **to that day's log only**; the prescription is never edited by the patient, and tomorrow starts from the prescribed numbers again.
   - **Therapist side.** `isOutsideRange` marks the log "Did less" (below) or "Did more" (above). Shown in the Active "By exercise" rows and the day timeline as "Wed: 7 of 10-15 reps" with an amber **Did less** / **Did more** tag. **It does not change adherence:** a day counts as done when every exercise is marked done (Task 3 math unchanged). Honest limit: a patient who does less and does not touch the cells is logged as having done the prescribed amount (nothing can verify what they did).

44. **Opened but not ticked is a neutral status (owner decision).** Some patients use the page only to look at the positions and exercise on their own. `patient_hep_access` gains `open_count integer not null default 0` and `last_opened_at timestamptz null`; a successful sign-in or a valid remembered-phone unlock (not a failed PIN) adds one **at most once per 30 minutes** (a refresh must not inflate it). The therapist's progress view shows "Page opened: 9 times" and, when there are opens but no ticks, "Opened 5 times, nothing ticked" in a neutral tone. These patients are **not** counted as missed adherence by this wording alone; the percentage math is unchanged.

45. **"Updated by your therapist" banner and the what-changed line (owner decision).** When a therapist saves an edit to a program (not the first prescription), the app writes `programs.change_summary jsonb` (list of `{ title, change: 'added' | 'removed' | 'changed', detail? }`, for example `{ title: 'Wall Slides', change: 'changed', detail: 'sets 3 to 2-3' }`), `programs.patient_note text null` (optional short message from the therapist) and `programs.last_changed_at timestamptz`. The summary is built in TS by the pure `summarizeProgramChanges(before, after)` in `src/domain/programChanges.ts` (Task 3) from the items being saved, not typed by hand. The **Prescribe sheet** shows it before saving in a blue box "What the patient will see when they next open the page" with the optional message field. The patient page shows the banner on the Exercises tab when `last_changed_at` is newer than the time this phone last opened that program (remembered in `localStorage` per link and program, try/catch; dismissable); it lists only added, removed or changed exercises. No push is sent for it in this build (item 46).

46. **Do later, reminders and install (owner decisions).**
   - **Do later** is a page-only snooze chip set on the card ("In 1 hour", "This evening", "Tomorrow"). It is stored on the phone only (`localStorage`), shows an amber pill on the card and "Do later: ..." in the list; there is **no server record and no notification** in this build. "We will remind you ... on this page" is the exact promise, nothing more.
   - **Push notifications, the patient's own reminder times (up to 3 a day, in the clinic's timezone), notification on program edits, and the install-to-Home-Screen flow are a FOLLOW-UP PHASE (owner: "notifications, yes" for later).** Facts to plan from: Android Chrome can show web-push once the patient allows it; on iPhone it works only after the page is added to the Home Screen (iOS 16.4+); the page is public and has no account, so it needs its own subscription store keyed to the link and device session, and a service worker scoped away from the clinic app's cache. In this build the therapist's WhatsApp reminders (item 31) and an "Add to Home Screen" hint after the first completed exercise (a one-line, dismissable card) are the whole reminder story.

47. **Refer a friend (owner decisions).** A sheet on Home with a ready message and two buttons: **Share on WhatsApp** (`wa.me/?text=...`, patient picks the contact) and **Copy message**. The message is in the patient's own voice with **no patient name and no health information**: "Hi! I have been going to <clinic name> and thought of you. You can book an appointment here: <booking link>. You can also call the clinic on <number>." The number is the clinic's **referral contact** (item 48, defaults to the clinic phone, never a therapist's personal number); the booking link is the existing public booking URL (`booking_slug`). If online booking is off, the booking sentence is left out. **Deferred (separate plans, owner 2026-11-13):** a Google Maps location link and a shareable digital business card.

48. **Settings -> patient page (new, admin only).** `clinics.patient_page jsonb not null default '{"appointments":true,"packages":true,"book":true,"refer":true}'` (one switch per Home card; every key optional, missing means on) and `clinics.referral_phone text null` (null means use the clinic phone). A small card "Patient page" in Settings with those four switches and the Referral contact field. The **Book an appointment** card shows only when the clinic's online booking switch is on (`20261105110000_online_booking_switch`); Settings says so under the switch. Turning a card off removes it from the page **and from the RPC response** (the server omits the data). Gated like the module (`can_use_module`).

49. **Offline behaviour (owner: "allow offline").** Taps (**Mark as done**, Skip with reason, Undo, the changed numbers, the check-in) are queued on the phone (`localStorage` key scoped to the link, entries `{ id, kind, payload, at }`, try/catch) when the call fails or the phone is offline, shown as "Saved on this phone, will upload when online" under the clinic name (otherwise "Saved"), and sent in order when the connection returns (`online` event and the next page load). The server is idempotent for the same day and slot (the logs RPC already upserts one row per slot). **A page reload while offline cannot open it** (nothing about the program is stored on the phone, and the service worker still refuses to cache HTML or the signed media URLs); say so in the docs. The queue is cleared by **Forget this phone**.

50. **Therapist-side changes that follow from items 40 to 49 (owner asked "do we have to update the therapist side?"; the preview Screens 2, 4 and 5 show them).**
   - **Exercise form and the template/Prescribe rows:** the **+ range** links (item 42). No tempo fields.
   - **Program progress view (patient chart Exercises tab) and Active:** "Page opened: N times"; "Opened N times, nothing ticked" (item 44); **Did less / Did more** tags with "Wed: 7 of 10-15 reps" in the By-exercise rows and the day timeline (item 43). A day with a changed number is flagged for the therapist, not penalised. The optional "did less" marker in the **Active needs-attention rule is left for later** (add only if clinics ask).
   - **Prescribe sheet:** the program title is **patient-facing**, so a hint says so ("The patient sees this title on their page. A plain name works best, for example 'Right knee, week 2'"); the what-changed box and optional message (item 45).
   - **Settings -> Patient page** (item 48).
   - Docs: `FEATURES_AND_SCHEMA.md` gets the new columns, the two RPC changes and the offline queue note in Task 9; the "India-only surfaces" list is unaffected (the wa.me share and `tel:` use the clinic's country code via `splitPhone`, never a hard-coded +91).

51. **Wording and tone on the patient page (owner decisions).**
   - **No safety warning when the page opens** (it frightens people before they start). The only generic wording is on the end-of-session Pain check (amendment 53): "Mild discomfort is okay. If it feels sharp or gets worse, stop and let us know."; at 7 or more, "Please contact the clinic if this continues" with the Call button. Stronger text lives only in the exercise's own "Stop if" line.
   - Buttons: **Mark as done**, **Do later**, **Skip**, **Undo**, **Start N holds**, **Rest R s**, **Stop**, **Skip rest**, **Open my exercises**, **Forget this phone**. The end-of-day check-in (item 31: Better / Same / Worse and an optional note) appears at the bottom of the Exercises tab once every card has a status; the end-of-program screens (item 34) replace the list when the program has ended.
   - Percentages: Home leads with "Day 4 of 14" and "5 of the last 7 days" in a friendly line; the adherence percentage stays a therapist number and is not shown to the patient as a score.


## Review amendments, round 3 (2026-11-13): multi-perspective review — these OVERRIDE anything above or below

Owner decisions after a review as architect, UX/UI designer, product manager, therapist/clinic admin, and patients (older, low digital confidence; busy adults; young athletes).

52. **Two release slices (owner decision).** Ship and learn from Slice 1 before building Slice 2.
   - **Slice 1 (Tasks 1 to 9, as amended):** the clinic side (Library, Templates, Active, patient chart Exercises tab, Prescribe sheet, Note Section 8, pain push, WhatsApp share and **Message patient** presets, Reset PIN, Stop sharing); the patient page **without a Home tab**: Sign in (brand, PIN, Remember this phone), the **Exercises** view (cards, timers with each-side and skip, spoken cues, quick tick, Mark as done, Skip with reason, Undo, Morning / Evening slots), the **end-of-session Pain / Effort check** (item 53), the **calendar reminder** (item 57), the open count (item 55) and the rate limit (item 58). Single numbers only (no ranges yet).
   - **Slice 2 (Task 10):** the **Home** tab and its cards (current / other / earlier programs, next session, package, Book, Refer), Settings -> Patient page (item 48), **ranges** and **patient-changed numbers** with Did less / Did more (items 42, 43), the **Updated by your therapist** banner and change summary (item 45), the **offline queue** (items 49, 54), **Do later** (item 46), the end-of-day check-in (item 30), the end-of-program screen and outcomes (item 34), the evening agenda email block and re-reminders (item 35). Slice 2 has its own migration, dated when it starts.
   - Measure Slice 1 before Slice 2: the share of programs whose link was opened within 48 hours, first-week adherence, the share of "opened, nothing ticked" patients, and the time from a pain alert to review.

53. **End-of-session check: Pain or Effort (owner decision; REPLACES the first-session pain slider and `program_logs.pain_score`).** When every exercise of a session (Morning, Evening ...) has a status (done or skipped), a card asks **"How did this session feel?"** with a two-way switch **Pain | Effort**; a small **"Rate this session"** link under the list opens it at any time. Both are optional and skippable ("Not now").
   - **Scale:** eleven large tappable buttons 0 to 10 (no slider; easier for unsteady hands), with words under the scale. Pain: 0 "No pain", 1 to 3 "Mild", 4 to 6 "Moderate", 7 to 10 "Severe". Effort (a 0 to 10 effort scale like Borg CR10): 0 "Rest", 1 to 2 "Very easy", 3 to 4 "Easy", 5 to 6 "Somewhat hard", 7 to 8 "Hard", 9 "Very hard", 10 "Maximum". Pain uses the gentle line "Mild discomfort is okay. If it feels sharp or gets worse, stop and let us know."; at 7 or more it adds "Please contact the clinic if this continues" with the **Call** button.
   - **Which exercise:** below the scale, chips listing the exercises of that session (multi-select): "Which exercise hurt?" on Pain, "Which was the hardest?" on Effort. The patient may fill one side, the other, or both (switching keeps what was entered).
   - **Which side opens first:** a program setting under Prescribe -> Advanced, **"Ask about: Pain (default) / Effort"** (`programs.feedback_default text not null default 'pain' check (feedback_default in ('pain','effort'))`), so a sports program can lead with Effort.
   - **Data:** new table `program_session_feedback (id uuid pk, program_id uuid not null references programs on delete cascade, log_date date not null, session_index smallint not null check between 1 and 3, pain_score smallint null check 0 to 10, effort_score smallint null check 0 to 10, pain_item_ids uuid[] not null default '{}', hard_item_ids uuid[] not null default '{}', created_at timestamptz not null default now(), unique (program_id, log_date, session_index))`, RLS select for `is_hep_staff`, written only by `submit_hep_session_feedback(p_token, p_pin, p_program_id, p_session_index, p_log_date, p_pain, p_effort, p_pain_items uuid[], p_hard_items uuid[], p_device text default null) returns jsonb` (`{ ok, reason? }`, clinic day as item 6, upsert per session, item ids must belong to that program, never raises on a bad PIN). `program_logs.pain_score`, `submit_exercise_log`'s `p_pain` and `ProgramLog.painScore` are **removed** (the Task 1 and Task 3 blocks below are already patched).
   - **Push (Task 1b, patched):** pain 7 or more on a feedback row notifies the prescribing therapist, naming the first marked exercise if any ("Ravi reported pain 8/10 after Wall Slides"; hide-names wording as before). Item 28's unreviewed-pain signal reads `program_session_feedback` rows with `pain_score >= 7` and `created_at > pain_reviewed_through`. Effort never pushes.
   - **Therapist view:** the day timeline shows each session's Pain and Effort chips and the marked exercises; the header's trend line shows session pain and effort per day; By exercise adds "Hurt 2 times · Hardest 3 times".

54. **Offline taps keep their day and session (must fix; Slice 2 with the queue).** Every queued tap stores the **clinic day it happened on** (worked out on the phone with the clinic's time zone, sent in the payload) and the **session number** it was taken against; the server saves that session (it never re-picks "the next open one" for a queued tap). `submit_exercise_log`, `undo_exercise_skip`, `submit_hep_session_feedback` and `submit_hep_checkin` accept `p_log_date` from **today back to 3 days before** in the clinic's zone (replacing item 6's "today or yesterday" for these calls); older taps return `reason: 'too_old'` and the page drops them and says "1 tick from Mon 10 Nov was too old to save". Without a remembered phone the queue waits and sends **right after the next sign-in**.

55. **Count opens only on page load (must fix).** The open count of item 44 is incremented in `get_public_hep` (page load and the R2 refresh are told apart by a `p_reason text default 'open'` the refresh sets to `'refresh'`), never in `hep_verify`, so Mark as done and Skip don't count as opens. Still at most once per 30 minutes.

56. **Timers, round 2 (must fix plus owner yes).**
   - **Each side:** an exercise with "Each side" runs side one, then **"Now the other side"** (amber bar, 5 s, it replaces the second get-ready), then side two; rep numbers restart and the ring shows "Side 2 · Rep 3 of 10". Phase builders take `eachSide: boolean`.
   - **Reliable time:** a phase stores its end time (`Date.now() + seconds * 1000`) and the display is recomputed from it about 4 times a second; never count down by decrementing (phones slow timers when the screen locks).
   - **One sound object:** create a single `AudioContext` on the Start tap (a user gesture) and reuse it; resume it if suspended; everything in try/catch.
   - **Skip the short phases (owner yes):** the amber and blue bars (Get into position, Back to position, Now the other side, Relax, Rest) carry a **Skip** button that ends that phase now. The fixed lengths (5, 3, 4 s) stay.
   - **Spoken cues (owner yes):** the phone says the phase as it starts ("Get into position", "Hold", "Relax", "Back to position", "Now the other side", "Go", "Rest", "Done") with the built-in `speechSynthesis` (no library). A **Sound: Voice | Beeps | Off** switch at the top of the Exercises view, remembered on the phone (`localStorage`, try/catch), default **Voice** where the phone has a voice, else Beeps. Voices differ by phone; English only for now (second language is future scope). Beeps and vibration stay as the fallback.
   - Phase counts for the tests: `buildHoldPhases(10, 5, false)` = 30 phases (1 get-ready + 10 holds + 10 relax + 9 back); with `eachSide = true` = 60 (30 + 1 switch + 29 for side two, no second get-ready); `buildTimedPhases(30, false)` = 3; `buildTimedPhases(30, true)` = 6 (ready, go, relax, switch, go, relax).

57. **Patient page usability (owner yes to all).**
   - **Quick tick:** the tick circle on a **closed** card is a button: one tap marks the next open session done (with Undo in a short toast). Patients who use the page as a reference, and athletes with many exercises, need not open every card.
   - **Which tab opens:** in Slice 2 the page opens on **Exercises** when an active program has something left today, otherwise on Home.
   - **Text size:** body 16 px, instructions 18 px, sizes in `rem` so the phone's text-size setting enlarges them; important text never only in grey; 44 px touch targets.
   - **Discoverability:** the first not-done card starts open on the first visit of the day; closed cards show "Tap to see how" until the patient has opened one once (remembered on the phone).
   - **"Today: X of Y" counts sessions** (exercise × session, so 4 exercises twice a day is "Today: 3 of 8 done"), the same unit as the therapist's adherence.
   - **Calendar reminder (Slice 1):** "Add a daily reminder to my calendar" on the Exercises view. The patient picks a time per session (chips 8 am, 1 pm, 6 pm or a time box); the page creates a `.ics` file (one daily repeating event per session, ending on the program's end date or after 90 days for Ongoing; local floating time so it rings at the phone's own time; title "Exercises · <clinic name>", the `/p/` link in the notes; no patient name or health details) and opens it so the phone's calendar offers to add it. Some in-app browsers block files: if nothing happens the page says "Open this page in your phone's browser to add the reminder".
   - **Caregivers:** the WhatsApp message and the page say **"Share this link only with the patient or the person helping them."** (replaces "This link is only for you. Please don't share it."), because older patients often use a family member's phone.
   - **Local language today:** the Prescribe sheet's per-patient special instruction accepts any language and keyboard; its hint says so ("You can write this in the patient's language"), so therapists can help non-English readers before second-language support exists.

58. **Server shape and abuse limits (must fix).**
   - `get_public_hep` returns the programs (active, plus ended ones awaiting an outcome) and mints media URLs **only for the program being shown** (`p_program_id uuid default null` = the current one). Slice 2 adds a separate `get_patient_home(p_token, p_pin, p_device)` RPC for the Home fields of item 40 (not stuffed into the media call); Earlier programs list titles and dates only until opened.
   - **Rate limit:** the public RPCs call `hep_rate_ok(p_token)`, which reuses the app's existing `public_rpc_rate_limit` table (no new table) but never raises: 60 calls a minute per link and 120 per IP; `hep-media` checks the real client IP with `hep_rate_ok_ip` (the IP check inside the RPC is skipped for the edge function's service role). Over the limit the call returns `reason: 'busy'` and the page says "Please wait a minute and try again". `hep_clinic_brand` is limited the same way. SQL in Task 1 section 13.

59. **Alert policy, written down so nobody adds pushes later.** Push only for: session pain 7 or more (item 53), a **Worse** check-in or a check-in note (item 30), and a program ending (item 34). Everything else (Did less / Did more, opened but nothing ticked, no activity, check-in due, high effort) is an on-screen signal and, in Slice 2, a line in the evening agenda email. No push ever contains a note's text, a PIN, a phone number or a token.

60. **Decisions recorded (owner, 2026-11-13).**
   - **No "don't allow above the range" lock** for post-operative exercises: the patient may go above, and the therapist sees "Did more" (item 43).
   - **Lost PIN stays with admins and therapists.** Front desk has no access to HEP or clinical notes (item 13 unchanged); the clinic's process is that a patient who lost the PIN is passed to their therapist or an admin, who uses **Reset PIN**.
   - **Before Task 1, test "Remember this phone" on real phones** (checklist item 10): open the WhatsApp link on an iPhone and an Android phone, tick Remember, close, reopen from WhatsApp the next day. If the iPhone's in-app browser forgets it, add the line "Tip: open the link in Safari so we remember your phone" under the checkbox on iPhones, and record the result in the docs.


## Review amendments, round 4 (2026-11-13): Library, exercise kind, Edit form — these OVERRIDE anything above or below

61. **Library layout (owner decision; REPLACES the chip rows of items 16, 22 and 23's filter UI).** The preview's Screen 1 shows it.
   - **Desktop and iPad landscape (1024 px and wider):** a fixed **side list** (about 220 px) on the left: ★ Favourites, All exercises, then the regions in **body order** (Face, Neck, Shoulder, Elbow / Wrist / Hand, Spine / Back, Core, Hip, Knee, Ankle / Foot, Pelvic floor, Whole body; clinic-added regions after Whole body, alphabetical), each with its count. Selecting a region opens it and shows its **types underneath with counts** (only types that have exercises, in session order, item 62); Pelvic floor opens to Women and Men first. Empty regions are greyed and not clickable, with a "Hide empty regions" switch at the bottom (remembered per device).
   - **Top bar:** Search, an **Equipment ▾** multi-select dropdown with counts, a **Type ▾** dropdown (for "all stretches" across regions), and List | Grid. Under it, one **active-filters line**: removable chips for what is set, **Clear**, and "12 exercises" on the right.
   - **iPad portrait (768 to 1023 px):** the side list folds into a **Region: Shoulder · Strengthening ▾** button that opens the same tree in a sheet.
   - **Phone:** one horizontally scrolling row of region chips (no wrapping) and a **Filters** button that opens a bottom sheet with Type and Equipment chips and "Show N exercises".
   - **Results:** grouped by region, then type, with headings. **List view is 2 columns at 1024 px and wider** (one card: 52 px thumbnail, title, dose line, one muted line "equipment · also under · in N programs", star); 1 column below. Grid view: 3 tiles a row on phones, 4 on iPad portrait, 5 on desktop. The "3 photos / One GIF" pill is replaced by a small corner mark on the thumbnail. Show 12 more at a time.
   - **Empty results:** "No matches in Shoulder." plus a button "3 in other regions" when the search or filters would match elsewhere.
   - The page subtitle is "Home exercises for all your patients". The Lite meter shows only near the cap (unchanged).
   - Filtering stays in memory over the Dexie cache (item 20). Helpers in `src/domain/hep.ts`: `HEP_BODY_ORDER`, `sortRegionsByBody(regions)`, `regionTree(exercises)` returning `{ region, count, types: { phase, count }[], children?: [...] }[]` (tested: body order, Pelvic floor children, type order, empty regions, also-regions counted).

62. **Exercise kind instead of "Reps / Seconds + Hold" (owner decision).** The therapist picks how the exercise is done; the form shows only what that kind needs.
   - `dose_type text not null default 'reps' check (dose_type in ('reps','hold','timed'))` on `exercises`, `exercise_template_items` and `program_items` (**replaces `dose_unit`**, which is removed everywhere):
     - **reps** (dynamic: squats, band rows): sets and reps; no hold. Patient: "3 sets × 10 reps". Timer: Rest only.
     - **hold** ("Reps with hold": isometrics and static stretches, quad sets, hamstring stretch): sets, reps and **hold seconds per rep**. Patient: "3 sets × 10 reps · hold each for 5 s". Timer: the hold sequence (item 41).
     - **timed** (continuous for a time: marching, single-leg stand): sets and **time in seconds**. Patient: "2 × 60 s". Timer: Get into position, Go, Relax.
   - **Columns (Task 1 tables are patched):** `reps` (and `default_reps` on `exercises`) is now `smallint`, required for reps and hold and null for timed; `hold_seconds` is required for hold and null otherwise; new `duration_seconds smallint` (1 to 3600) is required for timed and null otherwise; new **`rest_seconds smallint not null default 30` (0 to 300)** (there was no rest field anywhere, but the patient timer needs it). On `exercises` the names carry the `default_` prefix (`default_duration_seconds`, `default_rest_seconds`). A check on each table enforces the shape of each kind. All are copied wherever `side` is copied, and `get_public_hep` returns `doseType`, `reps`, `holdSeconds`, `durationSeconds`, `restSeconds`.
   - **Type suggests the kind** (changeable): Stretching, Activation and Cool-down suggest *Reps with hold*; Balance suggests *Timed*; the rest suggest *Reps*. `suggestedDoseType(phase)` in `src/domain/hep.ts`.
   - **Ranges (Slice 2, item 42)** become `sets_max`, `reps_max`, `hold_seconds_max`, `duration_seconds_max` (and `default_*_max` on `exercises`); seconds no longer live in `reps`. Item 43's `actual_*` columns become `actual_sets`, `actual_reps`, `actual_hold_s`, `actual_duration_s`.
   - **Timers (item 41/56) read the kind:** `hold` uses `buildHoldPhases(reps, holdSeconds, eachSide)`, `timed` uses `buildTimedPhases(durationSeconds, eachSide)`, `reps` has only Rest. No guessing from which numbers are filled.
   - **Type order (session order, owner):** `EXERCISE_PHASES = ['warm_up', 'mobility', 'stretching', 'activation', 'strengthening', 'balance', 'functional', 'cool_down', 'other']` (Mobility now before Stretching: moving before holding). The nine types stay separate (owner chose not to merge Mobility with Stretching or Balance with Functional).

63. **Edit exercise form (owner decision; REPLACES item 18's layout).** Four sections in this order; on 1024 px and wider the sheet is wide with two columns (left: 1 and 2, right: 3 and 4), one column below, with a sticky Save.
   1. **Basics:** Exercise name (gentle "An exercise called '…' already exists. You can still save this one."), Main region (body order), Type (session order; choosing it pre-selects the kind, item 62).
   2. **How to do it:** Pictures (Text only | One GIF | 2 to 4 photos, with the GIF help); each photo has an **optional caption** ("Start position", "End position") shown under it to the patient: `media_captions text[] not null default '{}'` (same length as `media_keys` or empty; 40 characters each), copied like `media_keys`; "Blur a face" stays optional with the consent line. **Steps:** the instructions box, one step per line ("Short steps in plain words"); the patient page shows them as a numbered list (split on line breaks; no schema change), with a live "Patient sees" preview. **Stop if:** a text field with one-tap suggestions (Sharp pain, Numbness or tingling, Dizziness, Swelling increases).
   3. **Default dose:** How is it done? (**Reps | Reps with hold | Timed**, with a one-line explanation), then only the fields for that kind, each with quick chips, an "Other" box and **+ range** (Sets: 1 2 3; Reps: 5 8 10 12 15; Hold each rep: 5 10 30 s; Time: 15 30 45 60 s), **Rest between sets** (0 15 30 60 s, no range), **Side** (No side | Left | Right | Each side), **Times a day** (Once | Twice | 3 times), and a **"The patient reads"** summary line ("3 sets × 12 reps · hold each for 10 s · each side · twice a day · rest 30 s"). "Upper is below lower" shows inline.
   4. **Find it later:** **Also show under** and **Equipment** as searchable multi-select dropdowns that show the chosen ones as chips (with "+ Add another…"), not walls of chips.
   - **Preview as patient** shows the patient's card (title, dose line, numbered steps, You will need, Stop if, the timer buttons). Delete stays quiet at the bottom. No storage keys or other developer text on screen.


## Review amendments, round 5 (2026-11-13): naming, Templates, Programs, patient chart, program sheet — these OVERRIDE anything above or below

64. **Names (owner asked for proper naming; use these words everywhere, in UI, code comments and docs).**
   | Where | Name |
   |---|---|
   | Main nav item | **HEP** (owner, 2026-11-13: "catchy to introduce the feature"; replaces "Exercises"; route `/hep`) |
   | Its three tabs | **Library · Templates · Programs** (was "Active"; the tabs carry no counts) |
   | Programs filters | **Needs attention · Active · Ended · Past** (Past = paused and completed) |
   | Program statuses | **Active · Paused · Ended** (past its last day, waiting for the therapist) **· Completed** |
   | Patient chart tab | **Home program** (was "Exercises"; it would clash with the main nav); a red dot while pain is unreviewed |
   | The sheet | **New home program** / **Edit home program**; chart buttons **+ New program** and **Edit program** |
   | Name fields | Template: **Template name (staff only)**. Program: **Program name** ("The patient sees this name. A plain name works best.") |
   | Consultation note | **Section 8: Home exercise program**, with **Open Home program** |
   | Patient page | **Your Home Exercise Program**; tabs **Home · Exercises** (unchanged) |
   Route: `/hep?tab=library|templates|programs` (was `/exercises`); `PatientView` gains `'home-program'`. Code names keep the `hep` prefix.

65. **Templates (owner decisions).** No separate patient title: a template is a staff recipe, and once used for a patient the program is its own copy with its own name, which is what the patient sees (the Prescribe sheet starts the program name from the template name and the therapist edits it). No program defaults on templates (length, Pain/Effort, check-in stay per program). Layout: search and a Region dropdown (regions worked out from the template's exercises); cards, **2 columns at 1024 px and wider**, each with name, note, region pills, exercises grouped in session order, "Needs: …", **"about N min a session"**, "used N times · edited …", and one button **Use for a patient**; Duplicate and Delete in a ⋮ menu; tapping the card opens the editor. The **template editor** uses the shared exercise rows (item 67) with Times a day, + Add exercise (the Library picker), the time estimate, and "Editing a template never changes programs already given to patients."

66. **Programs tab (owner yes; REPLACES item 27's layout).** Mine | All (therapists default Mine, admins All); filters **Needs attention** (default; pain 7+ unreviewed, Worse check-in, no activity 2+ days, check-in due, or Ended), **Active**, **Ended**, **Past**, each with its count; search by patient or program. Table: Patient (links to the chart's Home program; "Started 08 Nov"), Program ("4 exercises · Day 4 of 7"), Therapist (only in All), Today ("3 of 8 sessions"), Habit ("86% · 3 days finished" or "Too early"), Last active, Signals, actions. Signals: Pain 8/10 after <exercise> (red), No activity N days (amber), Check-in due (blue), Opened N×, nothing ticked (grey, not "needs attention"), Met 92% / Not met: Pain (Ended). Actions: **Message** (active) or **Prescribe next** (ended) plus ⋮ (Open Home program, Pause, Mark completed, Extend; for past ones Prescribe again, Duplicate). Phones get cards built from the **same data and rules** as the table, so they never disagree.

67. **One shared exercise-row editor (owner yes).** The template editor, the program sheet and the Edit exercise form's dose section use one component (`ExerciseDoseEditor` in `src/features/hep/`): collapsed row = title, kind, dose line, rest, "only this one: once a day" when overridden, equipment; open row = **How is it done?** (Reps | Reps with hold | Timed), the fields for that kind, Rest, Side, each number as the **same line as the Edit exercise form**: quick chips (Sets 1 2 3; Reps 5 8 10 12 15; Hold each rep 5 10 30 s; Time 15 30 45 60 s; Rest 0 15 30 60 s), an Other box and **+ range** (ranges are Slice 2; in Slice 1 the + range link is hidden), **Times a day** ("Same as the program (twice)" or an override), a per-patient special instruction (program sheet only, any language), "about N min", Remove. Rows are grouped by type in session order.

68. **Times a day is set for the whole program, with a per-exercise override (owner yes).** `programs.sessions_per_day smallint not null default 1 check (between 1 and 3)` (written by `create_program` / `update_program` from `p_settings.sessionsPerDay`; Task 1 patched). Each item keeps its own `sessions_per_day` and schedule (the "today stays, tomorrow changes" rule is unchanged); the sheet shows an override only where an item differs from the program, and changing the program's value updates every item that matched the old value. The patient page labels sessions by the program's number (Morning / Evening ...); an exercise with fewer sessions simply isn't in the later ones.

69. **Session time estimate (owner yes, no warning).** `estimateSessionMinutes(items, programSessionsPerDay, session)` in `src/domain/hep.ts`, pure and tested: per exercise, reps ≈ 4 s each; hold = 5 s get-ready + reps × (hold + 3 s relax) + (reps − 1) × 4 s back; timed = 5 + time + 3; × 2 for each side; × sets; + (sets − 1) × rest; + 20 s to change exercise; rounded to the nearest minute (at least 1). Shown as "About 14 min a session" (or "23 min morning · 18 min evening" when sessions differ) in the program sheet, the template editor and template cards, and in the chart header. **No warning at any length** (owner).

70. **Patient chart → Home program tab layout (REPLACES item 36's order).** Top to bottom: a **program switcher** (active programs as chips, "Completed (n) ▾" with each outcome, **+ New program**); the **header** (name and status, "Day 4 of 7 · twice a day · about 14 min a session · completed at 70% · by Dr Kiran", **Share link** (main), **Message patient**, **Edit program**, ⋮ with Print sheet, Duplicate, Save as template, Extend, Pause, Mark completed, Reset PIN…, Stop sharing); a **Needs your attention** box only when there is something (session pain 7+ with the exercise and time, Worse check-in, check-in due with Message patient, ended with Extend / Mark completed / Prescribe next); **Progress** (tiles: Today in sessions, Habit with finished days, Streak, Last active with "opened N times", session Pain and Effort with a small 4-to-7-day trend; the day strip; the selected day's timeline by session with ticks, skips with reasons, "7 of 10–15 reps", and the Pain / Effort chips with marked exercises); **By exercise** (dose, done, Hurt n×, Hardest n×, Did less / Did more); **Patient link** as one line (sharing on/off, last opened, PIN set, Copy link, Reset PIN…, Stop sharing). The WhatsApp message preview is gone from the tab (it shows in the share step).
   - **Pain review (owner yes, REPLACES item 28's "clears on open"):** opening the tab still sets `pain_reviewed_through` (so the push and the Programs signal clear for everyone), but the box keeps showing that report with **"Reviewed ✓ just now"** for the rest of this visit (component state), and it is gone the next time the tab opens.

71. **The program sheet (REPLACES item 37's layout).** Title **New home program** / **Edit home program · <patient>**. Edit: **Edit current program | Start a separate program**. New: **Start from** Template | Earlier program | Library. **Program name** (patient sees it). **Times a day** for the program (item 68). The exercise rows (item 67), **+ Add exercise** (the Library layout of item 61 as a picker, Grid by default, Favourites first). The **time estimate** (item 69). On edits, the "What the patient will see next time" box with the optional message (item 45). Length, Start, Check in, Prescribed by. **Advanced:** "After each session, ask about **Pain first | Effort first**" (item 53), "Counts as completed at 50 / 70 / 90 %", "Set my own 4-digit PIN". Footer: **Preview as patient**, Cancel, **Save program**. After saving (and after **Reset PIN…**): the PIN once with Copy, **🖨 Print sheet with PIN** (the only moment the PIN can go on paper), Share on WhatsApp, Copy link, and the line that the WhatsApp message never contains the PIN.


## Review amendments, round 6 (2026-11-13): whole-workflow review — these OVERRIDE anything above or below

Owner answered "yes to all" to the workflow review. All of it is **Slice 1** unless marked.

72. **Hand over in clinic (new step after saving).** After **Save program** (and after **Reset PIN…**) the sheet shows the PIN and a **Hand over now** panel with four steps, each a button or a tick:
   1. **Send the link now** (the WhatsApp share, while the patient is in the room).
   2. **Show PIN to patient**: a full-screen overlay with the clinic name, "Your PIN" and the four digits about 96 px tall, so the patient can read or photograph it; **Done** closes it. The PIN never goes in a message.
   3. "Patient opens the link, enters the PIN and keeps **Remember this phone** ticked".
   4. "Try one exercise together".
   The panel polls `hep_link_status(p_patient_id) returns jsonb { firstOpenedAt, lastOpenedAt, openCount }` (is_hep_staff, every 5 s while the panel is open, stops after 10 minutes) and turns step 3 into **"Opened ✓ 10:42"** when the patient's phone opens the page. **Print sheet with PIN** stays as the paper option, and **Skip for now** closes the panel.
   - Data: `programs.first_opened_at timestamptz` (set by `get_public_hep` the first time it shows that program, `p_reason = 'open'` only). Task 1 is patched.
   - **New signal "Link not opened yet"** (amber) when `first_opened_at is null` 48 hours after the program started: it counts as Needs attention in Programs and the chart, with **Message patient** (preset "Here is your exercise program again…"). It is the earliest moment to rescue a program.

73. **Prescribe from the visit, and Progress at the follow-up (owner yes).**
   - The visit / consultation note screen gets a **Home program** button next to Note Section 8 (therapists and admins only, item 13). It opens the same program sheet for that patient, with the start date set to the visit's date. Nothing in the note is marked changed (item 38 unchanged).
   - In **Edit home program**, each exercise row shows its numbers since the program started (or since the last visit, when there is one): "done 6 of 8 · hurt 2× · hardest 3× · did less once", from the same data as the chart. Open rows get one-tap **Progress** chips that change the dose in place: **+1 set**, **+2 reps** (reps and hold kinds), **+5 s hold** (hold kind), **+15 s** (timed kind). The change summary (item 45) records them like any edit.
   - **Repeat:** **+ New program** offers "Same as last time", which starts from the most recent completed or ended program (its items, times a day, and settings), like Duplicate.
   - **Template picker:** "Start from a template" lists recently used templates first, then the ones whose regions match the patient's current program or last visit's region, then the rest alphabetically.

74. **Grow the library while prescribing (owner yes).**
   - **Pick several at once:** the exercise picker (item 61's Library in a sheet) has a checkbox on every card and a sticky "**Add 4 exercises**" button; each comes in with its default dose.
   - **Quick add:** the picker's search shows "Can't find it? **+ New exercise "Bird dog"**" (also a button in the picker's header). It opens a short form: name (pre-filled from the search), main region, type, kind and dose (with the type's suggested kind). **Save and add** saves it to the library through `save_exercise` (Lite cap applies) and adds it to the program. Pictures, steps and tags can be added later from the Library; a library card without pictures or steps shows a small "Add pictures and steps" hint.
   - **Camera:** the Edit exercise form's photos box gets **Take photos** (`<input type="file" accept="image/*" capture="environment">`, one photo at a time, "Photo 2 of 4 · Start position / End position"), next to **Choose photos**. Photos go through the same compression and the optional face blur.
   - **Duplicate as a variant:** an exercise's ⋮ menu (Library card and Edit form) offers **Duplicate…**, which opens the form pre-filled with " (progression)" added to the name.
   - **Archive instead of delete when used:** if a library exercise is used by any template or program, **Delete** becomes **Archive** ("Hidden from the picker. Templates and programs keep their copy."). Archived exercises show under a "Show archived" switch in the Library and can be restored. Uses the existing `exercises.active` column; `save_exercise` gains `p_active boolean default true` (Task 1 patched). Unused exercises can still be deleted.
   - **Optional starter pack (owner yes):** an empty Library shows **Add a starter set** next to "Add your first exercise": about 40 common exercises, **text only** (no pictures), each with name, region, type, kind, a default dose, numbered steps and a stop-if line. The clinic ticks the ones it wants (all ticked by default, grouped by region) and they become ordinary clinic-owned exercises it can edit or delete. The list lives in `src/domain/hepStarterSet.ts`; **the owner (or a physiotherapist the owner names) must review every exercise's wording before it ships**. On Lite (10-exercise cap) the screen says "You can add 10 on the free plan" and allows ticking up to the remaining number. It is offered again from the Library's ⋮ menu later ("Add from the starter set"), skipping names the clinic already has.

75. **The session Pain / Effort check appears once a day by default (owner yes; changes item 53).** It opens by itself only after the **first** session of the day is complete. Later sessions show only the small **Rate this session** link (still saved per session). A pain score of 7 or more always shows the Call line. Nothing else in item 53 changes.

76. **Lighter media on mobile data (owner yes).**
   - **Load on open:** the patient page fetches a card's pictures only when the card is opened (the thumbnails rule of item 23 for therapists is unchanged).
   - **Stable links:** media URLs are signed for the **start of the current 30-minute window** and valid for **60 minutes** (`presignR2Url({ ..., now: startOfWindow(now, 30), expiresInSeconds: 3600 })`), so the same object gets the **same URL** for 30 minutes and the browser cache works; the page re-asks `get_public_hep(..., p_reason = 'refresh')` every 25 minutes or once after an image error (replacing "~13.5 minutes"). Test: two calls 10 minutes apart in one window give identical URLs; a call in the next window gives a different one.
   - **Never overwrite a key:** each upload gets a new key `clinics/{clinicId}/exercises/{exerciseId}/{n}-{8 random chars}` and is uploaded with `Cache-Control: private, max-age=604800` (part of the signed upload). An edited picture gets a new key, so a cached old picture is never shown. The prefix check (`clinics/{clinicId}/exercises/{exerciseId}/`) is unchanged.
   - **GIF limit 1 MB** (was 2 MB): `MAX_HEP_GIF_BYTES = 1024 * 1024`, the error "That GIF is over 1 MB. Make it shorter or smaller, or use photos.", and the "How to make a GIF" help says "about 360 px wide, 8 frames a second, under 1 MB". Task 2 is patched.

77. **Smaller workflow fixes from the same review.**
   - **Save as template prompt:** after the first save of a program that didn't come from a template, the result panel offers once: "Use this again? **Save as template**".
   - **Start where I left off:** the patient page opens the first not-done exercise of the current session (it was the first card of the first visit only).
   - **Changed card highlight (Slice 2, with item 45):** after an edit, the changed cards carry a small "Changed" tag until the patient opens them.
   - **One renderer:** "Preview as patient" in the Edit form, the template editor and the program sheet renders the real `HepExerciseCard` from `src/features/publicHep/` (read-only props), so the preview is exactly what the patient sees.
   - **WhatsApp message** starts with the clinic's name ("Sunrise Physiotherapy: here is your home exercise program"), so patients can find it in their chats.


## Review amendments, round 7 (2026-11-13): library search, long programs, partial sessions, the patient's exercise screen — these OVERRIDE anything above or below

78. **Other names (owner: "Other names").** Each exercise has an optional **Other names** field (staff only, never shown to patients), hint "For example SLR, clams, band. Helps you find it in search." Column `exercises.other_names text[] not null default '{}'` (up to 6, 40 characters each), saved by `save_exercise(..., p_other_names text[] default '{}')`; it is not copied to templates or programs. **Search** (Library, picker, Templates) matches title, other names, region, type and equipment, ignores case, hyphens and a trailing "s", and tolerates one typo in words of 5 letters or more (`matchesExerciseSearch(exercise, query)` in `src/domain/hep.ts`, tested with "slr", "clam", "theraband"/"band", "shoulder raises", "hamstrig"). When saving, a similar existing name or other name shows "Similar: Clamshells (Hip)" (warning only).

79. **Library and picker additions (owner yes).** A **Used this week** row (up to 8 exercises prescribed by this clinic in the last 7 days, most recent first) above Favourites in the Library and the picker. On 1024 px and wider the picker shows a **side basket**: the program being built, grouped by section, with the running count and time and a ✕ to remove, so exercises can be added and removed without leaving the picker. Library rows show one muted line; "also under" appears only while filtering by that region; "created by / last edited by" lives in the Edit form. Desktop keys: "/" focuses search, Enter opens the focused card.

80. **Sections in long templates and programs (owner yes).** The exercise type is a real **section** everywhere a program or template is shown: a header with the name, count and time ("Warm-up · 4 exercises · ~5 min"), collapsible, sticky while scrolling inside it, **Collapse all / Expand all** in the sheet and the template editor, and "+N more" when a section has more than 3 exercises and is not expanded. Template cards show section counts ("Warm-up 4 · Mobility 3 · Strengthening 5 · 12 exercises · about 25 min") and expand to the names. Total count and time stay at the bottom (no warning). No schema change: sections come from `phase`.

81. **Doing only some sections (owner yes to all three).**
   - **Section actions on the patient page:** each section header has **All done** and **Skip ›** (one reason for the whole section: Pain, No time, Too hard, Forgot, Other). They write the same per-exercise logs as single taps (one row per exercise and session, the reason on each), so Undo and adherence work unchanged. `program_logs.skip_reason` gains `'too_hard'` (Task 1 patched).
   - **Optional exercises (therapist):** an **Optional** switch per exercise row in the program sheet and template editor (and "Make the whole section optional" in the section's menu). Column `optional boolean not null default false` on `exercise_template_items` and `program_items`, copied like `side` (Task 1 patched, JSON key `optional`). The patient sees an "Optional" tag; optional exercises **are not counted** in Today, the habit % (`computeProgramAdherence` and `isOutsideRange` ignore them) or "Continue", and their section shows "optional" instead of a count.
   - **The pattern signal:** when one section has been skipped or not done on 4 of the last 5 finished days while the rest was done, the chart's Needs your attention box and the Programs Signals show "Skipping Strengthening: 4 of last 5 days" (on screen only, amendment 59), and Progress shows a **By section** line ("Mobility 90% · Strengthening 30%"). `sectionAdherence(items, logs, days)` in `src/domain/hep.ts`, tested.

82. **The patient's Exercises view: a checklist, then one exercise per screen (owner yes; REPLACES the expanding cards of items 41, 56 and 57 in the patient page layout; the timers, sounds and logging rules are unchanged).**
   - **Checklist screen:** program name and "Day 4 of 14 · Today: 3 of 8 done"; a **session switch** at the top when there is more than one session a day (**Morning 2/4 | Evening ✓**), chosen once, so every row has **one** tick for that session; the one-line "Updated …" banner with ✕; sections as cards (item 80/81) with rows: a large square tick (one tap marks done, tap again to undo, with an Undo toast), the name (+ "Optional"), a short dose ("3×12·5s", "2×20s · each side") and a small picture tile that opens the exercise; one big **▶ Start: <first exercise>** / **▶ Continue: <next not done>** button; "<Session> done ✓" when finished; the Pain/Effort check (item 75) and **Rate this session**; Forget this phone.
   - **The header** carries 🔔 (the daily reminder, item 57) and 📞 Call as icons; the Sound switch moves into the exercise screen.
   - **The exercise screen** (full screen over the list): top bar "‹ List · 2 of 4 · ‹ › · sound icon (Voice → Beeps → Off)"; the **picture** (photos with dots and the caption; GIF; or the title on a tinted tile for text-only); the name; the dose as **one line in words** ("3 sets · 12 reps · hold 3 s"; tapping it opens the number change in Slice 2); a muted line ("each side · needs a light band · morning session"); the **Start** / **Rest** buttons; "How to do it": numbered steps, **open the first time the patient opens that exercise, then collapsed** to the first step with "▾"; the "⚠ Stop if" line; a fixed bottom bar **Skip** and **✓ Done · Next ›** (marks this session done and opens the next not-done exercise; after the last one it returns to the list, where the session check appears). When done: **Undo** and **Next ›**.
   - **Timer over the picture (owner to confirm after seeing the preview):** while Hold or Go runs, a dark translucent layer covers the picture with the white ring, "HOLD"/"GO", the number and "Side 2 · Rep 3 of 10"; the short phases (Get into position, Relax, Back to position, Now the other side, Rest) show as a tinted band along the bottom of the picture with the number and **Skip ›**, leaving the picture visible. **Stop** replaces the Start buttons while a timer runs. If the owner rejects it after previewing, the fallback is the earlier layout (ring below the picture, item 56).
   - Grammar: "1 set", "1 rep" (never "1 sets").
   - Components: `HepChecklist.tsx` (sections, rows, Continue) and `HepExerciseScreen.tsx` replace `HepExerciseCard.tsx`'s expanding body; "Preview as patient" (item 77) renders `HepExerciseScreen`.

---

## Before Task 1 (checklist, 2026-11-12)

1. Confirm the Dexie head in `src/lib/db.ts` is still `version(27)`; if another feature took 28, use the next free number everywhere this plan says 28.
2. Confirm the newest file in `supabase/migrations/` is older than `20261112110000`; if not, renumber both HEP migrations above it.
3. Confirm `main` is clean (other sessions edit `router.tsx`, `Shell.tsx` and `PatientProfilePage.tsx` often); commit or stash theirs first.
4. Build the server half first: Tasks 1, 1b, 2 and 4 (no screens), then the domain helpers (Task 3), then the screens (5 to 8), so a nav or router merge conflict cannot block the database work.
5. The nav redesign has landed (`NAV` is Workspace, Schedule, Ledger, Reports; Settings and the clinic switcher live in the header and account menu). The Exercises entry is added to `NAV`, `navActive.ts` and More on phones, with the header width checked against the Place switch.
6. The patient profile shows the Visits/Invoices tabs only when billing allows (`showInvoicesTab`). The Exercises tab must show regardless: test it with Invoices hidden (IP billed by the partner).
7. Wording: the current names are Place with `OP · Home · IP` (`departments.ts`), not "DepartmentContext". HEP is clinic-wide and ignores the selected Place.
8. `public/hep-preview.html` is an untracked preview file of unknown owner; decide whether it ships with HEP or is deleted before the first HEP commit.
9. **SQL status (2026-11-13):** Slice 1 schema and RPCs are written out in Task 1 (exercise kind columns in the create tables, amendment 62; section 6b: program length / minimum / check-in / pain review / feedback default columns, `skip_reason`, open count, `message_log` kind, `program_session_feedback`; section 13: rate limit, `hep_clinic_brand`, `get_public_hep`, `submit_exercise_log`, `undo_exercise_skip`, `submit_hep_session_feedback`, `mark_pain_reviewed`). Copying is literal too: `save_exercise`, `save_template` (with the template `note`), `create_program` / `update_program` (with `p_settings jsonb` for length, minimum, check-in and the Pain/Effort default), `copy_template_to_program`, `save_program_as_template` and both duplicates copy the kind, rest, captions and equipment. Fixed on 2026-11-13: `duplicate_program` passed `current_date` into `p_source_template_id`, and `duplicate_template` / `duplicate_program` had broken `$$` quotes. `hep_verify` used a bare `patient_id` that clashes with its own result column (every PIN check would have failed); its table columns are now qualified. All of Task 1, Task 1b and the Task 10 SQL were run on a local Postgres 16 with stand-ins for the app's existing tables, and the copy, PIN, lockout, log, feedback, rate-limit and Home calls were exercised. The Slice 2 SQL is in Task 10.
10. **Test Remember this phone on a real iPhone and Android phone, opened from WhatsApp (amendment 60), and record the result before building Task 8.**

---

## Future scope (not in this build; recorded 2026-11-12)

- **Second-language instructions.** The clinic picks one second language in Settings (for example Telugu, Hindi, Tamil). Each exercise gets optional second-language **instructions** and **stop-if** text (the therapist types or pastes it with their own keyboard; the app does not translate), copied into templates and programs like the English text. The patient page gets an English | second-language toggle and falls back to English for any empty field. Needs a font that covers the script on `/p/*`, and a note that the text is written by the clinic. Possible later add-on: an optional AI "Suggest translation" button (online only, therapist must review).
- **Exercise tags** (position, equipment, condition) if the type and region filters stop being enough.
- **Prefilling the library** (decided later by the owner).
- **Printed note with the digital program (owner, 2026-11-12):** the printed or PDF consultation note includes the patient's exercises with their pictures and instructions as at the note's date. The layout is the owner's to decide later; the data to support it (snapshotted exercise text, media keys, dose) already sits on `program_items`.
- **Patient accounts** (a patient profile with phone number and PIN or password, linked to the app): not decided; the owner chose link plus PIN with a remembered phone (item 39) for now. An account could later claim the existing `patient_hep_access` row.
- **In-clinic QR code** for the share sheet.
- **Automatic reminders** to patients (a daily nudge when no session is done by a set time), through the WhatsApp Business API with an approved template and patient consent.
- **Patient notifications and install (owner 2026-11-13, "notifications, yes" for a follow-up phase):** web push, the patient's own reminder times (up to 3 a day), notifying a phone when its program is edited, and the install-to-Home-Screen flow (amendment 46 has the constraints).
- **More Home cards in a separate plan:** the page is built so cards can be added later. Not decided yet.
- **Digital business card** (a shareable clinic page with logo, address, call and WhatsApp buttons, hours and Book now) and a **Google Maps link** field on the clinic profile: separate small plan; the Refer message will then link to the card.
- **Referral credit and adherence credit:** a clinic-chosen credit or discount for a successful referral or for sticking to the program, to motivate the next visit. Needs a referral code in the booking link and a clinic opt-in; optional, only if clinics want it.
- **Rep tempo counter** ("count 1, 2, 3 out and back"): tried in the preview and parked until a better design exists.
- **Guided session mode** (step-by-step with auto-advance and resume): dropped for now because it depends on good media for every exercise.
- **Video to GIF inside the app:** accept a short phone video and convert it in the browser (size-capped), replacing the outside-the-app step.

---

## Review Focus

1. **Lite cap bypass or off-by-one:** A Lite clinic attempting to create an 11th non-deleted exercise or a 6th `active` program (including by unpausing a paused program or copying a template) must be rejected by the server RPC with a clear free-plan limit message, while editing an existing active program or creating templates must succeed at the cap; proactive UI meters show only when `tier === 'lite' && enforcementEnabled`.
2. **Snapshot isolation across all three layers:** Modifying or deleting a library exercise after it was added to a template and prescribed to a patient must leave both the template's items and the patient's `program_items` (and `get_public_hep` output) completely unchanged.
3. **Same-day dosage edit, mid-program addition, & reversible skip / reshuffle math:** Adding a new exercise on Day 3 must not inflate the expected session denominator on Days 1–2; changing `sessions_per_day` from 2 to 3 on Day 3 must keep Day 3's target at 2 and apply 3 starting on Day 4; skipping morning slot 1 keeps slot 2 available while allowing within-session undo/completion (`undo_exercise_skip` only deletes rows where `skipped = true`), and there is no queue reshuffling any more (amendment 41).
4. **PIN leakage, pre-PIN data exposure, & URL expiry recovery:** Calling `get_public_hep` with a wrong PIN must return zero clinic info, zero exercise titles, zero program names, and zero signed R2 URLs; locking triggers on the 5th consecutive wrong attempt for 15 minutes (auto-submit pauses while locked); `buildHepWhatsAppShareUrl` must never include the PIN digits or patient name; 15m URL expiry auto-refreshes quietly in memory.
5. **Note editor dirty-state & codebase drift alignment:** Opening and cancelling `PrescribeProgramSheet` from `NoteEditorPage` (Section 8) or `SessionNoteEditorBody` must not flip the note's unsaved-changes guard; `exercises` syncs cleanly (`exercises_tombstone`, `exercises_updated`, `supabase_realtime`); `patients` queries use `deleted_at is null`, `updated_at`, and `mrno_source = 'auto'`; `<PatientViewTabs>` renders `Visits` + `Exercises` even when billing/invoices tab is hidden.

---

## File Structure

```
supabase/
  ├── migrations/
  │   └── 20261113200000_hep_module.sql          # Tables, RLS, Lite cap checks, PIN lockout, RPCs
  └── functions/
      ├── _shared/
      │   └── r2Presign.ts                              # Edge-only Web Crypto AWS SigV4 URL signer & URL hydrator
      └── hep-media/
          └── index.ts                                  # Edge function minting upload URLs & PIN-gated view URLs

src/
  ├── domain/
  │   ├── hep.ts                                        # Types, PIN normalizer, finished-day adherence, target-sticks & per-slot skip math
  │   ├── hep.test.ts                                   # Unit tests for all domain rules (§10)
  │   ├── onboarding.ts                                 # Allows /exercises & /patients during exercise-first signup
  │   └── onboarding.test.ts                            # Tests for exercise-first onboarding path
  ├── lib/
  │   ├── r2MediaKeys.ts                                # Browser-safe key builder & clinic prefix validator (zero secrets)
  │   ├── imageCompression.ts                          # Client canvas 1280px WebP compressor & soft natural face blur (privacy)
  │   ├── imageCompression.test.ts                     # Tests for dimension caps, WebP conversion & blur bounds
  │   ├── r2Presign.test.ts                             # Unit tests for media key validation, PIN gating & Edge URL hydration
  │   └── db.ts                                         # Dexie version(28): exercises read-only cache
  ├── services/
  │   ├── hepService.ts                                 # Online RPC wrappers (existing patient only), R2 upload/view calls
  │   └── hepService.test.ts                            # Service tests (Lite cap error mapping, snapshot payloads, PIN returned once)
  ├── features/
  │   ├── hep/
  │   │   ├── ExercisesPage.tsx                         # /exercises 3-tab hub: Library ("Created here"), Templates, Active
  │   │   ├── ExercisesPage.test.tsx                    # Tests for Library, Templates, Active tabs & Lite cap notice
  │   │   ├── ExerciseFormSheet.tsx                     # Add/edit clinic exercise (GIF or 2–4 stills, sessions/day 1..3)
  │   │   ├── TemplateFormSheet.tsx                     # Create/edit template & copy onto patient
  │   │   ├── PrescribeProgramSheet.tsx                 # Prescribe from template or blank pick-list, edit program, save as template
  │   │   ├── PrescribeProgramSheet.test.tsx            # Tests for prescribe flow & zero dirty leak on cancel
  │   │   ├── PatientExercisesTab.tsx                   # Patient chart Exercises tab
  │   │   ├── PatientExercisesTab.test.tsx              # Tests for patient chart programs, adherence, pain >= 7 highlight
  │   │   ├── hepSharing.ts                             # wa.me URL builder (link + clinic name + generic PIN prompt, ZERO PIN digits)
  │   │   └── hepSharing.test.ts                        # Tests verifying link & generic PIN prompt present and PIN digits/PII absent
  │   ├── publicHep/
  │   │   ├── PublicHepPage.tsx, HepSignIn.tsx, HepExercises.tsx, HepExerciseCard.tsx, HepTimer.tsx, HepSessionCheck.tsx, hepCalendar.ts   # Slice 1 (Task 8)
  │   │   ├── HepHome.tsx, HepReferSheet.tsx, useHepOfflineQueue.ts, HepCheckin.tsx, HepProgramEnd.tsx                                    # Slice 2 (Task 10)
  │   │   └── *.test.tsx next to each
  │   ├── patients/
  │   │   ├── PatientViewTabs.tsx                       # Adds 'exercises' tab to PatientView (visible even when billing/Invoices tab is off)
  │   │   ├── PatientProfilePage.tsx                    # Mounts PatientExercisesTab & renders PatientViewTabs without billing gate
  │   │   ├── NoteEditorPage.tsx                        # Section 8 "Prescribe exercises" button opening PrescribeProgramSheet cleanly
  │   │   └── SessionNoteEditorBody.tsx                 # Non-dirtying "Prescribe exercises" button in session note
  │   └── more/
  │       └── MorePage.tsx                              # Widens MoreItem union & adds More -> Exercises link on phones
  ├── components/
  │   └── NavIcons.tsx                                  # Adds IconExercises stroke icon
  └── app/
      ├── navActive.ts                                  # Adds /exercises to MainNavPath, activePhoneTab (/more), PAGE_TITLES
      ├── Shell.tsx                                     # Adds Exercises to desktop NAV (width-checked with DepartmentSwitch) & /p/ unauthenticated bypass
      ├── ShellNav.test.ts                              # Updates NAV assertions for /exercises
      └── router.tsx                                    # Registers /exercises, /p/$token, and widens PatientProfile view search to include 'exercises'
```

---

### Task 1: Database Migration, RLS, Lite Caps & Security Definer RPCs

**Files:**
- Create: `supabase/migrations/20261113200000_hep_module.sql`
- Create: `src/domain/hepRpcContract.test.ts`

**Interfaces:**
- Consumes: `public.is_clinic_member(uuid)`, `public.generate_url_safe_token()`, `public.tier_enforcement_enabled()`, `public.clinic_plans`, `platform_admin.subscription_payments`, `public.patients`
- Produces:
  - Tables: `public.exercises`, `public.exercise_templates`, `public.exercise_template_items`, `public.programs`, `public.program_items`, `public.patient_hep_access`, `public.program_logs`
  - RPCs:
    - `public.save_exercise(...) returns uuid` (enforces the Lite exercise cap from `hep_tier_limits`)
    - `public.save_template(...) returns uuid`
    - `public.create_program(...) returns jsonb` (existing patient only, enforces the Lite active-program cap, snapshots items, ensures the `patient_hep_access` token and returns `{ programId, patientId, token, pin }` where `pin` is set once when a PIN was generated or chosen)
    - `public.update_program(...) returns void` (enforces 5-active-program Lite cap when activating/unpausing, schedules `sessions_per_day` changes for tomorrow, soft-removes removed items via `removed_on`)
    - `public.copy_template_to_program(p_template_id uuid, p_patient_id uuid, p_therapist_id uuid, p_custom_pin text) returns jsonb`
    - `public.save_program_as_template(p_program_id uuid, p_title text) returns uuid`
    - `public.duplicate_program(p_program_id uuid, p_new_title text default null) returns jsonb` (duplicates an active/completed program into a new draft program)
    - `public.duplicate_template(p_template_id uuid, p_new_title text default null) returns uuid` (duplicates a template for quick variation)
    - `public.toggle_exercise_favorite(p_exercise_id uuid) returns boolean`
    - `public.get_public_hep(p_token text, p_pin text, p_device text default null, p_program_id uuid default null, p_reason text default 'open') returns jsonb`; `public.hep_clinic_brand(p_token text) returns jsonb`; `public.submit_hep_session_feedback(...) returns jsonb`; `public.mark_pain_reviewed(p_program_id uuid) returns void`; internal `public.hep_rate_ok(p_token)` and `public.hep_rate_ok_ip(p_ip)` (service_role)
    - `public.submit_exercise_log(p_token text, p_pin text, p_item_id uuid, p_session_index smallint, p_log_date date, p_skipped boolean, p_skip_reason text, p_device text) returns jsonb` (`{ ok, reason?, attemptsLeft? }`, never raises on a bad PIN)
    - `public.undo_exercise_skip(p_token text, p_pin text, p_item_id uuid, p_session_index smallint, p_log_date date, p_device text) returns jsonb` (same result shape; removes that session's log, done or skipped, so Undo works after Mark as done too)
    - `public.rotate_hep_token(p_patient_id uuid) returns text`
    - `public.revoke_hep_link(p_patient_id uuid) returns void`, `public.reset_hep_pin(p_patient_id uuid) returns text` (new random PIN, shown once), `public.hep_verify(p_token, p_pin, p_device default null)` (internal; returns `outcome`, never raises), `public.hep_remember_device(p_token, p_pin) returns jsonb` (device token returned once), `public.hep_tier_limits(p_tier)`

- [ ] **Step 1: Write the failing migration contract test**

```typescript
// src/domain/hepRpcContract.test.ts
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, it, expect } from 'vitest';

describe('HEP Locked Database Migration Contract', () => {
  const migrationPath = resolve(
    process.cwd(),
    'supabase/migrations/20261113200000_hep_module.sql'
  );

  it('defines clinic-owned tables with sync triggers, no global seed, and no public media_url column', () => {
    expect(existsSync(migrationPath)).toBe(true);
    const sql = readFileSync(migrationPath, 'utf8');

    expect(sql).toContain('create table if not exists public.exercises');
    expect(sql).toContain('clinic_id uuid not null references public.clinics(id)');
    expect(sql).toContain('media_keys text[] not null');
    expect(sql).not.toContain('media_url');
    // No seed rows: the only insert into exercises is the one inside save_exercise.
    const inserts = [...sql.matchAll(/insert into public\.exercises\b/g)].map((m) => m.index ?? -1);
    const saveStart = sql.indexOf('create or replace function public.save_exercise');
    const saveEnd = sql.indexOf('create or replace function public.save_template');
    expect(inserts).toHaveLength(1);
    expect(inserts[0]).toBeGreaterThan(saveStart);
    expect(inserts[0]).toBeLessThan(saveEnd);
    expect(sql).toContain('create trigger exercises_tombstone');
    expect(sql).toContain('create trigger exercises_updated');
    expect(sql).toContain('alter publication supabase_realtime add table public.exercises');

    expect(sql).toContain('create table if not exists public.exercise_templates');
    expect(sql).toContain('create table if not exists public.exercise_template_items');
    expect(sql).toContain('create table if not exists public.programs');
    expect(sql).toContain('create table if not exists public.program_items');
    expect(sql).toContain('create table if not exists public.patient_hep_access');
    expect(sql).toContain('create table if not exists public.program_logs');
    expect(sql).toContain('unique (program_item_id, log_date, session_index)');
  });

  it('uses deleted_at/updated_at on patients and enforces Lite caps, PIN lockout, and reversible skip in RPCs', () => {
    const sql = readFileSync(migrationPath, 'utf8');

    expect(sql).toContain('and deleted_at is null');
    expect(sql).not.toContain('coalesce(deleted, false)');
    expect(sql).toContain('create or replace function public.clinic_has_unlimited_hep');
    expect(sql).toContain('valid_until >= platform_admin.clinic_today');
    expect(sql).toContain('free-plan limit');
    expect(sql).toContain('theranet.in');
    expect(sql).toContain('create or replace function public.hep_tier_limits');
    expect(sql).toContain('hep_tier_limits(');
    expect(sql).not.toContain('v_count >= 10');
    expect(sql).toContain('create or replace function public.hep_verify');
    expect(sql).toContain('create table if not exists public.hep_device_sessions');
    expect(sql).toContain('create or replace function public.hep_remember_device');
    expect(sql).toContain('grant execute on function public.hep_remember_device(text, text) to anon, authenticated');
    expect(sql).not.toContain('pin_override');
    expect(sql).toContain('pin_hash');
    expect(sql).not.toContain('right(regexp_replace');
    expect(sql).toContain('v_new >= 5');
    expect(sql).toContain("interval '15 minutes'");
    expect(sql).toContain('revoke execute on function public.rotate_hep_token(uuid) from public, anon');
    expect(sql).toContain('grant execute on function public.get_public_hep(text, text, text, uuid, text) to anon, authenticated');
    expect(sql).toContain(
      'grant execute on function public.submit_exercise_log(text, text, uuid, smallint, date, boolean, text, text) to anon, authenticated'
    );
    expect(sql).toContain(
      'grant execute on function public.undo_exercise_skip(text, text, uuid, smallint, date, text) to anon, authenticated'
    );
    expect(sql).toContain('grant execute on function public.hep_clinic_brand(text) to anon, authenticated');
    expect(sql).toContain('create table if not exists public.program_session_feedback');
    expect(sql).toContain('create or replace function public.submit_hep_session_feedback');
    expect(sql).toContain('create or replace function public.mark_pain_reviewed');
    expect(sql).toContain('create or replace function public.hep_rate_ok');
    expect(sql).not.toMatch(/create table if not exists public\.program_logs \([^;]*pain_score/); // pain lives on the session check now
    expect(sql).toContain("'hep_reminder'");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/domain/hepRpcContract.test.ts --maxWorkers=2`
Expected: FAIL with `expected false to be true` (migration file does not exist yet).

- [ ] **Step 3: Write the SQL migration file**

Create `supabase/migrations/20261113200000_hep_module.sql`:

```sql
-- Home Exercise Prescription (HEP) — Locked Schema & RPCs (2026-11-10)
-- Clinic-owned exercises (no starter seed), templates, patient programs,
-- session-slot logs, Lite-tier caps (10 exercises, 5 active programs),
-- and 5-attempt / 15-minute PIN lockout.

-- 0. Who may use HEP: clinical staff only (admin and therapist). Front desk has no access to the module at all,
-- like clinical documentation. Every HEP policy and RPC below uses this, never is_clinic_member directly.
create or replace function public.is_hep_staff(p_clinic uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select public.is_clinic_member(p_clinic) and not public.is_front_desk(p_clinic);
$$;
revoke all on function public.is_hep_staff(uuid) from public, anon;
grant execute on function public.is_hep_staff(uuid) to authenticated, service_role;

-- 1. Helper: true when a clinic has unlimited HEP (active Solo+, active paid record, or pilot enforcement off)
create or replace function public.clinic_has_unlimited_hep(p_clinic_id uuid)
returns boolean
language plpgsql
security definer
set search_path = pg_catalog, public, platform_admin
as $$
declare
  v_tier text;
  v_status text;
  v_paid boolean;
begin
  if not public.tier_enforcement_enabled() then
    return true;
  end if;

  select cp.plan_tier, cp.status into v_tier, v_status
    from public.clinic_plans cp
   where cp.clinic_id = p_clinic_id;

  if v_tier in ('solo', 'clinic', 'clinic_plus') and coalesce(v_status, 'active') = 'active' then
    return true;
  end if;

  if to_regclass('platform_admin.subscription_payments') is not null then
    execute 'select exists (
               select 1
                 from platform_admin.subscription_payments
                where clinic_id = $1
                  and voided_at is null
                  and valid_until >= platform_admin.clinic_today($1)
             )'
       into v_paid
      using p_clinic_id;
    if coalesce(v_paid, false) then
      return true;
    end if;
  end if;

  return false;
end;
$$;

revoke all on function public.clinic_has_unlimited_hep(uuid) from public, anon;
grant execute on function public.clinic_has_unlimited_hep(uuid) to authenticated, service_role;

-- The HEP caps per tier. Mirrors TIER_LIMITS.exercises / TIER_LIMITS.activePrograms in src/domain/plans.ts;
-- src/domain/planLimits.parity.test.ts compares them (extend it), like plan_tier_defaults for seats and visits.
create or replace function public.hep_tier_limits(p_tier text)
returns table (exercises int, active_programs int)
language sql immutable as $$
  select v.e, v.p
  from (values
    ('lite',        10,           5),
    ('solo',        null::int,    null::int),
    ('clinic',      null::int,    null::int),
    ('clinic_plus', null::int,    null::int)
  ) as v (tier, e, p)
  where v.tier = p_tier;
$$;

-- 2. Clinic-owned exercises (cached in Dexie for offline browse; written via RPC)
create table if not exists public.exercises (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references public.clinics(id) on delete cascade,
  title text not null check (char_length(btrim(title)) > 0),
  body_region text not null check (char_length(btrim(body_region)) > 0),
  phase text not null default 'other' check (phase in ('warm_up','stretching','mobility','activation','strengthening','balance','functional','cool_down','other')),
  thumb_key text,
  also_regions text[] not null default '{}'::text[],
  equipment text[] not null default '{}'::text[],
  instructions text not null default '',
  media_type text not null default 'none' check (media_type in ('none', 'gif', 'stills')),
  media_keys text[] not null default '{}'::text[] check (
    (media_type = 'none' and cardinality(media_keys) = 0) or
    (media_type = 'gif' and cardinality(media_keys) = 1) or
    (media_type = 'stills' and cardinality(media_keys) between 2 and 4)
  ),
  default_sets smallint not null default 3 check (default_sets between 1 and 20),
  dose_type text not null default 'reps' check (dose_type in ('reps', 'hold', 'timed')),
  default_reps smallint check (default_reps is null or default_reps between 1 and 600),
  default_hold_seconds smallint check (default_hold_seconds is null or default_hold_seconds between 1 and 600),
  default_duration_seconds smallint check (default_duration_seconds is null or default_duration_seconds between 1 and 3600),
  default_rest_seconds smallint not null default 30 check (default_rest_seconds between 0 and 300),
  media_captions text[] not null default '{}'::text[],
  other_names text[] not null default '{}'::text[] check (cardinality(other_names) <= 6),
  constraint exercises_dose_shape check (
    (dose_type = 'reps'  and default_reps is not null and default_hold_seconds is null and default_duration_seconds is null) or
    (dose_type = 'hold'  and default_reps is not null and default_hold_seconds is not null and default_duration_seconds is null) or
    (dose_type = 'timed' and default_reps is null and default_hold_seconds is null and default_duration_seconds is not null)
  ),
  default_sessions_per_day smallint not null default 1 check (default_sessions_per_day between 1 and 3),
  side text not null default 'none' check (side in ('none', 'left', 'right', 'both')),
  stop_if text not null default '',
  is_favorite boolean not null default false,
  active boolean not null default true,
  deleted boolean not null default false,
  version integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists exercises_clinic_updated_idx
  on public.exercises (clinic_id, updated_at desc)
  where not deleted;

alter table public.exercises enable row level security;

create policy exercises_select on public.exercises
  for select to authenticated
  using (public.is_hep_staff(clinic_id));

drop trigger if exists exercises_updated on public.exercises;
create trigger exercises_updated before insert or update on public.exercises
  for each row execute function public.set_updated_at();

drop trigger if exists exercises_tombstone on public.exercises;
create trigger exercises_tombstone after delete on public.exercises
  for each row execute function public.record_sync_tombstone();

alter publication supabase_realtime add table public.exercises;

-- 3. Templates (named recipes with snapshotted items)
create table if not exists public.exercise_templates (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references public.clinics(id) on delete cascade,
  title text not null check (char_length(btrim(title)) > 0),
  note text check (note is null or char_length(note) <= 120),
  deleted boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.exercise_templates enable row level security;

create policy exercise_templates_select on public.exercise_templates
  for select to authenticated
  using (public.is_hep_staff(clinic_id));

create table if not exists public.exercise_template_items (
  id uuid primary key default gen_random_uuid(),
  template_id uuid not null references public.exercise_templates(id) on delete cascade,
  source_exercise_id uuid,
  title text not null,
  body_region text not null default 'General',
  phase text not null default 'other' check (phase in ('warm_up','stretching','mobility','activation','strengthening','balance','functional','cool_down','other')),
  equipment text[] not null default '{}'::text[],
  instructions text not null default '',
  media_type text not null default 'none' check (media_type in ('none', 'gif', 'stills')),
  media_keys text[] not null default '{}'::text[],
  sets smallint not null default 3 check (sets between 1 and 20),
  dose_type text not null default 'reps' check (dose_type in ('reps', 'hold', 'timed')),
  reps smallint check (reps is null or reps between 1 and 600),
  hold_seconds smallint check (hold_seconds is null or hold_seconds between 1 and 600),
  duration_seconds smallint check (duration_seconds is null or duration_seconds between 1 and 3600),
  rest_seconds smallint not null default 30 check (rest_seconds between 0 and 300),
  media_captions text[] not null default '{}'::text[],
  optional boolean not null default false,
  check (
    (dose_type = 'reps'  and reps is not null and hold_seconds is null and duration_seconds is null) or
    (dose_type = 'hold'  and reps is not null and hold_seconds is not null and duration_seconds is null) or
    (dose_type = 'timed' and reps is null and hold_seconds is null and duration_seconds is not null)
  ),
  sessions_per_day smallint not null default 1 check (sessions_per_day between 1 and 3),
  side text not null default 'none' check (side in ('none', 'left', 'right', 'both')),
  stop_if text not null default '',
  sort_order smallint not null default 0
);

alter table public.exercise_template_items enable row level security;

create policy exercise_template_items_select on public.exercise_template_items
  for select to authenticated
  using (
    exists (
      select 1 from public.exercise_templates t
       where t.id = exercise_template_items.template_id
         and public.is_hep_staff(t.clinic_id)
    )
  );

-- 4. Patient programs & snapshotted program_items
create table if not exists public.programs (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references public.clinics(id) on delete cascade,
  patient_id uuid not null references public.patients(id) on delete cascade,
  therapist_id uuid references public.therapists(id) on delete set null,
  source_template_id uuid,
  title text not null check (char_length(btrim(title)) > 0),
  status text not null default 'active' check (status in ('active', 'paused', 'completed')),
  start_date date not null default current_date,
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists programs_clinic_status_idx
  on public.programs (clinic_id, status);
create index if not exists programs_patient_idx
  on public.programs (patient_id, status);

alter table public.programs enable row level security;

create policy programs_select on public.programs
  for select to authenticated
  using (public.is_hep_staff(clinic_id));

create table if not exists public.program_items (
  id uuid primary key default gen_random_uuid(),
  program_id uuid not null references public.programs(id) on delete cascade,
  source_exercise_id uuid,
  title text not null,
  body_region text not null default 'General',
  phase text not null default 'other' check (phase in ('warm_up','stretching','mobility','activation','strengthening','balance','functional','cool_down','other')),
  equipment text[] not null default '{}'::text[],
  instructions text not null default '',
  media_type text not null default 'none' check (media_type in ('none', 'gif', 'stills')),
  media_keys text[] not null default '{}'::text[],
  sets smallint not null default 3 check (sets between 1 and 20),
  dose_type text not null default 'reps' check (dose_type in ('reps', 'hold', 'timed')),
  reps smallint check (reps is null or reps between 1 and 600),
  hold_seconds smallint check (hold_seconds is null or hold_seconds between 1 and 600),
  duration_seconds smallint check (duration_seconds is null or duration_seconds between 1 and 3600),
  rest_seconds smallint not null default 30 check (rest_seconds between 0 and 300),
  media_captions text[] not null default '{}'::text[],
  optional boolean not null default false,
  check (
    (dose_type = 'reps'  and reps is not null and hold_seconds is null and duration_seconds is null) or
    (dose_type = 'hold'  and reps is not null and hold_seconds is not null and duration_seconds is null) or
    (dose_type = 'timed' and reps is null and hold_seconds is null and duration_seconds is not null)
  ),
  sessions_per_day smallint not null default 1 check (sessions_per_day between 1 and 3),
  sessions_schedule jsonb not null default '[]'::jsonb,
  side text not null default 'none' check (side in ('none', 'left', 'right', 'both')),
  stop_if text not null default '',
  special_instructions text not null default '',
  sort_order smallint not null default 0,
  added_on date not null default current_date,
  removed_on date
);

alter table public.program_items enable row level security;

create policy program_items_select on public.program_items
  for select to authenticated
  using (
    exists (
      select 1 from public.programs p
       where p.id = program_items.program_id
         and public.is_hep_staff(p.clinic_id)
    )
  );

-- 5. Patient access token & lockout state (one row per patient)
create table if not exists public.patient_hep_access (
  patient_id uuid primary key references public.patients(id) on delete cascade,
  clinic_id uuid not null references public.clinics(id) on delete cascade,
  token text not null unique default public.generate_url_safe_token(),
  pin_hash text,
  link_revoked_at timestamptz,
  failed_attempts smallint not null default 0,
  locked_until timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Remembered phones (owner decision 2026-11-12, option C): after a correct PIN the patient's phone can be remembered
-- for 30 days of use. Only a hash of the random device token is stored. No policies: the definer functions only.
create table if not exists public.hep_device_sessions (
  id uuid primary key default gen_random_uuid(),
  patient_id uuid not null references public.patients(id) on delete cascade,
  token_hash text not null unique,
  created_at timestamptz not null default now(),
  last_used_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '30 days')
);
create index if not exists hep_device_sessions_patient_idx on public.hep_device_sessions (patient_id);
alter table public.hep_device_sessions enable row level security;

alter table public.patient_hep_access enable row level security;

create policy patient_hep_access_select on public.patient_hep_access
  for select to authenticated
  using (public.is_hep_staff(clinic_id));

-- Staff may read the link state (so the chart can show "sharing on, opened today") but never the PIN hash: a bcrypt
-- hash of a 4-digit PIN can be guessed offline in seconds, which would let any staff member recover a patient's PIN.
-- Clients therefore list columns explicitly (no select *). The remembered-phone table has no client access at all.
revoke select on public.patient_hep_access from anon, authenticated;
-- (the column grant for authenticated follows the open_count / last_opened_at columns, in section 6b)
revoke all on public.hep_device_sessions from anon, authenticated;

-- 6. Session logs (one row per item per calendar day per session_index)
create table if not exists public.program_logs (
  id uuid primary key default gen_random_uuid(),
  program_item_id uuid not null references public.program_items(id) on delete cascade,
  log_date date not null,
  session_index smallint not null check (session_index between 1 and 3),
  skipped boolean not null default false,
  completed_at timestamptz not null default now(),
  unique (program_item_id, log_date, session_index)
);

alter table public.program_logs enable row level security;

create policy program_logs_select on public.program_logs
  for select to authenticated
  using (
    exists (
      select 1
        from public.program_items pi
        join public.programs p on p.id = pi.program_id
       where pi.id = program_logs.program_item_id
         and public.is_hep_staff(p.clinic_id)
    )
  );

-- 6b. Slice 1 columns and tables (review rounds 2 and 3, 2026-11-12/13; amendments 18, 28, 31 to 33, 44, 53, 55)
-- Exercise kind (amendment 62) lives in the create table statements above: dose_type, reps (smallint),
-- hold_seconds, duration_seconds, rest_seconds and media_captions (default_* names on exercises), with a shape check.
-- save_exercise and every item RPC (save_template, create_program, update_program, copy_template_to_program,
-- save_program_as_template, duplicate_*) copy them, and equipment, in sections 7 to 11 below.

alter table public.programs
  add column if not exists duration_days smallint check (duration_days is null or duration_days between 1 and 90),
  add column if not exists target_pct smallint not null default 70 check (target_pct between 1 and 100),
  add column if not exists checkin_on date,
  add column if not exists pain_reviewed_through timestamptz,
  add column if not exists feedback_default text not null default 'pain' check (feedback_default in ('pain', 'effort')),
  add column if not exists sessions_per_day smallint not null default 1 check (sessions_per_day between 1 and 3),
  add column if not exists first_opened_at timestamptz;
-- create_program and update_program write these from their p_settings jsonb argument (sections 9 and 10).

alter table public.program_logs
  add column if not exists skip_reason text
    check (skip_reason is null or skip_reason in ('pain', 'no_time', 'too_hard', 'forgot', 'didnt_understand', 'other'));

alter table public.patient_hep_access
  add column if not exists open_count integer not null default 0,
  add column if not exists last_opened_at timestamptz;

-- Staff read the link state through these columns only (never pin_hash); see the revoke in section 5.
grant select (patient_id, clinic_id, token, link_revoked_at, failed_attempts, locked_until, open_count,
              last_opened_at, created_at, updated_at) on public.patient_hep_access to authenticated;

alter table public.message_log drop constraint if exists message_log_kind_check;
alter table public.message_log add constraint message_log_kind_check check (kind in (
  'feedback_request', 'booking_confirmation', 'therapist_notify',
  'google_review', 'reminder_stale_package', 'reminder_single_visit',
  'payment_reminder', 'hep_reminder'
));
-- (copy the list from the newest migration that sets message_log_kind_check before applying; it was
--  20260918210000_payment_reminder_message_kind.sql when this plan was written)

create table if not exists public.program_session_feedback (
  id uuid primary key default gen_random_uuid(),
  program_id uuid not null references public.programs(id) on delete cascade,
  log_date date not null,
  session_index smallint not null check (session_index between 1 and 3),
  pain_score smallint check (pain_score is null or pain_score between 0 and 10),
  effort_score smallint check (effort_score is null or effort_score between 0 and 10),
  pain_item_ids uuid[] not null default '{}'::uuid[],
  hard_item_ids uuid[] not null default '{}'::uuid[],
  created_at timestamptz not null default now(),
  check (pain_score is not null or effort_score is not null),
  unique (program_id, log_date, session_index)
);
create index if not exists program_session_feedback_pain_idx
  on public.program_session_feedback (program_id, created_at) where pain_score >= 7;

alter table public.program_session_feedback enable row level security;

create policy program_session_feedback_select on public.program_session_feedback
  for select to authenticated
  using (
    exists (
      select 1 from public.programs p
       where p.id = program_session_feedback.program_id
         and public.is_hep_staff(p.clinic_id)
    )
  );

-- 7. RPC: save_exercise (create or update; enforces 10-exercise Lite cap on new inserts)
create or replace function public.save_exercise(
  p_clinic_id uuid,
  p_id uuid default null,
  p_title text default '',
  p_body_region text default 'General',
  p_phase text default 'other',
  p_also_regions text[] default '{}'::text[],
  p_equipment text[] default '{}'::text[],
  p_instructions text default '',
  p_media_type text default 'none',
  p_media_keys text[] default '{}'::text[],
  p_default_sets smallint default 3,
  p_default_reps smallint default 10,
  p_default_hold_seconds smallint default null,
  p_default_sessions_per_day smallint default 1,
  p_side text default 'none',
  p_stop_if text default '',
  p_deleted boolean default false,
  p_dose_type text default 'reps',
  p_default_duration_seconds smallint default null,
  p_default_rest_seconds smallint default 30,
  p_media_captions text[] default '{}'::text[],
  p_active boolean default true,
  p_other_names text[] default '{}'::text[],
  p_thumb_key text default null
) returns uuid
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_count int;
  v_id uuid := coalesce(p_id, gen_random_uuid());
  v_exists boolean;
begin
  if not public.is_hep_staff(p_clinic_id) then
    raise exception 'Not a member of this clinic.';
  end if;

  -- Pictures must sit inside this clinic's own prefix (the hep-media function also checks this before it signs anything).
  if exists (
       select 1 from unnest(coalesce(p_media_keys, '{}'::text[]) || coalesce(array[p_thumb_key], '{}'::text[])) k
        where k is not null and k not like 'clinics/' || p_clinic_id::text || '/exercises/%'
     ) then
    raise exception 'Picture does not belong to this clinic.';
  end if;

  select exists (select 1 from public.exercises where id = v_id and clinic_id = p_clinic_id)
    into v_exists;

  if not v_exists and not p_deleted then
    if not public.clinic_has_unlimited_hep(p_clinic_id) then
      select count(*) into v_count
        from public.exercises
       where clinic_id = p_clinic_id and not deleted;
      if v_count >= (select l.exercises from public.hep_tier_limits('lite') l) then
        raise exception 'You have reached the free-plan limit of % exercises. Visit theranet.in to upgrade.',
          (select l.exercises from public.hep_tier_limits('lite') l);
      end if;
    end if;

    insert into public.exercises (
      id, clinic_id, title, body_region, phase, also_regions, equipment, instructions, media_type, media_keys,
      default_sets, default_reps, default_hold_seconds, default_sessions_per_day,
      side, stop_if, deleted,
      dose_type, default_duration_seconds, default_rest_seconds, media_captions, active, other_names, thumb_key
    ) values (
      v_id, p_clinic_id, btrim(p_title), btrim(p_body_region), coalesce(nullif(btrim(p_phase), ''), 'other'), coalesce(p_also_regions, '{}'::text[]), coalesce(p_equipment, '{}'::text[]), coalesce(p_instructions, ''),
      p_media_type, coalesce(p_media_keys, '{}'::text[]),
      p_default_sets, p_default_reps, p_default_hold_seconds, p_default_sessions_per_day,
      p_side, coalesce(p_stop_if, ''), false,
      coalesce(nullif(btrim(p_dose_type), ''), 'reps'), p_default_duration_seconds,
      coalesce(p_default_rest_seconds, 30), coalesce(p_media_captions, '{}'::text[]), coalesce(p_active, true), coalesce(p_other_names, '{}'::text[]), p_thumb_key
    );
  else
    update public.exercises
       set title = btrim(p_title),
           body_region = btrim(p_body_region),
           phase = coalesce(nullif(btrim(p_phase), ''), 'other'),
           also_regions = coalesce(p_also_regions, '{}'::text[]),
           equipment = coalesce(p_equipment, '{}'::text[]),
           instructions = coalesce(p_instructions, ''),
           media_type = p_media_type,
           media_keys = coalesce(p_media_keys, '{}'::text[]),
           default_sets = p_default_sets,
           default_reps = p_default_reps,
           default_hold_seconds = p_default_hold_seconds,
           default_sessions_per_day = p_default_sessions_per_day,
           side = p_side,
           stop_if = coalesce(p_stop_if, ''),
           deleted = coalesce(p_deleted, false),
           dose_type = coalesce(nullif(btrim(p_dose_type), ''), 'reps'),
           default_duration_seconds = p_default_duration_seconds,
           default_rest_seconds = coalesce(p_default_rest_seconds, 30),
           media_captions = coalesce(p_media_captions, '{}'::text[]),
           active = coalesce(p_active, true),          -- false = archived (amendment 74)
           other_names = coalesce(p_other_names, '{}'::text[]),
           thumb_key = p_thumb_key,
           version = version + 1,
           updated_at = now()
     where id = v_id and clinic_id = p_clinic_id;
  end if;

  return v_id;
end;
$$;

revoke all on function public.save_exercise(uuid, uuid, text, text, text, text[], text[], text, text, text[], smallint, smallint, smallint, smallint, text, text, boolean, text, smallint, smallint, text[], boolean, text[], text) from public, anon;
grant execute on function public.save_exercise(uuid, uuid, text, text, text, text[], text[], text, text, text[], smallint, smallint, smallint, smallint, text, text, boolean, text, smallint, smallint, text[], boolean, text[], text) to authenticated;

-- 8. RPC: save_template (snapshots items into exercise_template_items)
create or replace function public.save_template(
  p_clinic_id uuid,
  p_template_id uuid default null,
  p_title text default '',
  p_items jsonb default '[]'::jsonb,
  p_deleted boolean default false,
  p_note text default null
) returns uuid
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_id uuid := coalesce(p_template_id, gen_random_uuid());
  v_exists boolean;
  v_item jsonb;
  v_idx smallint := 0;
begin
  if not public.is_hep_staff(p_clinic_id) then
    raise exception 'Not a member of this clinic.';
  end if;

  select exists (select 1 from public.exercise_templates where id = v_id and clinic_id = p_clinic_id)
    into v_exists;

  if not v_exists then
    insert into public.exercise_templates (id, clinic_id, title, note, deleted)
    values (v_id, p_clinic_id, btrim(p_title), nullif(btrim(coalesce(p_note, '')), ''), coalesce(p_deleted, false));
  else
    update public.exercise_templates
       set title = btrim(p_title),
           note = nullif(btrim(coalesce(p_note, '')), ''),
           deleted = coalesce(p_deleted, false),
           updated_at = now()
     where id = v_id and clinic_id = p_clinic_id;
    delete from public.exercise_template_items where template_id = v_id;
  end if;

  if not coalesce(p_deleted, false) then
    for v_item in select * from jsonb_array_elements(coalesce(p_items, '[]'::jsonb)) loop
      insert into public.exercise_template_items (
        template_id, source_exercise_id, title, body_region, phase, instructions,
        media_type, media_keys, sets, reps, hold_seconds, sessions_per_day,
        side, stop_if, sort_order,
        equipment, dose_type, duration_seconds, rest_seconds, media_captions, optional
      ) values (
        v_id,
        nullif(v_item->>'sourceExerciseId', '')::uuid,
        btrim(coalesce(v_item->>'title', '')),
        coalesce(nullif(btrim(v_item->>'bodyRegion'), ''), 'General'),
        coalesce(nullif(btrim(v_item->>'phase'), ''), 'other'),
        coalesce(v_item->>'instructions', ''),
        coalesce(v_item->>'mediaType', 'none'),
        coalesce(array(select jsonb_array_elements_text(coalesce(v_item->'mediaKeys', '[]'::jsonb))), '{}'::text[]),
        coalesce((v_item->>'sets')::smallint, 3),
        nullif(v_item->>'reps', '')::smallint,
        nullif(v_item->>'holdSeconds', '')::smallint,
        coalesce((v_item->>'sessionsPerDay')::smallint, 1),
        coalesce(v_item->>'side', 'none'),
        coalesce(v_item->>'stopIf', ''),
        v_idx,
        coalesce(array(select jsonb_array_elements_text(coalesce(v_item->'equipment', '[]'::jsonb))), '{}'::text[]),
        coalesce(nullif(v_item->>'doseType', ''), 'reps'),
        nullif(v_item->>'durationSeconds', '')::smallint,
        coalesce(nullif(v_item->>'restSeconds', '')::smallint, 30),
        coalesce(array(select jsonb_array_elements_text(coalesce(v_item->'mediaCaptions', '[]'::jsonb))), '{}'::text[]),
        coalesce((v_item->>'optional')::boolean, false)
      );
      v_idx := v_idx + 1;
    end loop;
  end if;

  return v_id;
end;
$$;

revoke all on function public.save_template(uuid, uuid, text, jsonb, boolean, text) from public, anon;
grant execute on function public.save_template(uuid, uuid, text, jsonb, boolean, text) to authenticated;

-- 9. RPC: create_program (enforces 5-active-program Lite cap, reuses existing patient by 10-digit phone, snapshots items, upserts patient_hep_access)
create or replace function public.create_program(
  p_clinic_id uuid,
  p_patient_id uuid,
  p_therapist_id uuid default null,
  p_title text default '',
  p_items jsonb default '[]'::jsonb,
  p_custom_pin text default null,
  p_source_template_id uuid default null,
  p_today date default current_date,
  p_settings jsonb default '{}'::jsonb
) returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, extensions
as $$
declare
  v_active_count int;
  v_resolved_patient_id uuid := p_patient_id;
  v_pin text;
  v_needs_pin boolean;
  v_program_id uuid := gen_random_uuid();
  v_token text;
  v_item jsonb;
  v_idx smallint := 0;
  v_spd smallint;
begin
  if not public.is_hep_staff(p_clinic_id) then
    raise exception 'Not a member of this clinic.';
  end if;

  -- Prescribing never creates a patient: the patient must already exist in this clinic (Add patient sheet first).
  if not exists (
    select 1 from public.patients
     where id = v_resolved_patient_id
       and clinic_id = p_clinic_id
       and deleted_at is null
  ) then
    raise exception 'Patient does not belong to this clinic.';
  end if;

  if not public.clinic_has_unlimited_hep(p_clinic_id) then
    select count(*) into v_active_count
      from public.programs
     where clinic_id = p_clinic_id and status = 'active';
    if v_active_count >= (select l.active_programs from public.hep_tier_limits('lite') l) then
      raise exception 'You have reached the free-plan limit of % active programs. Visit theranet.in to upgrade.',
        (select l.active_programs from public.hep_tier_limits('lite') l);
    end if;
  end if;

  -- Program settings (amendments 31, 33, 53). Keys are optional: durationDays (null = ongoing, absent = 7),
  -- targetPct (default 70), checkinDays (null = none, absent = 7), feedbackDefault ('pain' | 'effort'),
  -- sessionsPerDay (the program's times a day, default 1; items may override, amendment 68).
  insert into public.programs (
    id, clinic_id, patient_id, therapist_id, source_template_id, title, status, start_date,
    duration_days, target_pct, checkin_on, feedback_default, sessions_per_day
  ) values (
    v_program_id, p_clinic_id, v_resolved_patient_id, p_therapist_id, p_source_template_id,
    btrim(p_title), 'active', coalesce(p_today, current_date),
    case when coalesce(p_settings, '{}'::jsonb) ? 'durationDays' then nullif(p_settings->>'durationDays', '')::smallint else 7 end,
    coalesce(nullif(p_settings->>'targetPct', '')::smallint, 70),
    coalesce(p_today, current_date) + case when coalesce(p_settings, '{}'::jsonb) ? 'checkinDays'
      then nullif(p_settings->>'checkinDays', '')::int else 7 end,
    coalesce(nullif(p_settings->>'feedbackDefault', ''), 'pain'),
    coalesce(nullif(p_settings->>'sessionsPerDay', '')::smallint, 1)
  );

  for v_item in select * from jsonb_array_elements(coalesce(p_items, '[]'::jsonb)) loop
    v_spd := coalesce((v_item->>'sessionsPerDay')::smallint, 1);
    insert into public.program_items (
      program_id, source_exercise_id, title, body_region, phase, instructions,
      media_type, media_keys, sets, reps, hold_seconds, sessions_per_day,
      sessions_schedule, side, stop_if, special_instructions, sort_order, added_on,
      equipment, dose_type, duration_seconds, rest_seconds, media_captions, optional
    ) values (
      v_program_id,
      nullif(v_item->>'sourceExerciseId', '')::uuid,
      btrim(coalesce(v_item->>'title', '')),
      coalesce(nullif(btrim(v_item->>'bodyRegion'), ''), 'General'),
      coalesce(nullif(btrim(v_item->>'phase'), ''), 'other'),
      coalesce(v_item->>'instructions', ''),
      coalesce(v_item->>'mediaType', 'none'),
      coalesce(array(select jsonb_array_elements_text(coalesce(v_item->'mediaKeys', '[]'::jsonb))), '{}'::text[]),
      coalesce((v_item->>'sets')::smallint, 3),
      nullif(v_item->>'reps', '')::smallint,
      nullif(v_item->>'holdSeconds', '')::smallint,
      v_spd,
      jsonb_build_array(jsonb_build_object('from', coalesce(p_today, current_date)::text, 'sessionsPerDay', v_spd)),
      coalesce(v_item->>'side', 'none'),
      coalesce(v_item->>'stopIf', ''),
      coalesce(v_item->>'specialInstructions', ''),
      v_idx,
      coalesce(p_today, current_date),
      coalesce(array(select jsonb_array_elements_text(coalesce(v_item->'equipment', '[]'::jsonb))), '{}'::text[]),
      coalesce(nullif(v_item->>'doseType', ''), 'reps'),
      nullif(v_item->>'durationSeconds', '')::smallint,
      coalesce(nullif(v_item->>'restSeconds', '')::smallint, 30),
      coalesce(array(select jsonb_array_elements_text(coalesce(v_item->'mediaCaptions', '[]'::jsonb))), '{}'::text[]),
      coalesce((v_item->>'optional')::boolean, false)
    );
    v_idx := v_idx + 1;
  end loop;

  -- PIN: the therapist's own 4 digits, else a random one the first time this patient gets a link. Stored hashed,
  -- returned once as 'pin' (null when the patient already has one) so the therapist can pass it on, never by WhatsApp.
  if p_custom_pin is not null and btrim(p_custom_pin) <> '' then
    if btrim(p_custom_pin) !~ '^[0-9]{4}$' then
      raise exception 'PIN must be exactly 4 digits.';
    end if;
    v_pin := btrim(p_custom_pin);
  end if;

  insert into public.patient_hep_access (patient_id, clinic_id)
  values (v_resolved_patient_id, p_clinic_id)
  on conflict (patient_id) do nothing;

  select token, (pin_hash is null) into v_token, v_needs_pin
    from public.patient_hep_access where patient_id = v_resolved_patient_id;

  if v_pin is null and v_needs_pin then
    v_pin := lpad(((get_byte(extensions.gen_random_bytes(2), 0) * 256 + get_byte(extensions.gen_random_bytes(2), 1)) % 10000)::text, 4, '0');
  end if;
  if v_pin is not null then
    update public.patient_hep_access
       set pin_hash = extensions.crypt(v_pin, extensions.gen_salt('bf')),
           link_revoked_at = null,
           updated_at = now()
     where patient_id = v_resolved_patient_id;
  end if;

  return jsonb_build_object('programId', v_program_id, 'patientId', v_resolved_patient_id, 'token', v_token, 'pin', v_pin);
end;
$$;

revoke all on function public.create_program(uuid, uuid, uuid, text, jsonb, text, uuid, date, jsonb) from public, anon;
grant execute on function public.create_program(uuid, uuid, uuid, text, jsonb, text, uuid, date, jsonb) to authenticated;

-- 10. RPC: update_program (keeps sessions_per_day column at today's number while scheduling tomorrow; soft-removes removed items)
create or replace function public.update_program(
  p_program_id uuid,
  p_title text,
  p_status text,
  p_items jsonb,
  p_custom_pin text default null,
  p_today date default current_date,
  p_settings jsonb default null
) returns void
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_prog public.programs;
  v_active_count int;
  v_item jsonb;
  v_item_id uuid;
  v_existing public.program_items;
  v_kept_ids uuid[] := '{}'::uuid[];
  v_idx smallint := 0;
  v_new_spd smallint;
  v_today_spd smallint;
  v_sched jsonb;
  v_today_str text := coalesce(p_today, current_date)::text;
  v_tomorrow text := (coalesce(p_today, current_date) + 1)::text;
begin
  select * into v_prog from public.programs where id = p_program_id for update;
  if not found then
    raise exception 'Program not found.';
  end if;
  if not public.is_hep_staff(v_prog.clinic_id) then
    raise exception 'Not a member of this clinic.';
  end if;

  if p_status = 'active' and v_prog.status <> 'active' then
    if not public.clinic_has_unlimited_hep(v_prog.clinic_id) then
      select count(*) into v_active_count
        from public.programs
       where clinic_id = v_prog.clinic_id and status = 'active' and id <> p_program_id;
      if v_active_count >= (select l.active_programs from public.hep_tier_limits('lite') l) then
        raise exception 'You have reached the free-plan limit of % active programs. Visit theranet.in to upgrade.',
          (select l.active_programs from public.hep_tier_limits('lite') l);
      end if;
    end if;
  end if;

  update public.programs
     set title = btrim(p_title),
         status = p_status,
         duration_days = case when p_settings ? 'durationDays'
                              then nullif(p_settings->>'durationDays', '')::smallint else duration_days end,
         target_pct = coalesce(nullif(p_settings->>'targetPct', '')::smallint, target_pct),
         checkin_on = case when p_settings ? 'checkinOn'
                           then nullif(p_settings->>'checkinOn', '')::date else checkin_on end,
         feedback_default = coalesce(nullif(p_settings->>'feedbackDefault', ''), feedback_default),
         sessions_per_day = coalesce(nullif(p_settings->>'sessionsPerDay', '')::smallint, sessions_per_day),
         updated_at = now()
   where id = p_program_id;

  for v_item in select * from jsonb_array_elements(coalesce(p_items, '[]'::jsonb)) loop
    v_item_id := nullif(v_item->>'id', '')::uuid;
    v_new_spd := coalesce((v_item->>'sessionsPerDay')::smallint, 1);

    if v_item_id is not null then
      select * into v_existing
        from public.program_items
       where id = v_item_id and program_id = p_program_id;
    else
      v_existing := null;
    end if;

    if v_existing.id is not null then
      -- Resolve today's effective sessions_per_day from existing schedule so today's column never jumps to tomorrow's value
      select coalesce(
        (
          select (e->>'sessionsPerDay')::smallint
            from jsonb_array_elements(coalesce(v_existing.sessions_schedule, '[]'::jsonb)) with ordinality as t(e, ord)
           where (e->>'from') <= v_today_str
           order by (e->>'from') desc, ord desc
           limit 1
        ),
        v_existing.sessions_per_day
      ) into v_today_spd;

      -- Strip any previous entry for tomorrow before appending the new tomorrow target, and sort chronologically
      select coalesce(
        jsonb_agg(e order by (e->>'from') asc, ord asc),
        jsonb_build_array(jsonb_build_object('from', v_existing.added_on::text, 'sessionsPerDay', v_today_spd))
      )
      into v_sched
      from jsonb_array_elements(coalesce(v_existing.sessions_schedule, '[]'::jsonb)) with ordinality as t(e, ord)
      where (e->>'from') <> v_tomorrow;

      if v_new_spd <> v_today_spd then
        v_sched := v_sched || jsonb_build_array(
          jsonb_build_object('from', v_tomorrow, 'sessionsPerDay', v_new_spd)
        );
      end if;

      update public.program_items
         set title = btrim(coalesce(v_item->>'title', v_existing.title)),
             instructions = coalesce(v_item->>'instructions', v_existing.instructions),
             sets = coalesce((v_item->>'sets')::smallint, v_existing.sets),
             dose_type = coalesce(nullif(v_item->>'doseType', ''), v_existing.dose_type),
             reps = nullif(v_item->>'reps', '')::smallint,          -- the client always sends the whole item
             hold_seconds = nullif(v_item->>'holdSeconds', '')::smallint,
             duration_seconds = nullif(v_item->>'durationSeconds', '')::smallint,
             rest_seconds = coalesce(nullif(v_item->>'restSeconds', '')::smallint, v_existing.rest_seconds),
             equipment = case when v_item ? 'equipment'
                              then coalesce(array(select jsonb_array_elements_text(v_item->'equipment')), '{}'::text[])
                              else v_existing.equipment end,
             optional = coalesce((v_item->>'optional')::boolean, v_existing.optional),
             media_captions = case when v_item ? 'mediaCaptions'
                              then coalesce(array(select jsonb_array_elements_text(v_item->'mediaCaptions')), '{}'::text[])
                              else v_existing.media_captions end,
             sessions_per_day = v_today_spd,
             sessions_schedule = v_sched,
             side = coalesce(v_item->>'side', v_existing.side),
             stop_if = coalesce(v_item->>'stopIf', v_existing.stop_if),
             special_instructions = coalesce(v_item->>'specialInstructions', v_existing.special_instructions),
             sort_order = v_idx,
             removed_on = null
       where id = v_existing.id;

      v_kept_ids := array_append(v_kept_ids, v_existing.id);
    else
      v_item_id := gen_random_uuid();
      insert into public.program_items (
        id, program_id, source_exercise_id, title, body_region, phase, instructions,
        media_type, media_keys, sets, reps, hold_seconds, sessions_per_day,
        sessions_schedule, side, stop_if, special_instructions, sort_order, added_on,
        equipment, dose_type, duration_seconds, rest_seconds, media_captions, optional
      ) values (
        v_item_id,
        p_program_id,
        nullif(v_item->>'sourceExerciseId', '')::uuid,
        btrim(coalesce(v_item->>'title', '')),
        coalesce(nullif(btrim(v_item->>'bodyRegion'), ''), 'General'),
        coalesce(nullif(btrim(v_item->>'phase'), ''), 'other'),
        coalesce(v_item->>'instructions', ''),
        coalesce(v_item->>'mediaType', 'none'),
        coalesce(array(select jsonb_array_elements_text(coalesce(v_item->'mediaKeys', '[]'::jsonb))), '{}'::text[]),
        coalesce((v_item->>'sets')::smallint, 3),
        nullif(v_item->>'reps', '')::smallint,
        nullif(v_item->>'holdSeconds', '')::smallint,
        v_new_spd,
        jsonb_build_array(jsonb_build_object('from', coalesce(p_today, current_date)::text, 'sessionsPerDay', v_new_spd)),
        coalesce(v_item->>'side', 'none'),
        coalesce(v_item->>'stopIf', ''),
        coalesce(v_item->>'specialInstructions', ''),
        v_idx,
        coalesce(p_today, current_date),
        coalesce(array(select jsonb_array_elements_text(coalesce(v_item->'equipment', '[]'::jsonb))), '{}'::text[]),
        coalesce(nullif(v_item->>'doseType', ''), 'reps'),
        nullif(v_item->>'durationSeconds', '')::smallint,
        coalesce(nullif(v_item->>'restSeconds', '')::smallint, 30),
        coalesce(array(select jsonb_array_elements_text(coalesce(v_item->'mediaCaptions', '[]'::jsonb))), '{}'::text[]),
        coalesce((v_item->>'optional')::boolean, false)
      );
      v_kept_ids := array_append(v_kept_ids, v_item_id);
    end if;

    v_idx := v_idx + 1;
  end loop;

  -- Soft-remove items omitted from the updated list so past logs stay intact
  update public.program_items
     set removed_on = coalesce(p_today, current_date)
   where program_id = p_program_id
     and removed_on is null
     and not (id = any(v_kept_ids));

  -- p_custom_pin = null or '' -> leave the PIN unchanged (use reset_hep_pin for a new random one).
  if p_custom_pin is not null and btrim(p_custom_pin) <> '' then
    if btrim(p_custom_pin) !~ '^[0-9]{4}$' then
      raise exception 'PIN must be exactly 4 digits.';
    end if;
    update public.patient_hep_access
       set pin_hash = extensions.crypt(btrim(p_custom_pin), extensions.gen_salt('bf')),
           failed_attempts = 0, locked_until = null,
           updated_at = now()
     where patient_id = v_prog.patient_id;
  end if;
end;
$$;

revoke all on function public.update_program(uuid, text, text, jsonb, text, date, jsonb) from public, anon;
grant execute on function public.update_program(uuid, text, text, jsonb, text, date, jsonb) to authenticated;

-- 11. RPCs: copy_template_to_program & save_program_as_template
create or replace function public.copy_template_to_program(
  p_template_id uuid,
  p_patient_id uuid,
  p_therapist_id uuid default null,
  p_custom_pin text default null,
  p_today date default current_date
) returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_tmpl public.exercise_templates;
  v_items jsonb;
begin
  select * into v_tmpl from public.exercise_templates where id = p_template_id and not deleted;
  if not found or not public.is_hep_staff(v_tmpl.clinic_id) then
    raise exception 'Template not found.';
  end if;

  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'sourceExerciseId', ti.source_exercise_id,
        'title', ti.title,
        'bodyRegion', ti.body_region,
        'phase', ti.phase,
        'instructions', ti.instructions,
        'mediaType', ti.media_type,
        'mediaKeys', to_jsonb(ti.media_keys),
        'sets', ti.sets,
        'doseType', ti.dose_type,
        'reps', ti.reps,
        'holdSeconds', ti.hold_seconds,
        'durationSeconds', ti.duration_seconds,
        'restSeconds', ti.rest_seconds,
        'equipment', to_jsonb(ti.equipment),
        'mediaCaptions', to_jsonb(ti.media_captions),
        'optional', ti.optional,
        'sessionsPerDay', ti.sessions_per_day,
        'side', ti.side,
        'stopIf', ti.stop_if
      ) order by ti.sort_order
    ),
    '[]'::jsonb
  ) into v_items
  from public.exercise_template_items ti
  where ti.template_id = p_template_id;

  return public.create_program(
    v_tmpl.clinic_id,
    p_patient_id,
    p_therapist_id,
    v_tmpl.title,
    v_items,
    p_custom_pin,
    p_template_id,
    p_today
  );
end;
$$;

revoke all on function public.copy_template_to_program(uuid, uuid, uuid, text, date) from public, anon;
grant execute on function public.copy_template_to_program(uuid, uuid, uuid, text, date) to authenticated;

create or replace function public.save_program_as_template(
  p_program_id uuid,
  p_title text
) returns uuid
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_prog public.programs;
  v_items jsonb;
begin
  select * into v_prog from public.programs where id = p_program_id;
  if not found or not public.is_hep_staff(v_prog.clinic_id) then
    raise exception 'Program not found.';
  end if;

  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'sourceExerciseId', pi.source_exercise_id,
        'title', pi.title,
        'bodyRegion', pi.body_region,
        'phase', pi.phase,
        'instructions', pi.instructions,
        'mediaType', pi.media_type,
        'mediaKeys', to_jsonb(pi.media_keys),
        'sets', pi.sets,
        'doseType', pi.dose_type,
        'reps', pi.reps,
        'holdSeconds', pi.hold_seconds,
        'durationSeconds', pi.duration_seconds,
        'restSeconds', pi.rest_seconds,
        'equipment', to_jsonb(pi.equipment),
        'mediaCaptions', to_jsonb(pi.media_captions),
        'optional', pi.optional,
        'sessionsPerDay', pi.sessions_per_day,
        'side', pi.side,
        'stopIf', pi.stop_if
      ) order by pi.sort_order
    ),
    '[]'::jsonb
  ) into v_items
  from public.program_items pi
  where pi.program_id = p_program_id and pi.removed_on is null;

  return public.save_template(v_prog.clinic_id, null, p_title, v_items, false);
end;
$$;

revoke all on function public.save_program_as_template(uuid, text) from public, anon;
grant execute on function public.save_program_as_template(uuid, text) to authenticated;

-- Helper: duplicate an existing template
create or replace function public.duplicate_template(
  p_template_id uuid,
  p_new_title text default null
) returns uuid
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_tmpl public.exercise_templates;
  v_new_id uuid;
  v_title text;
begin
  select * into v_tmpl from public.exercise_templates where id = p_template_id and not deleted;
  if not found or not public.is_hep_staff(v_tmpl.clinic_id) then
    raise exception 'Template not found.';
  end if;

  v_title := coalesce(p_new_title, v_tmpl.title || ' (Copy)');
  v_new_id := gen_random_uuid();

  insert into public.exercise_templates (id, clinic_id, title, note)
  values (v_new_id, v_tmpl.clinic_id, v_title, v_tmpl.note);

  insert into public.exercise_template_items (
    template_id, source_exercise_id, title, body_region, phase, instructions,
    media_type, media_keys, sets, reps, hold_seconds, sessions_per_day,
    side, stop_if, sort_order,
    equipment, dose_type, duration_seconds, rest_seconds, media_captions, optional
  )
  select v_new_id, source_exercise_id, title, body_region, phase, instructions,
         media_type, media_keys, sets, reps, hold_seconds, sessions_per_day,
         side, stop_if, sort_order,
         equipment, dose_type, duration_seconds, rest_seconds, media_captions, optional
    from public.exercise_template_items
   where template_id = p_template_id;

  return v_new_id;
end;
$$;

revoke all on function public.duplicate_template(uuid, text) from public, anon;
grant execute on function public.duplicate_template(uuid, text) to authenticated;

-- Helper: duplicate an existing program onto a patient
create or replace function public.duplicate_program(
  p_program_id uuid,
  p_new_title text default null
) returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_prog public.programs;
  v_items jsonb;
  v_title text;
begin
  select * into v_prog from public.programs where id = p_program_id;
  if not found or not public.is_hep_staff(v_prog.clinic_id) then
    raise exception 'Program not found.';
  end if;

  v_title := coalesce(p_new_title, v_prog.title || ' (Copy)');

  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'sourceExerciseId', pi.source_exercise_id,
        'title', pi.title,
        'bodyRegion', pi.body_region,
        'phase', pi.phase,
        'instructions', pi.instructions,
        'mediaType', pi.media_type,
        'mediaKeys', to_jsonb(pi.media_keys),
        'sets', pi.sets,
        'doseType', pi.dose_type,
        'reps', pi.reps,
        'holdSeconds', pi.hold_seconds,
        'durationSeconds', pi.duration_seconds,
        'restSeconds', pi.rest_seconds,
        'equipment', to_jsonb(pi.equipment),
        'mediaCaptions', to_jsonb(pi.media_captions),
        'optional', pi.optional,
        'sessionsPerDay', pi.sessions_per_day,
        'side', pi.side,
        'stopIf', pi.stop_if
      ) order by pi.sort_order
    ),
    '[]'::jsonb
  ) into v_items
  from public.program_items pi
  where pi.program_id = p_program_id and pi.removed_on is null;

  return public.create_program(
    v_prog.clinic_id,
    v_prog.patient_id,
    v_prog.therapist_id,
    v_title,
    v_items,
    null,                                            -- p_custom_pin: keep the patient's PIN
    v_prog.source_template_id,
    platform_admin.clinic_today(v_prog.clinic_id),   -- the clinic's day, not the server's
    jsonb_build_object(
      'durationDays', v_prog.duration_days,
      'targetPct', v_prog.target_pct,
      'checkinDays', case when v_prog.checkin_on is null then null else v_prog.checkin_on - v_prog.start_date end,
      'feedbackDefault', v_prog.feedback_default,
      'sessionsPerDay', v_prog.sessions_per_day
    )
  );
end;
$$;

revoke all on function public.duplicate_program(uuid, text) from public, anon;
grant execute on function public.duplicate_program(uuid, text) to authenticated;

-- Helper: toggle exercise favorite
create or replace function public.toggle_exercise_favorite(
  p_exercise_id uuid
) returns boolean
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_fav boolean;
  v_clinic_id uuid;
begin
  select clinic_id, coalesce(is_favorite, false) into v_clinic_id, v_fav
    from public.exercises
   where id = p_exercise_id and not deleted;
  if not found or not public.is_hep_staff(v_clinic_id) then
    raise exception 'Exercise not found.';
  end if;

  update public.exercises
     set is_favorite = not v_fav,
         updated_at = now()
   where id = p_exercise_id;

  return not v_fav;
end;
$$;

revoke all on function public.toggle_exercise_favorite(uuid) from public, anon;
grant execute on function public.toggle_exercise_favorite(uuid) to authenticated;

-- 12. Internal PIN check helper (5 wrong attempts lock for 15 minutes; returns patient_id)
create or replace function public.hep_verify(p_token text, p_pin text, p_device text default null)
returns table (patient_id uuid, outcome text, attempts_left int)
language plpgsql
security definer
set search_path = pg_catalog, public, extensions
as $$
declare
  v_access public.patient_hep_access;
  v_ok boolean;
  v_new smallint;
  v_dev uuid;
begin
  -- Table columns are always qualified (ha., a., d.): the result column patient_id would make a bare
  -- "patient_id" ambiguous and every PIN check would fail.
  -- Never raises: a raise would roll back the failed_attempts update and the lock would never take hold.
  select a.* into v_access
    from public.patient_hep_access a
    join public.patients p on p.id = a.patient_id and p.deleted_at is null
   where a.token = btrim(coalesce(p_token, ''))
     and a.link_revoked_at is null
   for update of a;

  if not found then
    return query select null::uuid, 'unavailable'::text, 0;
    return;
  end if;

  -- A remembered phone skips the PIN (and is never locked out by someone else's wrong guesses). It slides 30 days
  -- from each use, capped at 180 days from when it was created.
  if p_device is not null and btrim(p_device) <> '' then
    select d.id into v_dev
      from public.hep_device_sessions d
     where d.patient_id = v_access.patient_id
       and d.token_hash = encode(extensions.digest(btrim(p_device), 'sha256'), 'hex')
       and d.expires_at > now()
       and d.created_at > now() - interval '180 days';
    if v_dev is not null then
      update public.hep_device_sessions
         set last_used_at = now(), expires_at = now() + interval '30 days'
       where id = v_dev;
      return query select v_access.patient_id, 'ok'::text, 5;
      return;
    end if;
  end if;

  if v_access.locked_until is not null and v_access.locked_until > now() then
    return query select null::uuid, 'locked'::text, 0;
    return;
  end if;

  -- No PIN supplied (an unknown or expired remembered phone): ask for it, and do not count an attempt.
  if p_pin is null or btrim(p_pin) = '' then
    return query select null::uuid, 'pin_needed'::text, 5 - v_access.failed_attempts::int;
    return;
  end if;

  v_ok := v_access.pin_hash is not null
          and btrim(coalesce(p_pin, '')) ~ '^[0-9]{4}$'
          and v_access.pin_hash = extensions.crypt(btrim(p_pin), v_access.pin_hash);

  if not v_ok then
    v_new := v_access.failed_attempts + 1;
    update public.patient_hep_access ha
       set failed_attempts = case when v_new >= 5 then 0 else v_new end,
           locked_until = case when v_new >= 5 then now() + interval '15 minutes' else null end,
           updated_at = now()
     where ha.patient_id = v_access.patient_id;
    if v_new >= 5 then
      return query select null::uuid, 'locked'::text, 0;
    else
      return query select null::uuid, 'wrong_pin'::text, (5 - v_new)::int;
    end if;
    return;
  end if;

  if v_access.failed_attempts > 0 or v_access.locked_until is not null then
    update public.patient_hep_access ha
       set failed_attempts = 0, locked_until = null, updated_at = now()
     where ha.patient_id = v_access.patient_id;
  end if;

  return query select v_access.patient_id, 'ok'::text, 5;
end;
$$;

revoke all on function public.hep_verify(text, text, text) from public, anon, authenticated;

-- Remember this phone: verifies the PIN (counts wrong attempts like any PIN check), then returns a random device
-- token ONCE; only its hash is stored. At most 5 remembered phones per patient (the oldest is dropped).
create or replace function public.hep_remember_device(p_token text, p_pin text) returns jsonb
language plpgsql security definer set search_path = pg_catalog, public, extensions as $$
declare
  v record;
  v_device text;
begin
  select * into v from public.hep_verify(p_token, p_pin);
  if v.outcome <> 'ok' then
    return jsonb_build_object('ok', false, 'reason', v.outcome, 'attemptsLeft', v.attempts_left);
  end if;
  v_device := encode(extensions.gen_random_bytes(32), 'hex');
  insert into public.hep_device_sessions (patient_id, token_hash)
  values (v.patient_id, encode(extensions.digest(v_device, 'sha256'), 'hex'));
  delete from public.hep_device_sessions d
   where d.patient_id = v.patient_id
     and d.id not in (select id from public.hep_device_sessions where patient_id = v.patient_id order by created_at desc limit 5);
  return jsonb_build_object('ok', true, 'device', v_device);
end;
$$;
revoke all on function public.hep_remember_device(text, text) from public;
grant execute on function public.hep_remember_device(text, text) to anon, authenticated;

-- Revoke the shared link (the patient's page stops working) and issue a fresh random PIN on request.
create or replace function public.revoke_hep_link(p_patient_id uuid) returns void
language plpgsql security definer set search_path = pg_catalog, public as $$
declare v_clinic uuid;
begin
  select clinic_id into v_clinic from public.patients where id = p_patient_id;
  if v_clinic is null or not public.is_hep_staff(v_clinic) then
    raise exception 'Not a member of this clinic.';
  end if;
  update public.patient_hep_access set link_revoked_at = now(), updated_at = now() where patient_id = p_patient_id;
  delete from public.hep_device_sessions where patient_id = p_patient_id;
end;
$$;
revoke all on function public.revoke_hep_link(uuid) from public, anon;
grant execute on function public.revoke_hep_link(uuid) to authenticated;

create or replace function public.reset_hep_pin(p_patient_id uuid) returns text
language plpgsql security definer set search_path = pg_catalog, public, extensions as $$
declare v_clinic uuid; v_pin text;
begin
  select clinic_id into v_clinic from public.patients where id = p_patient_id;
  if v_clinic is null or not public.is_hep_staff(v_clinic) then
    raise exception 'Not a member of this clinic.';
  end if;
  v_pin := lpad(((get_byte(extensions.gen_random_bytes(2), 0) * 256 + get_byte(extensions.gen_random_bytes(2), 1)) % 10000)::text, 4, '0');
  update public.patient_hep_access
     set pin_hash = extensions.crypt(v_pin, extensions.gen_salt('bf')),
         failed_attempts = 0, locked_until = null, updated_at = now()
   where patient_id = p_patient_id;
  delete from public.hep_device_sessions where patient_id = p_patient_id;
  return v_pin;
end;
$$;
revoke all on function public.reset_hep_pin(uuid) from public, anon;
grant execute on function public.reset_hep_pin(uuid) to authenticated;

-- 13. Public RPCs (all return jsonb { ok, reason?, attemptsLeft? } and never raise on a bad PIN)

-- Rate limit for the public HEP calls, reusing the app's existing public_rpc_rate_limit table
-- (20260830120000_patient_comms_foundation.sql). Unlike check_public_rpc_rate_limit it never raises (a raise
-- would roll back hep_verify's failed-attempt count). 60 calls a minute per link, 120 per IP. When the caller is
-- the hep-media edge function (service_role), the IP check is skipped here: every patient would share the edge's
-- IP; the edge function checks the real client IP itself by calling hep_rate_ok_ip.
create or replace function public.hep_rate_ok(p_token text)
returns boolean
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_ip text := coalesce(
    nullif(split_part(current_setting('request.headers', true)::json ->> 'x-forwarded-for', ',', 1), ''),
    'unknown'
  );
  v_tok text := 'hep_tok:' || md5(coalesce(btrim(p_token), ''));
  v_check_ip boolean := coalesce(current_setting('request.jwt.claims', true)::json ->> 'role', '') <> 'service_role';
  v_n int;
begin
  delete from public.public_rpc_rate_limit where called_at < now() - interval '1 day';

  select count(*) into v_n from public.public_rpc_rate_limit
   where fn_name = v_tok and called_at > now() - interval '60 seconds';
  if v_n >= 60 then return false; end if;

  if v_check_ip then
    select count(*) into v_n from public.public_rpc_rate_limit
     where fn_name = 'hep_public' and client_ip = v_ip and called_at > now() - interval '60 seconds';
    if v_n >= 120 then return false; end if;
    insert into public.public_rpc_rate_limit (fn_name, client_ip) values ('hep_public', v_ip);
  end if;

  insert into public.public_rpc_rate_limit (fn_name, client_ip) values (v_tok, v_ip);
  return true;
end;
$$;
revoke all on function public.hep_rate_ok(text) from public, anon, authenticated;

create or replace function public.hep_rate_ok_ip(p_ip text)
returns boolean
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare v_n int;
begin
  select count(*) into v_n from public.public_rpc_rate_limit
   where fn_name = 'hep_public' and client_ip = coalesce(nullif(btrim(p_ip), ''), 'unknown')
     and called_at > now() - interval '60 seconds';
  if v_n >= 120 then return false; end if;
  insert into public.public_rpc_rate_limit (fn_name, client_ip)
  values ('hep_public', coalesce(nullif(btrim(p_ip), ''), 'unknown'));
  return true;
end;
$$;
revoke all on function public.hep_rate_ok_ip(text) from public, anon, authenticated;
grant execute on function public.hep_rate_ok_ip(text) to service_role;

-- Before the PIN: the clinic's name and logo for a valid, non-revoked link (amendment 40). Nothing else.
create or replace function public.hep_clinic_brand(p_token text)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_name text;
  v_logo text;
begin
  if not public.hep_rate_ok(p_token) then
    return jsonb_build_object('ok', false, 'reason', 'busy');
  end if;
  select c.name, c.logo_path into v_name, v_logo
    from public.patient_hep_access a
    join public.patients p on p.id = a.patient_id and p.deleted_at is null
    join public.clinics c on c.id = a.clinic_id
   where a.token = btrim(coalesce(p_token, ''))
     and a.link_revoked_at is null;
  if not found then
    return jsonb_build_object('ok', false, 'reason', 'unavailable');
  end if;
  return jsonb_build_object('ok', true, 'name', v_name, 'logoPath', v_logo);
end;
$$;
revoke all on function public.hep_clinic_brand(text) from public;
grant execute on function public.hep_clinic_brand(text) to anon, authenticated;

-- The patient page's data. Lists the patient's active programs; returns items, recent logs and today's
-- session checks only for the program being shown (p_program_id, else the newest), so media URLs are minted
-- for that program only (amendment 58). p_reason = 'refresh' for the 13.5-minute media refresh, which does
-- not count as an open (amendment 55).
create or replace function public.get_public_hep(
  p_token text,
  p_pin text,
  p_device text default null,
  p_program_id uuid default null,
  p_reason text default 'open'
) returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, platform_admin
as $$
declare
  v record;
  v_patient_id uuid;
  v_clinic_id uuid;
  v_today date;
  v_clinic jsonb;
  v_programs jsonb;
  v_shown uuid;
  v_items jsonb;
  v_logs jsonb;
  v_feedback jsonb;
begin
  if not public.hep_rate_ok(p_token) then
    return jsonb_build_object('ok', false, 'reason', 'busy');
  end if;
  select * into v from public.hep_verify(p_token, p_pin, p_device);
  if v.outcome <> 'ok' then
    return jsonb_build_object('ok', false, 'reason', v.outcome, 'attemptsLeft', v.attempts_left);
  end if;
  v_patient_id := v.patient_id;

  select p.clinic_id,
         jsonb_build_object('name', c.name, 'logoPath', c.logo_path, 'phone', c.phone, 'timezone', c.timezone)
    into v_clinic_id, v_clinic
    from public.patients p
    join public.clinics c on c.id = p.clinic_id
   where p.id = v_patient_id;
  v_today := platform_admin.clinic_today(v_clinic_id);

  if coalesce(p_reason, 'open') = 'open' then
    -- The first time the patient's page shows a program (amendment 72: "Opened ✓" and "Link not opened yet").
    update public.programs set first_opened_at = now()
     where patient_id = v_patient_id and status = 'active' and first_opened_at is null
       and id = coalesce(p_program_id, (select p2.id from public.programs p2
                                         where p2.patient_id = v_patient_id and p2.status = 'active'
                                         order by p2.start_date desc, p2.created_at desc limit 1));
    update public.patient_hep_access
       set open_count = open_count + 1, last_opened_at = now()
     where patient_id = v_patient_id
       and (last_opened_at is null or last_opened_at < now() - interval '30 minutes');
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
           'id', prog.id,
           'title', prog.title,
           'startDate', prog.start_date,
           'durationDays', prog.duration_days,
           'feedbackDefault', prog.feedback_default,
           'prescribedBy', nullif(split_part(btrim(coalesce(t.name, '')), ' ', 1), '')
         ) order by prog.start_date desc, prog.created_at desc), '[]'::jsonb)
    into v_programs
    from public.programs prog
    left join public.therapists t on t.id = prog.therapist_id
   where prog.patient_id = v_patient_id and prog.status = 'active';

  select prog.id into v_shown
    from public.programs prog
   where prog.patient_id = v_patient_id
     and prog.status = 'active'
     and (p_program_id is null or prog.id = p_program_id)
   order by prog.start_date desc, prog.created_at desc
   limit 1;

  select coalesce(jsonb_agg(jsonb_build_object(
           'id', pi.id,
           'title', pi.title,
           'phase', pi.phase,
           'equipment', to_jsonb(pi.equipment),
           'instructions', pi.instructions,
           'mediaType', pi.media_type,
           'mediaKeys', to_jsonb(pi.media_keys),
           'sets', pi.sets,
           'reps', pi.reps,
           'doseType', pi.dose_type,
           'durationSeconds', pi.duration_seconds,
           'restSeconds', pi.rest_seconds,
           'mediaCaptions', to_jsonb(pi.media_captions),
           'optional', pi.optional,
           'holdSeconds', pi.hold_seconds,
           'sessionsPerDay', pi.sessions_per_day,
           'sessionsSchedule', pi.sessions_schedule,
           'side', pi.side,
           'stopIf', pi.stop_if,
           'specialInstructions', pi.special_instructions,
           'sortOrder', pi.sort_order,
           'addedOn', pi.added_on
         ) order by pi.sort_order), '[]'::jsonb)
    into v_items
    from public.program_items pi
   where pi.program_id = v_shown and pi.removed_on is null;

  select coalesce(jsonb_agg(jsonb_build_object(
           'programItemId', l.program_item_id,
           'logDate', l.log_date,
           'sessionIndex', l.session_index,
           'skipped', l.skipped,
           'skipReason', l.skip_reason,
           'completedAt', l.completed_at
         )), '[]'::jsonb)
    into v_logs
    from public.program_logs l
    join public.program_items pi on pi.id = l.program_item_id
   where pi.program_id = v_shown
     and l.log_date >= v_today - 13;

  select coalesce(jsonb_agg(jsonb_build_object(
           'sessionIndex', f.session_index,
           'pain', f.pain_score,
           'effort', f.effort_score,
           'painItemIds', to_jsonb(f.pain_item_ids),
           'hardItemIds', to_jsonb(f.hard_item_ids)
         )), '[]'::jsonb)
    into v_feedback
    from public.program_session_feedback f
   where f.program_id = v_shown and f.log_date = v_today;

  return jsonb_build_object(
    'ok', true,
    'clinicId', v_clinic_id,
    'today', v_today,
    'clinic', v_clinic,
    'programs', v_programs,
    'shownProgramId', v_shown,
    'items', v_items,
    'logs', v_logs,
    'sessionFeedback', v_feedback
  );
end;
$$;

revoke all on function public.get_public_hep(text, text, text, uuid, text) from public;
grant execute on function public.get_public_hep(text, text, text, uuid, text) to anon, authenticated;

-- Logs one session of one exercise (done or skipped with an optional reason). The client sends the session
-- number it acted on; the server never re-picks it. Clinic day: today or yesterday (Slice 2 widens to 3 days).
create or replace function public.submit_exercise_log(
  p_token text,
  p_pin text,
  p_item_id uuid,
  p_session_index smallint,
  p_log_date date default null,
  p_skipped boolean default false,
  p_skip_reason text default null,
  p_device text default null
) returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, platform_admin
as $$
declare
  v record;
  v_patient_id uuid;
  v_belongs boolean;
  v_clinic uuid;
  v_today date;
  v_day date;
  v_reason text;
begin
  if not public.hep_rate_ok(p_token) then
    return jsonb_build_object('ok', false, 'reason', 'busy');
  end if;
  select * into v from public.hep_verify(p_token, p_pin, p_device);
  if v.outcome <> 'ok' then
    return jsonb_build_object('ok', false, 'reason', v.outcome, 'attemptsLeft', v.attempts_left);
  end if;
  v_patient_id := v.patient_id;

  select exists (
    select 1
      from public.program_items pi
      join public.programs prog on prog.id = pi.program_id
     where pi.id = p_item_id
       and prog.patient_id = v_patient_id
       and prog.status = 'active'
       and pi.removed_on is null
       and p_session_index between 1 and pi.sessions_per_day
  ) into v_belongs;
  if not v_belongs then
    return jsonb_build_object('ok', false, 'reason', 'not_in_program');
  end if;

  select p.clinic_id into v_clinic from public.patients p where p.id = v_patient_id;
  v_today := platform_admin.clinic_today(v_clinic);
  v_day := case when p_log_date in (v_today, v_today - 1) then p_log_date else v_today end;
  v_reason := case
    when coalesce(p_skipped, false)
     and p_skip_reason in ('pain', 'no_time', 'too_hard', 'forgot', 'didnt_understand', 'other') then p_skip_reason
    else null
  end;

  insert into public.program_logs (program_item_id, log_date, session_index, skipped, skip_reason, completed_at)
  values (p_item_id, v_day, p_session_index, coalesce(p_skipped, false), v_reason, now())
  on conflict (program_item_id, log_date, session_index) do update
    set skipped = excluded.skipped,
        skip_reason = excluded.skip_reason,
        completed_at = now();
  return jsonb_build_object('ok', true, 'logDate', v_day);
end;
$$;

revoke all on function public.submit_exercise_log(text, text, uuid, smallint, date, boolean, text, text) from public;
grant execute on function public.submit_exercise_log(text, text, uuid, smallint, date, boolean, text, text) to anon, authenticated;

-- Undo: removes that day's log for that session (done or skipped), so "Undo" works after Mark as done too.
create or replace function public.undo_exercise_skip(
  p_token text,
  p_pin text,
  p_item_id uuid,
  p_session_index smallint,
  p_log_date date default null,
  p_device text default null
) returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, platform_admin
as $$
declare
  v record;
  v_patient_id uuid;
  v_clinic uuid;
  v_today date;
  v_day date;
begin
  if not public.hep_rate_ok(p_token) then
    return jsonb_build_object('ok', false, 'reason', 'busy');
  end if;
  select * into v from public.hep_verify(p_token, p_pin, p_device);
  if v.outcome <> 'ok' then
    return jsonb_build_object('ok', false, 'reason', v.outcome, 'attemptsLeft', v.attempts_left);
  end if;
  v_patient_id := v.patient_id;

  if not exists (
    select 1
      from public.program_items pi
      join public.programs prog on prog.id = pi.program_id
     where pi.id = p_item_id and prog.patient_id = v_patient_id and prog.status = 'active'
  ) then
    return jsonb_build_object('ok', false, 'reason', 'not_in_program');
  end if;

  select p.clinic_id into v_clinic from public.patients p where p.id = v_patient_id;
  v_today := platform_admin.clinic_today(v_clinic);
  v_day := case when p_log_date in (v_today, v_today - 1) then p_log_date else v_today end;

  delete from public.program_logs
   where program_item_id = p_item_id
     and log_date = v_day
     and session_index = p_session_index;
  return jsonb_build_object('ok', true);
end;
$$;

revoke all on function public.undo_exercise_skip(text, text, uuid, smallint, date, text) from public;
grant execute on function public.undo_exercise_skip(text, text, uuid, smallint, date, text) to anon, authenticated;

-- End-of-session Pain | Effort check (amendment 53). Replaces earlier answers for the same session.
-- Marked exercises are filtered to the program's own items.
create or replace function public.submit_hep_session_feedback(
  p_token text,
  p_pin text,
  p_program_id uuid,
  p_session_index smallint,
  p_log_date date default null,
  p_pain smallint default null,
  p_effort smallint default null,
  p_pain_items uuid[] default '{}'::uuid[],
  p_hard_items uuid[] default '{}'::uuid[],
  p_device text default null
) returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, platform_admin
as $$
declare
  v record;
  v_clinic uuid;
  v_today date;
  v_day date;
  v_pain_items uuid[];
  v_hard_items uuid[];
begin
  if not public.hep_rate_ok(p_token) then
    return jsonb_build_object('ok', false, 'reason', 'busy');
  end if;
  select * into v from public.hep_verify(p_token, p_pin, p_device);
  if v.outcome <> 'ok' then
    return jsonb_build_object('ok', false, 'reason', v.outcome, 'attemptsLeft', v.attempts_left);
  end if;

  select prog.clinic_id into v_clinic
    from public.programs prog
   where prog.id = p_program_id and prog.patient_id = v.patient_id and prog.status = 'active';
  if v_clinic is null then
    return jsonb_build_object('ok', false, 'reason', 'not_in_program');
  end if;
  if (p_pain is null and p_effort is null)
     or (p_pain is not null and p_pain not between 0 and 10)
     or (p_effort is not null and p_effort not between 0 and 10)
     or p_session_index not between 1 and 3 then
    return jsonb_build_object('ok', false, 'reason', 'invalid');
  end if;

  v_today := platform_admin.clinic_today(v_clinic);
  v_day := case when p_log_date in (v_today, v_today - 1) then p_log_date else v_today end;

  select coalesce(array_agg(pi.id), '{}'::uuid[]) into v_pain_items
    from public.program_items pi
   where pi.program_id = p_program_id and pi.id = any(coalesce(p_pain_items, '{}'::uuid[]));
  select coalesce(array_agg(pi.id), '{}'::uuid[]) into v_hard_items
    from public.program_items pi
   where pi.program_id = p_program_id and pi.id = any(coalesce(p_hard_items, '{}'::uuid[]));

  insert into public.program_session_feedback (
    program_id, log_date, session_index, pain_score, effort_score, pain_item_ids, hard_item_ids
  ) values (
    p_program_id, v_day, p_session_index, p_pain, p_effort,
    case when p_pain is null then '{}'::uuid[] else v_pain_items end,
    case when p_effort is null then '{}'::uuid[] else v_hard_items end
  )
  on conflict (program_id, log_date, session_index) do update
    set pain_score = excluded.pain_score,
        effort_score = excluded.effort_score,
        pain_item_ids = excluded.pain_item_ids,
        hard_item_ids = excluded.hard_item_ids,
        created_at = now();
  return jsonb_build_object('ok', true);
end;
$$;

revoke all on function public.submit_hep_session_feedback(text, text, uuid, smallint, date, smallint, smallint, uuid[], uuid[], text) from public;
grant execute on function public.submit_hep_session_feedback(text, text, uuid, smallint, date, smallint, smallint, uuid[], uuid[], text) to anon, authenticated;

-- Hand-over panel (amendment 72): is the patient's page open yet? Polled every 5 s while the panel is open.
create or replace function public.hep_link_status(p_patient_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare v_clinic uuid; v jsonb;
begin
  select clinic_id into v_clinic from public.patients where id = p_patient_id;
  if v_clinic is null or not public.is_hep_staff(v_clinic) then
    raise exception 'Not authorized.';
  end if;
  select jsonb_build_object(
           'firstOpenedAt', (select max(first_opened_at) from public.programs where patient_id = p_patient_id and status = 'active'),
           'lastOpenedAt', a.last_opened_at,
           'openCount', a.open_count,
           'linkRevoked', a.link_revoked_at is not null)
    into v
    from public.patient_hep_access a where a.patient_id = p_patient_id;
  return coalesce(v, jsonb_build_object('openCount', 0));
end;
$$;
revoke all on function public.hep_link_status(uuid) from public, anon;
grant execute on function public.hep_link_status(uuid) to authenticated;

-- Pause, resume or complete a program without touching its exercises (update_program would soft-remove any item
-- not listed in p_items). Reactivating counts toward the Lite active-program cap, like update_program.
create or replace function public.set_program_status(p_program_id uuid, p_status text)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_prog public.programs;
  v_active_count int;
begin
  if p_status is null or p_status not in ('active', 'paused', 'completed') then
    raise exception 'Unknown status.';
  end if;
  select * into v_prog from public.programs where id = p_program_id for update;
  if not found or not public.is_hep_staff(v_prog.clinic_id) then
    raise exception 'Program not found.';
  end if;
  if p_status = 'active' and v_prog.status <> 'active' and not public.clinic_has_unlimited_hep(v_prog.clinic_id) then
    select count(*) into v_active_count from public.programs
     where clinic_id = v_prog.clinic_id and status = 'active' and id <> p_program_id;
    if v_active_count >= (select l.active_programs from public.hep_tier_limits('lite') l) then
      raise exception 'You have reached the free-plan limit of % active programs. Visit theranet.in to upgrade.',
        (select l.active_programs from public.hep_tier_limits('lite') l);
    end if;
  end if;
  update public.programs set status = p_status, updated_at = now() where id = p_program_id;
end;
$$;
revoke all on function public.set_program_status(uuid, text) from public, anon;
grant execute on function public.set_program_status(uuid, text) to authenticated;

-- Extend a program by 1 to 90 days (Extend on an ended program). An ongoing program has no end to extend.
create or replace function public.extend_program(p_program_id uuid, p_extra_days int)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare v_clinic uuid;
begin
  if p_extra_days is null or p_extra_days < 1 or p_extra_days > 90 then
    raise exception 'Extend by 1 to 90 days.';
  end if;
  select clinic_id into v_clinic from public.programs where id = p_program_id;
  if v_clinic is null or not public.is_hep_staff(v_clinic) then
    raise exception 'Program not found.';
  end if;
  update public.programs
     set duration_days = least(90, duration_days + p_extra_days), updated_at = now()
   where id = p_program_id and duration_days is not null;
end;
$$;
revoke all on function public.extend_program(uuid, int) from public, anon;
grant execute on function public.extend_program(uuid, int) to authenticated;

-- Shared pain review (amendment 28): set when any clinical staff member opens the program's Exercises view.
create or replace function public.mark_pain_reviewed(p_program_id uuid)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare v_clinic uuid;
begin
  select clinic_id into v_clinic from public.programs where id = p_program_id;
  if v_clinic is null or not public.is_hep_staff(v_clinic) then
    raise exception 'Not authorized.';
  end if;
  update public.programs set pain_reviewed_through = now(), updated_at = now() where id = p_program_id;
end;
$$;
revoke all on function public.mark_pain_reviewed(uuid) from public, anon;
grant execute on function public.mark_pain_reviewed(uuid) to authenticated;

-- 14. RPC: rotate_hep_token (authenticated clinic member only)
create or replace function public.rotate_hep_token(p_patient_id uuid)
returns text
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_clinic_id uuid;
  v_token text;
begin
  select clinic_id into v_clinic_id from public.patients where id = p_patient_id;
  if v_clinic_id is null or not public.is_hep_staff(v_clinic_id) then
    raise exception 'Not authorized.';
  end if;

  update public.patient_hep_access
     set token = public.generate_url_safe_token(),
         link_revoked_at = null,
         failed_attempts = 0,
         locked_until = null,
         updated_at = now()
   where patient_id = p_patient_id
   returning token into v_token;

  delete from public.hep_device_sessions where patient_id = p_patient_id;

  return v_token;
end;
$$;

revoke execute on function public.rotate_hep_token(uuid) from public, anon;
grant execute on function public.rotate_hep_token(uuid) to authenticated;
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/domain/hepRpcContract.test.ts --maxWorkers=2`
Expected: PASS

- [ ] **Step 5: Commit & Request Code Review**

```bash
git add supabase/migrations/20261113200000_hep_module.sql src/domain/hepRpcContract.test.ts
git commit -m "feat(hep): locked schema, templates, Lite caps, and PIN lockout RPCs"
```

---

### Task 1b: Patient-reported pain notifies the therapist (owner request 2026-11-12)

**Files:**
- Create: `supabase/migrations/20261113200100_hep_pain_push.sql`
- Modify: `supabase/functions/send-push/templates.ts`, `preferences.ts`, `index.ts` (new kind and category), plus their tests
- Modify: the account menu → Notifications "Which alerts do you want?" list (one more switch)
- Modify: `src/domain/hep.ts` (reuse `isHighPainAlert`, threshold 7)

**Behaviour (decided):**
- When a patient logs pain **7 or more** (the session pain score on `program_session_feedback.pain_score`, amendment 53), the **prescribing therapist** gets a push: `"<Patient first name> reported pain 8/10 after <first marked exercise title>" (or "after their exercises" when none is marked)` (kind `hep_high_pain`). If the program has no therapist with a login, the clinic's admins get it. The notification **respects the existing "Hide patient names in notifications" switch** (then: "A patient reported pain 8/10") and a new per-person switch **"Patient pain reports"** (category `hep_high_pain`, on by default, listed for admins and for therapists with a linked therapist profile; the prescriber is found through that profile, else the admins are told; never front desk). Tapping opens `/patients/$patientId?view=exercises`.
- **One alert per program per day** (tag `hep-pain-<programId>-<date>`; a higher score the same day may renew the same tag). Effort scores, pain under 7 and edits that don't raise the score never notify.
- The Active tab keeps its "Needs attention" filter and a pain chip; a **count of unreviewed pain reports** shows on the Exercises hub heading and a small dot on the patient's Exercises tab until a therapist opens the program (shared review state on the program: item 28, `pain_reviewed_through`).

**Migration (pattern: `notify_push`, as for booking requests and low ratings):**
```sql
alter table public.user_push_preferences drop constraint if exists user_push_preferences_category_check;
alter table public.user_push_preferences add constraint user_push_preferences_category_check
  check (category in ('booking_request','appointment_changes','low_rating_feedback','hide_patient_names','hep_high_pain'));

create or replace function public.session_feedback_pain_push_trigger()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_clinic uuid;
begin
  if new.pain_score is null or new.pain_score < 7 then return new; end if;
  -- On an edit, only a higher score notifies again (same tag, so the phone shows one alert per program per day).
  if tg_op = 'UPDATE' and coalesce(old.pain_score, -1) >= new.pain_score then return new; end if;
  select prog.clinic_id into v_clinic from public.programs prog where prog.id = new.program_id;
  perform public.notify_push('hep_high_pain', v_clinic, new.id);
  return new;
end $$;

create trigger program_session_feedback_pain_push
  after insert or update of pain_score on public.program_session_feedback
  for each row execute function public.session_feedback_pain_push_trigger();
```
`send-push` resolves recipients from the feedback row (feedback → program → therapist's login, else admins; the push names the first id in `pain_item_ids`), applies preferences and name hiding like the other kinds, and uses the same `hookAuth` as the other triggers.

**Tests:** pain 6 or an effort-only row sends nothing; 7 sends one; a second 9 the same day for the same program renews the same tag rather than adding a second; hide-names wording; switched-off person is skipped; recipient falls back to admins when the program has no therapist; the template never contains the PIN, phone number or token. Docs: add the alert to FEATURES_AND_SCHEMA.md §10 (Push Notifications) and the "Which alerts" list. Run this task right after Task 1 (it needs the tables) and apply the migration the same way (history row must match the file version).

### Task 2: Private R2 pictures: key rules, edge signer, `hep-media`, image tools (BUILT 2026-11-13)

**Files (all created; tests next to them):**
- `supabase/functions/_shared/hepMediaKeys.ts`: dependency-free key rules shared with the app (`exerciseMediaPrefix`, `buildExerciseMediaKey(clinic, exercise, index, suffix?)`, `buildExerciseThumbKey`, `newKeySuffix`, `parseExerciseMediaKey`, `isKeyForClinic`, `validateMediaKeysForClinic`). `src/lib/r2MediaKeys.ts` re-exports it for the browser (same pattern as `pushPreferences.ts`).
- `supabase/functions/_shared/r2Presign.ts`: **edge-only** SigV4 signer (`signPresignedUrl` generic, `presignR2Url` for R2, `startOfWindow`, `mintPublicHepViewUrls`, `hydratePublicHepWithSignedUrls(payload, config, allowedPrefix, now)`). The secret and the signing code live only here and in `hep-media/index.ts`; the browser never imports this file.
- `supabase/functions/_shared/hepMediaHandler.ts`: the function's logic with every dependency injected (so it is tested without a network); no imports.
- `supabase/functions/hep-media/index.ts`: wires the handler to Supabase (service client for `get_public_hep` and `hep_rate_ok_ip`; the caller's own JWT for `is_hep_staff`) and to R2 secrets; `supabase/config.toml` gets `[functions.hep-media] verify_jwt = false`.
- `src/lib/imageCompression.ts`: `compressImageForUpload(file, maxDimension = 1280, quality = 0.82, { blurBox? })` (GIFs pass through when at most 1 MB, else the error "That GIF is over 1 MB. Make it shorter or smaller, or use photos."; stills scaled down, never up, saved as WebP with a JPEG fallback), `createThumbnailBlob(source, 160)`, `applySoftFaceBlur(ctx, box, 8)` (clamped to the canvas, empty boxes skipped).
- Tests: `src/lib/r2Presign.test.ts`, `src/lib/hepMediaHandler.test.ts`, `src/lib/imageCompression.test.ts` (35 tests, run by `npm run test`).

**Behaviour (decided):**
- **Actions of `hep-media`:** `mint_upload_urls` (staff login; the **server** picks each key `clinics/{clinicId}/exercises/{exerciseId}/{0-3|thumb}-{8 random chars}` and signs a 15-minute PUT with `Cache-Control: private, max-age=604800` signed in, so the client must send exactly that header); `mint_view_urls` (staff login; at most 60 keys, all inside the caller's own clinic prefix, used for Library thumbnails and previews); `get_public_hep` (link + PIN: calls the database function; a failed PIN is passed through as `{ ok: false, reason, attemptsLeft }` with no clinic, program or picture data; a good one returns the payload with `mediaUrls` and **no** `mediaKeys`).
- **Access rule:** a key is signed only if it is a well-formed HEP key inside the clinic's prefix; for the patient page the clinic comes from the payload's own `clinicId`. `save_exercise` also refuses picture or thumbnail keys outside the clinic's prefix. A foreign key is dropped, never signed.
- **Rate limits:** the edge function calls `hep_rate_ok_ip` (real client IP from `cf-connecting-ip` / `x-forwarded-for`) before the database; over the limit gives HTTP 429 `{ ok: false, reason: 'busy' }`. If the counter itself errors it fails open (the per-link limit and the PIN lockout still apply).
- **Stable URLs (amendment 76):** view URLs are signed at the start of the current 30-minute window and valid 60 minutes, so the same picture has the same URL for 30 minutes and the browser cache works.
- **R2 not configured:** staff actions answer 503; the patient page still gets its text with `mediaUrls: []`.
- **Secrets** (`supabase secrets set`): `R2_ACCOUNT_ID`, `R2_BUCKET_NAME`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`. The bucket stays private; deploy notes in Task 9.
- **Verified:** the signer reproduces Amazon's published presigned-URL example byte for byte (`aeeed9bb...`); it has **not** been tried against a real R2 bucket, so before going live upload and fetch one test picture through `hep-media` once the secrets are set.
- **Database changes this task needed** (in the Task 1 migration): `get_public_hep` returns `clinicId`; `save_exercise(..., p_thumb_key text default null)` saves `exercises.thumb_key` and refuses keys outside the clinic prefix.

- [ ] **Step: commit**

```bash
git add src/lib/r2MediaKeys.ts src/lib/imageCompression.ts src/lib/imageCompression.test.ts src/lib/r2Presign.test.ts src/lib/hepMediaHandler.test.ts supabase/functions/_shared/hepMediaKeys.ts supabase/functions/_shared/r2Presign.ts supabase/functions/_shared/hepMediaHandler.ts supabase/functions/hep-media/index.ts supabase/config.toml
git commit -m "feat(hep): private R2 pictures: key rules, SigV4 signer, hep-media function, image tools"
```

---

### Task 3: Domain rules: adherence, timers, ranges, change summary, search, estimate (BUILT 2026-11-13)

**Files (created, with tests next to them):** `src/domain/hep.ts`, `src/domain/hepTimers.ts`, `src/domain/doseRange.ts`, `src/domain/programChanges.ts`; modified `src/domain/onboarding.ts` (+ test): `/p/` and `/hep` are allowed during clinic onboarding.

**What each holds**
- `hep.ts`: the types (`Exercise`, `ExerciseTemplate(Item)`, `Program(Item)`, `ProgramLog`, `DoseType`, `DoseFields` shared by template and program items), `EXERCISE_PHASES` in session order (Mobility before Stretching), `suggestedDoseType`, the region lists and `HEP_BODY_ORDER`, `canonicalRegion`, `regionTree` (Pelvic floor group, clinic regions after, archived hidden), `matchesExerciseSearch` (other names, plurals, hyphens, joined words, one typo in words of 5+ letters), the times-a-day rules (`sessionsPerDayOnDate`, `applySessionsPerDayEdit`, `nextSessionSlotToday`, `skippedSlotsToday`), `computeProgramAdherence` (finished days only, optional exercises ignored, days after the program's last day not counted), `sectionAdherence`, `sectionSkipPattern` (a section with nothing done on 4+ of the last 5 finished days while at least half of the rest was done), `estimateItemSeconds` / `estimateSessionMinutes`, the snapshot functions (copies, never links; they carry equipment, kind, rest, captions and `optional`).
- `hepTimers.ts`: `PT_READY = 5`, `PT_RELAX = 3`, `PT_BACK = 4`; `buildHoldPhases(reps, holdSeconds, eachSide)` (30 phases for 10 reps, 60 for each side), `buildTimedPhases(seconds, eachSide)` (3 or 6), `buildRestPhases(seconds)`, `TIMER_PHASE_CUES`, `totalPhaseSeconds`.
- `doseRange.ts`: `formatDose`, `isOutsideRange`. `programChanges.ts`: `summarizeProgramChanges(before, after)`.
- **Not built (dropped by the owner):** the queue helpers (`reorderQueueItem`, `deferQueueItemToEnd`).
- Tests: 61 across `hep.test.ts`, `hepTimers.test.ts`, `doseRange.test.ts`, `programChanges.test.ts`, `onboarding.test.ts`.

- [x] Committed: "feat(hep): domain rules: adherence, timers, ranges, change summary, search and session estimate".

---

### Task 4: Offline exercise cache and the services (BUILT 2026-11-13)

**Files:** modified `src/lib/db.ts` (Dexie `version(28)`: `exercises: 'id, clinicId, bodyRegion, [clinicId+updatedAt]'`; `'exercises'` added to `SyncedTable` and `ALL_SYNCED_TABLES`, NOT to `CLIENT_WRITABLE_TABLES`, so it is pull-only like `appointments`), `src/domain/syncCopy.ts` (label); created `src/services/hepService.ts`, `src/services/publicHepService.ts` and their tests. The tombstone coverage test passes because the migration creates `exercises_tombstone`.

**`hepService` (the clinic side).** Reads the library from the cache; every write is an online-only RPC and refuses offline with "HEP changes need a connection. Reconnect and try again.". The database's own messages (for example the free-plan limit with "theranet.in") are passed on unchanged.
- `listCachedExercises(clinicId, { includeArchived })`; `saveExercise` (every field, thumbnail key, archive with `active: false`; asks the sync to refresh the cache), `toggleExerciseFavorite`.
- `listTemplates` (items in order, `usedCount`), `saveTemplate` (with the note), `duplicateTemplate`, `saveProgramAsTemplate`.
- `createProgram` (existing patient only; settings as `p_settings`; returns `{ programId, patientId, token, pin }`, the PIN once), `updateProgram` (the WHOLE item list), `copyTemplateToProgram`, `duplicateProgram`, `setProgramStatus` (new RPC `set_program_status`: pause, resume, complete without touching the exercises), `extendProgram` (new RPC `extend_program`, 1 to 90 days), `markPainReviewed`.
- `resetPin` (shown once), `revokeLink`, `rotateToken`, `linkStatus` (the hand-over panel's poll).
- `listClinicPrograms(clinicId, since)` and `listPatientPrograms(patientId, since)`: one query with the items, the logs and session checks since `since` (the clinic's day minus the window), patient and therapist names, then the link state read with **listed columns only** (staff cannot read `pin_hash`). `mapProgramRow` is pure and tested. Programs and templates are not cached offline in Slice 1.
- `itemToJson` sends exactly the keys the database reads.

**`publicHepService` (the patient page).** Every call returns a value `{ ok: true, ... } | { ok: false, reason, attemptsLeft? }`; only a network or server failure throws (the page treats that as offline). `clinicBrand(token)`, `getPublicHep({ token, pin | device, programId, reason })` (through `hep-media`; a 429 body is read back as `busy`), `rememberDevice`, `submitExerciseLog`, `undoExerciseLog`, `submitSessionFeedback`. Reasons: `wrong_pin | locked | unavailable | pin_needed | busy | not_in_program | invalid | too_old`.

**Database additions this task needed** (in the Task 1 migration): `set_program_status`, `extend_program`.

- [ ] Commit: "feat(hep): offline exercise cache and the HEP services".

---

### Task 5: WhatsApp messages (BUILT 2026-11-13)

**Files:** `src/features/hep/hepSharing.ts`, `src/features/hep/hepSharing.test.ts` (10 tests). Uses the app's existing `buildWhatsAppSendUrl` (country-code aware, from `pdfShare.ts`).

- `buildHepPortalUrl(token, origin?)` -> `{origin}/p/{token}`.
- `buildHepShareMessage({ token, clinicName, origin? })`: first line "<clinic name>: here is your home exercise program.", the link, "Use your 4-digit PIN to unlock.", "Share this link only with the patient or the person helping them." No PIN, no patient name, no health detail, no consent wording. `buildHepWhatsAppShareUrl` opens the patient's own chat (or a contact picker when there is no number).
- The "Message patient" presets: `HEP_MESSAGE_KINDS` (reminder, how are you feeling, check-in, program ended, "Here is your exercise program again."), `buildHepPatientMessage`, `buildHepPatientMessageUrl`. Each is the clinic name, the preset text and the link, editable before sending; sending goes through the existing `whatsappSend` path (Task 7) and is logged with `message_log.kind = 'hep_reminder'`.
- The PIN is never an input to any of these.

- [ ] Commit: "feat(hep): WhatsApp messages for the HEP link".

---

### Task 6: The HEP area (`/hep`): Library, Edit exercise, Templates, Programs, and the menu entry (BUILT 2026-11-14)

**Built as planned, with these differences (read before Tasks 7 and 8):**
- Phones get a scrolling chip row of regions instead of a separate Filters sheet; equipment, type and search sit in a wrapping toolbar. The side list shows from 1000 px (`desktop:`).
- `ExerciseDoseEditor` has no `showRange` prop yet (ranges are Slice 2). Its props: `value`, `onChange`, `programSessionsPerDay?`, `showProgress?`, `showOptional?`. Shared dose rules live in `src/domain/hepDose.ts` (`DoseValue`, `describeDose`, `withKind`, progress chips, `exerciseToDose`).
- **Preview as patient** (Edit exercise) is NOT built: it waits for the patient exercise card (Task 8). A single photo is refused (the database wants 2 to 4 photos or one GIF).
- **Pictures (built 2026-11-14, after the owner tried it):** `PictureField` shows the accepted types and sizes up front (JPG, PNG or WebP up to 25 MB, GIF up to 1 MB; HEIC explained), takes drag and drop, and gives each photo an **Adjust or blur** editor (`PhotoEditor`: shape Original, Square, Wide 4:3, Tall 3:4; zoom; drag to frame; turn; blur faces by dragging) plus reorder, captions and an upload progress count. The crop and blur maths are in `src/domain/hepPhoto.ts` (blur boxes are stored against the whole picture so they follow it); `renderEditedPhoto` in `src/lib/imageCompression.ts` saves what the preview shows. A GIF is never edited. Checked in a real browser.
- `TemplatesTab` takes `onUse(template)` and `ProgramsTab` takes `onMessage(row)` and `onPrescribeNext(row)`: the buttons appear only when Task 7 passes them in. Pause, Resume, Extend, Mark completed and Duplicate already work.
- Dates in the Programs list follow the app's `formatDateDM` ("09/11"), not the preview's "08 Nov".
- The Library list is live from the local cache; a saved or archived exercise is written to the cache at once and the next sync replaces it.
- Starter set (`src/domain/hepStarterSet.ts`, 28 exercises, text only, no pelvic floor) is a DRAFT: **an owner or physio must read every line before it ships** (amendment 74). The test checks the marker stays in the file.
- Building blocks for Task 7: `src/features/hep/hepItems.ts` (copy an exercise into an item, sections, estimate), `programRows.ts` (the Programs row model and signals), `ExercisePicker`, `TemplateEditor`.

Read amendments 13 to 27, 61 to 69, 72 to 74, 77 to 81 first; they are the spec for this task (this task was rewritten on 2026-11-13 to match them; the preview's Screens 1 to 4 show the layouts). Slice 1 scope: no ranges ("+ range" hidden), no patient-changed numbers.

**Files:**
- Create: `src/features/hep/HepPage.tsx` (route component; tabs **Library · Templates · Programs**; `?tab=library|templates|programs`)
- Create: `src/features/hep/LibraryTab.tsx` (side list of regions with types, top bar, active-filters line, results grouped by region then type, List | Grid, 2 columns at 1024 px+, iPad Region button, phone chip row + Filters sheet, Used this week, Favourites, Show archived, Add from starter set)
- Create: `src/features/hep/ExerciseForm.tsx` (sheet; four sections Basics · How to do it · Default dose · Find it later; two columns at 1024 px+; Other names; photos with captions, Take photos, Choose photos, optional face blur; steps one per line with "Patient sees"; Stop if suggestions; kind and dose via `ExerciseDoseEditor`; Preview as patient; Duplicate…; Archive instead of Delete when used)
- Create: `src/features/hep/ExerciseDoseEditor.tsx` (the shared dose lines: How is it done?, Sets, Reps, Hold each rep, Time, Rest between sets with the quick chips, Other and + range; Side; Times a day with "Same as the program"; used by the Edit form, the template editor and the program sheet, amendment 67)
- Create: `src/features/hep/ExercisePicker.tsx` (sheet: the Library layout, checkboxes, "Add N exercises", side basket at 1024 px+, Used this week first, "+ New exercise" quick add)
- Create: `src/features/hep/TemplatesTab.tsx`, `src/features/hep/TemplateEditor.tsx` (cards 2 columns at 1024 px+, section counts, about N min, Use for a patient, ⋮ Duplicate / Delete; editor with collapsible sections, Times a day, the picker, the estimate)
- Create: `src/features/hep/ProgramsTab.tsx` (Mine | All, Needs attention · Active · Ended · Past with counts, search, the table and phone cards from one row model, signals and actions of amendment 66 plus "Link not opened yet" and "Skipping <section>")
- Create: `src/features/hep/StarterSetSheet.tsx` and `src/domain/hepStarterSet.ts` (the starter list; **content must be reviewed by the owner before shipping**, amendment 74)
- Create: tests next to each (`*.test.tsx`)
- Modify: `src/components/NavIcons.tsx` (`IconHep`), `src/app/navActive.ts` (`'/hep'` in `MainNavPath`, `PAGE_TITLES` 'HEP', phone tab maps to More), `src/app/Shell.tsx` and `src/app/ShellNav.test.ts` (NAV item **HEP** after Reports, hidden for front desk via `canUseExercises`, header width checked at `tab:` and `desktop:` beside the Place switch), `src/features/more/MorePage.tsx` (a **HEP** row on phones; no sixth bottom tab), `src/app/router.tsx` (`/hep` route; redirect to Workspace without `canUseExercises`), `src/app/usePermissions.ts` (`canUseExercises` = admin or therapist, amendment 13)

**Interfaces:**
- Consumes: Task 3 (`EXERCISE_PHASES`, `HEP_REGIONS`, `HEP_BODY_ORDER`, `regionTree`, `matchesExerciseSearch`, `suggestedDoseType`, `estimateSessionMinutes`, `sectionAdherence`), Task 4 (`hepService`: cached exercises, `saveExercise`, `saveTemplate`, `listTemplates`, `listPrograms`, `duplicate*`, `hepLinkStatus`), Task 2 (`compressImageForUpload`, `applySoftFaceBlur`, `hep-media` upload and thumbnail URLs), `TIER_LIMITS.exercises` / `activePrograms`, `useEntitlements`, `SheetDialog`, `ErrorNote`, `Button`
- Produces: `ExerciseDoseEditor` (props `{ value: DoseValue; onChange(v: DoseValue): void; programSessionsPerDay?: 1|2|3; showRange: boolean; showProgress?: boolean }`, `DoseValue = { kind: 'reps'|'hold'|'timed'; sets; reps|null; holdSeconds|null; durationSeconds|null; restSeconds; side; sessionsPerDay|null; optional?: boolean }`), `ExercisePicker` (props `{ open; onClose; onAdd(exercises: Exercise[]): void; basket?: DoseValue[] }`), used by Task 7.

- [ ] **Step 1: Write the failing tests**

```typescript
// LibraryTab.test.tsx
it('lists regions in body order with counts and opens a region to its types in session order');
it('counts an exercise under its also-regions, and Pelvic floor opens to Women and Men');
it('search finds "slr" by other name and "hamstrig" by one-typo match; shows "No matches in Face" with "N in other regions"');
it('Equipment and Type filters combine (OR inside, AND across) and show removable chips with Clear and the count');
it('pelvic floor rows show a text tile in list and grid; face rows show thumbnails');
it('shows Used this week above Favourites; Show archived reveals archived exercises with Restore');
it('front desk never reaches /hep (redirect) and the HEP menu item is hidden');
// ExerciseForm.test.tsx
it('choosing Type Stretching pre-selects Reps with hold; Timed hides Reps and Hold and shows Time');
it('"The patient reads" line updates: "3 sets × 12 reps · hold each for 10 s · each side · twice a day · rest 30 s"');
it('one step per line becomes a numbered "Patient sees" list');
it('warns "Similar: Clamshells (Hip)" without blocking save');
it('Delete becomes Archive when the exercise is used, with the explanation');
it('Save is disabled offline with "Needs a connection"');
// ExerciseDoseEditor.test.tsx
it('renders the same chips (Sets 1 2 3; Reps 5 8 10 12 15; Hold 5 10 30 s; Time 15 30 45 60 s; Rest 0 15 30 60 s) and Other');
it('hides + range when showRange is false; with ranges shows "upper is below lower"');
it('Progress chips add 1 set, 2 reps, 5 s hold or 15 s by kind');
// ExercisePicker.test.tsx
it('selecting two cards enables "Add 2 exercises"; exercises already in the program are disabled');
it('typing an unknown name offers "+ New exercise \"Bird dog\"", and Save and add calls saveExercise then onAdd');
// TemplatesTab.test.tsx
it('cards show section counts, Needs, about N min, used N times; Use for a patient opens the program sheet');
it('the editor groups rows in collapsible sections with Collapse all / Expand all and the estimate');
// ProgramsTab.test.tsx
it('Needs attention is the default and includes pain 7+, no activity 2+ days, check-in due, ended, link not opened 48 h');
it('"Opened 6×, nothing ticked" is grey and not in Needs attention');
it('Therapist column only in All; phone cards show the same values as the table rows');
it('ended rows offer Prescribe next; the ⋮ offers Extend and Mark completed');
```

- [ ] **Step 2: Run them to verify they fail**

Run: `npx vitest run src/features/hep --maxWorkers=2`
Expected: FAIL (modules not found).

- [ ] **Step 3: Implement the files above**, matching the preview's Screens 1 to 4 and the amendments. Every `<button>` has a `type`; money and phone rules from CLAUDE.md; tables pass `tableTypography.test.ts`; offline: browsing works from Dexie, saving shows "Needs a connection".

- [ ] **Step 4: Run them to verify they pass**

Run: `npx vitest run src/features/hep src/app/ShellNav.test.ts src/components/tableTypography.test.ts --maxWorkers=2`
Expected: PASS

- [ ] **Step 5: Commit and request code review**

```bash
git add src/features/hep src/domain/hepStarterSet.ts src/components/NavIcons.tsx src/app/navActive.ts src/app/Shell.tsx src/app/ShellNav.test.ts src/features/more/MorePage.tsx src/app/router.tsx src/app/usePermissions.ts
git commit -m "feat(hep): HEP area with Library, Edit exercise, Templates and Programs"
```

---

### Task 7: The patient chart's Home program tab, the program sheet, hand-over, and the visit / note entry

Read amendments 28 to 38, 45, 50, 53, 59, 64 to 73, 75, 77, 80, 81 first (rewritten 2026-11-13; the preview's Screen 5 shows the layout).

**Files:**
- Create: `src/features/hep/HomeProgramTab.tsx` (program switcher with Completed (n), header, Needs your attention box with "Reviewed ✓ just now" for this visit, Progress tiles with session Pain and Effort trends, day strip and the day's sessions timeline, By section, By exercise with Hurt / Hardest / Did less, Patient link line)
- Create: `src/features/hep/ProgramSheet.tsx` (New / Edit home program: Edit current or Start a separate program; Start from Same as last time / Template (recent and matching region first) / Earlier program / Library; Program name; Times a day; sections of `ExerciseDoseEditor` rows with "So far" numbers and Progress chips on edits; Optional switch per row and per section; + Add exercises (`ExercisePicker`); the estimate; the change summary box with the optional message; Length, Start, Check in, Prescribed by; Advanced: Pain first / Effort first, Counts as completed at, own PIN; Preview as patient; Cancel with "Discard changes?" only when edited)
- Create: `src/features/hep/HandOverPanel.tsx` (after Save and after Reset PIN: the PIN once with Copy, the four steps, Show PIN on screen overlay, Print sheet with PIN, polling `hep_link_status` every 5 s for up to 10 minutes, Skip for now; "Use this again? Save as template" once for programs not from a template)
- Create: `src/features/hep/PrintSheet.tsx` (`@media print` layout: clinic, patient, PIN only when passed in at creation or reset, exercises by section with pictures, steps and dose)
- Create: tests next to each
- Modify: `src/features/patients/PatientViewTabs.tsx` and its test (`PatientView = 'visits' | 'invoices' | 'home-program'`; the **Home program** tab shows for admins and therapists regardless of `showInvoicesTab`, with the red dot while pain is unreviewed; hidden for front desk), `src/features/patients/PatientProfilePage.tsx` (render the tabs always; `view=home-program`), `src/app/router.tsx` (`validateSearch` accepts `view: 'home-program'`), `src/features/patients/NoteEditorPage.tsx` and `src/features/patients/SessionNoteEditorBody.tsx` (Section 8 "Home exercise program": the read-only "Digital program: <name>, day N, X%" line and a **Home program** button that opens `ProgramSheet` for that patient with the start date = the visit date; never calls the note's `update()` or marks it changed)

**Interfaces:**
- Consumes: Task 6 (`ExerciseDoseEditor`, `ExercisePicker`), Task 5 (`buildHepWhatsAppShareUrl`), Task 3 (`computeProgramAdherence` ignoring optional items, `estimateSessionMinutes`, `sectionAdherence`, `summarizeProgramChanges`, `isHighPainAlert`), Task 4 (`hepService.createProgram(p_settings)`, `updateProgram(p_settings)`, `markPainReviewed`, `resetPin`, `revokeLink`, `hepLinkStatus`, `listProgramDetail`), `HepExerciseScreen` from Task 8 for Preview as patient.
- Produces: `<ProgramSheet open onClose patientId mode="new"|"edit" programId? startDate? onSaved(result) />`, `<HomeProgramTab patientId />`.

- [ ] **Step 1: Write the failing tests**

```typescript
// HomeProgramTab.test.tsx
it('opening the tab calls markPainReviewed once and still shows the pain report with "Reviewed ✓ just now" for this visit');
it('shows Needs your attention only when there is something (pain 7+, check-in due, ended, link not opened, skipping a section)');
it('Today counts sessions ("3 of 8") and the habit % ignores optional exercises');
it('tapping a day shows Morning and Evening with ticks, skips with reasons and the Pain / Effort chips');
it('By exercise shows Hurt n×, Hardest n× and "Did less" rows');
it('the tab is hidden for front desk and shown with Invoices hidden (showInvoicesTab false)');
// ProgramSheet.test.tsx
it('opening and cancelling never changes the parent note (onSaved not called, no update())');
it('Times a day applies to every row; a row override reads "Only this one: once a day"');
it('editing a live program shows "So far" numbers and Progress chips; the change summary lists only changed rows');
it('the estimate reads "About 23 min morning · 18 min evening" and shows no warning at any length');
it('Optional on a row and "make the section optional" send optional: true for those items');
it('Advanced sends feedbackDefault "effort" when Effort first is chosen; settings go in p_settings');
it('Same as last time starts from the latest completed or ended program');
// HandOverPanel.test.tsx
it('shows the PIN once, Show PIN opens a full-screen overlay, and the WhatsApp text never contains the PIN');
it('polls hep_link_status and shows "Opened ✓ 10:42" when firstOpenedAt arrives; stops after 10 minutes');
it('offers Save as template once for a program that did not come from a template');
```

- [ ] **Step 2: Run them to verify they fail**

Run: `npx vitest run src/features/hep src/features/patients --maxWorkers=2`
Expected: FAIL (modules not found).

- [ ] **Step 3: Implement the files above**, matching the preview's Screen 5 and the amendments. The PIN is never stored on the device or in logs; Print sheet with PIN is only offered where the PIN was just returned.

- [ ] **Step 4: Run them to verify they pass**

Run: `npx vitest run src/features/hep src/features/patients --maxWorkers=2`
Expected: PASS

- [ ] **Step 5: Commit and request code review**

```bash
git add src/features/hep src/features/patients src/app/router.tsx
git commit -m "feat(hep): Home program tab, program sheet, hand-over and visit entry"
```

---

### Task 8: Public Patient Page, Slice 1 (`/p/$token`): Sign in and Exercises (cards, timers, end-of-session check)

Read amendments 39 to 41 and 51 to 60 first. Slice 1 has **no Home tab**: after sign-in the page is the Exercises view of the current program (with a small program switcher when there are several active programs). Home, ranges, patient-changed numbers, the offline queue, Do later, the check-in and the end-of-program screen are Task 10 (Slice 2).

**Files:**
- Create: `src/features/publicHep/PublicHepPage.tsx` (state machine: brand load -> Sign in -> Exercises; noindex meta while mounted; R2 refresh)
- Create: `src/features/publicHep/HepSignIn.tsx` (brand, PIN with auto-submit, Remember this phone, wrong/locked/unavailable/busy messages)
- Create: `src/features/publicHep/HepExercises.tsx` (program header "Day N of M", "Today: X of Y done" counted in sessions, Sound switch, calendar reminder button, cards, "Rate this session" link, Forget this phone)
- Create: `src/features/publicHep/HepChecklist.tsx` (session switch, sections with All done / Skip ›, rows with the square tick, short dose and picture tile, Start / Continue) and `src/features/publicHep/HepExerciseScreen.tsx` (one exercise per screen: picture, timer over the picture, one-line dose, Start / Rest, steps open the first time then collapsed, Stop if, Skip and ✓ Done · Next ›) (amendment 82; they replace the expanding `HepExerciseCard`)
- Create: `src/features/publicHep/HepTimer.tsx` (ring for Hold and Go; amber/blue bars with Skip for the short phases; end-time based; one AudioContext; speech cues)
- Create: `src/features/publicHep/HepSessionCheck.tsx` (Pain | Effort switch, 0 to 10 buttons with words, exercise chips, Not now)
- Create: `src/features/publicHep/hepCalendar.ts` (`buildHepReminderIcs(...)`, pure)
- Create: tests next to each (`*.test.tsx` / `hepCalendar.test.ts`)
- Modify: `src/app/Shell.tsx` (bypass for `/p/`, as for `/f/` and `/book/`), `src/app/router.tsx` (register `/p/$token`), `src/domain/onboarding.ts` (`/p/` allowed during clinic onboarding)

**Interfaces:**
- Consumes: `hep_clinic_brand(p_token)`; `hep-media` `get_public_hep(p_token, p_pin, p_device, p_program_id, p_reason)` (programs plus `mediaUrls` for the shown program only); `hep_remember_device`; `submit_exercise_log(p_token, p_pin, p_item_id, p_session_index, p_log_date, p_skipped, p_skip_reason, p_device)`; `undo_exercise_skip`; `submit_hep_session_feedback`; from Task 3: `computeProgramAdherence`, `sessionsPerDayOnDate`, `nextSessionSlotToday`, `skippedSlotsToday`, `buildHoldPhases`, `buildTimedPhases`, `buildRestPhases`, `isHighPainAlert`; `formatAmount`/`splitPhone` rules from CLAUDE.md (no `₹`, no +91).
- Produces: `buildHepReminderIcs(opts: { clinicName: string; url: string; times: string[] /* 'HH:MM' */; startDate: string; endDate: string | null }): string` (one VEVENT per time, `RRULE:FREQ=DAILY` with `UNTIL` = end date, or `COUNT=90` when `endDate` is null; floating local time; no patient name).

- [ ] **Step 1: Write the failing tests**

```typescript
// src/features/publicHep (mock getSupabase().rpc and functions.invoke as other public pages do)
it('shows the clinic name and logo, "Your Home Exercise Program", and no exercise or patient name before the PIN');
it('shows the generic page with no brand for an unknown or revoked link');
it('shows "That PIN isn\'t right. 2 tries left." then "Too many tries. Please try again in 15 minutes." and no titles when locked');
it('opens without a PIN on a remembered phone and falls back to the PIN screen on pin_needed');
it('shows "Please wait a minute and try again" when the server answers busy');
it('Forget this phone removes the device token from localStorage');

// HepExerciseCard.test.tsx
it('quick tick on a closed card logs the next open session and offers Undo');
it('a twice-a-day exercise shows Morning and Evening ticks and "Mark as done: Evening" after the morning is done');
it('Skip requires one reason chip and sends p_skip_reason; Undo calls undo_exercise_skip');
it('shows "You will need: Theraband" and "Each side" when set');
it('"Today: 3 of 8 done" counts exercise sessions, not exercises');

// HepTimer.test.tsx (fake timers and a mocked Date.now)
it('Start 10 holds runs Get into position 5 s, Hold, Relax 3 s, Back to position 4 s, and no Back after the last rep');
it('an each-side exercise shows "Now the other side" once and restarts rep numbers with "Side 2"');
it('Skip on a short phase moves to the next phase immediately; the Hold ring has no Skip, only Stop');
it('the remaining time is computed from the phase end time, so a 20 s jump of Date.now() shows the right second');
it('speaks "Hold" when a hold starts with Sound = Voice, beeps with Sound = Beeps, and is silent with Off');

// HepSessionCheck.test.tsx
it('appears when every exercise of the session has a status, and from "Rate this session" at any time');
it('opens on Effort when the program feedback_default is effort; switching keeps entered values');
it('Pain 8 with Wall Slides marked sends p_pain = 8 and p_pain_items = [wall slides id] and shows the Call button');

// hepCalendar.test.ts
it('builds one daily VEVENT per time with UNTIL on the end date, or COUNT=90 when ongoing');
it('contains the clinic name and the link but never a patient name');
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/features/publicHep --maxWorkers=2`
Expected: FAIL (modules not found).

- [ ] **Step 3: Implement the files above**

Follow amendments 40 (sign-in part only), 41, 51, 53, 56, 57 and 58. Key rules: 44 px touch targets, body 16 px and instructions 18 px in `rem`; the verified PIN in React state only; the device token only in `localStorage` under a key scoped to the link token (try/catch everywhere); media URLs refreshed at about 13.5 minutes or after one `<img>` error; `<meta name="robots" content="noindex, nofollow">` while mounted; no booking, feedback, Google review, invoice or note links in Slice 1.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/features/publicHep --maxWorkers=2`
Expected: PASS

- [ ] **Step 5: Commit and request code review**

```bash
git add src/features/publicHep src/app/Shell.tsx src/app/router.tsx src/domain/onboarding.ts
git commit -m "feat(hep): patient page slice 1 (sign in, exercise cards with timers, session pain/effort check)"
```

---

### Task 9: Canonical Documentation (`FEATURES_AND_SCHEMA.md` & `README.md`) & Full Verification

**Files:**
- Modify: `FEATURES_AND_SCHEMA.md`
- Modify: `README.md`

**Interfaces:**
- Consumes: All tables, RPCs, routes, and locked business rules from Tasks 1–8.
- Produces: Synchronized canonical documentation in both copies of sections inside `FEATURES_AND_SCHEMA.md` and `README.md`.

- [ ] **Step 1: Update `FEATURES_AND_SCHEMA.md` and `README.md` (during implementation PR, never in a plan-only commit)**

Document:
- Tables: `exercises`, `exercise_templates`, `exercise_template_items`, `programs`, `program_items`, `patient_hep_access`, `program_logs`.
- RPCs: `save_exercise`, `save_template`, `create_program`, `update_program`, `copy_template_to_program`, `save_program_as_template`, `duplicate_program`, `duplicate_template`, `toggle_exercise_favorite`, `hep_verify` (internal, never raises), `get_public_hep`, `submit_exercise_log`, `undo_exercise_skip` (the three public ones return `{ ok, reason, attemptsLeft }`), `rotate_hep_token`, `revoke_hep_link`, `reset_hep_pin`, `hep_tier_limits`.
- Routes: `/exercises` (Library, Templates, Active) and `/p/$token` (Slice 1: Sign in and Exercises; Slice 2 adds Home); `/p/` bypasses the Shell and the onboarding gate, `noindex` in `vercel.json`.
- Lite caps: from `TIER_LIMITS` (`exercises` 10, `activePrograms` 5), parity-tested with `hep_tier_limits`.
- **Design exception:** HEP writes are online-only (the rest of the app is offline-first); say why (server caps and snapshots, R2 media, online patient portal).
- **Remembered phones:** `hep_device_sessions` (hash only, 30 days sliding, 180 cap, 5 per patient), cleared by Stop sharing, Reset PIN and a new link.
- **PIN and link:** random 4-digit PIN stored hashed, shown once to the therapist, never in the WhatsApp message; lockout 5 wrong tries / 15 minutes persists because the check never raises; link stops when revoked or the patient is hidden; the day a log counts for is the clinic's.
- **R2:** private bucket, keys `clinics/{clinicId}/exercises/{id}/{n}`, presigned 900 s URLs, secrets and `[functions.hep-media] verify_jwt = false`; India-only/other-country surfaces unaffected.
- **Pain alert:** push `hep_high_pain` for a patient-reported pain of 7 or more (Task 1b); new "Patient pain reports" switch.
- **Backup:** HEP tables in `backupService`, or list exactly what is excluded.
- Deferred: in-clinic QR code.

- [ ] **Step 2: Run full verification suite**

Run:
```bash
npm run check:fast
npx vitest run src/domain/hepRpcContract.test.ts src/lib/r2Presign.test.ts src/lib/imageCompression.test.ts src/domain/hep.test.ts src/services/hepService.test.ts src/features/hep/hepSharing.test.ts src/features/hep/ExercisesPage.test.tsx src/features/hep/PrescribeProgramSheet.test.tsx src/features/publicHep/PublicHepPage.test.tsx src/sync/__tests__/tombstoneCoverage.test.ts src/components/tableTypography.test.ts src/app/ShellNav.test.ts src/features/patients/PatientViewTabs.test.tsx --maxWorkers=2
```
Expected: ALL PASS with zero typecheck or lint errors.

- [ ] **Step 3: Commit & Final Code Review**

```bash
git add FEATURES_AND_SCHEMA.md README.md
git commit -m "docs(hep): document HEP tables, RPCs, Lite caps, and /p/ portal in canonical docs"
```

---

### Task 10: Slice 2 (after Slice 1 has been used and measured; amendment 52)

Read amendments 40, 42 to 49, 54, 57 and 58. Own migration, dated when Slice 2 starts (after the newest file in `supabase/migrations/`), applied live and recorded in `schema_migrations` under the file's version (CLAUDE.md).

**Schema:** `<sets|reps|seconds|hold>_max` on `exercises`, `exercise_template_items`, `program_items` (item 42); `program_logs.actual_sets / actual_reps / actual_seconds / actual_hold_s` and `p_actual jsonb` on `submit_exercise_log` (item 43); `programs.change_summary / patient_note / last_changed_at` (item 45); `clinics.patient_page jsonb`, `clinics.referral_phone` (item 48); `get_patient_home(p_token, p_pin, p_device)` (items 40, 58); the 3-day `p_log_date` window and `reason: 'too_old'` (item 54); `program_checkins` + `submit_hep_checkin` (item 30); `program_outcomes` + `submit_hep_outcome` (item 34); the agenda email block and re-reminder cron (item 35).

**SQL:**

```sql
-- Slice 2 migration (amendments 30, 34, 42, 43, 45, 48, 54; file dated when Slice 2 starts)

-- Ranges (item 42, names per amendment 62)
alter table public.exercises
  add column if not exists default_sets_max smallint check (default_sets_max is null or default_sets_max between 1 and 20),
  add column if not exists default_reps_max smallint check (default_reps_max is null or default_reps_max between 1 and 600),
  add column if not exists default_hold_seconds_max smallint check (default_hold_seconds_max is null or default_hold_seconds_max between 1 and 600),
  add column if not exists default_duration_seconds_max smallint check (default_duration_seconds_max is null or default_duration_seconds_max between 1 and 3600);
alter table public.exercises add constraint exercises_ranges_check check (
  (default_sets_max is null or default_sets_max >= default_sets)
  and (default_reps_max is null or (default_reps is not null and default_reps_max >= default_reps))
  and (default_hold_seconds_max is null or (default_hold_seconds is not null and default_hold_seconds_max >= default_hold_seconds))
  and (default_duration_seconds_max is null or (default_duration_seconds is not null and default_duration_seconds_max >= default_duration_seconds))
);
alter table public.exercise_template_items
  add column if not exists sets_max smallint check (sets_max is null or sets_max between 1 and 20),
  add column if not exists reps_max smallint check (reps_max is null or reps_max between 1 and 600),
  add column if not exists hold_seconds_max smallint check (hold_seconds_max is null or hold_seconds_max between 1 and 600),
  add column if not exists duration_seconds_max smallint check (duration_seconds_max is null or duration_seconds_max between 1 and 3600);
alter table public.program_items
  add column if not exists sets_max smallint check (sets_max is null or sets_max between 1 and 20),
  add column if not exists reps_max smallint check (reps_max is null or reps_max between 1 and 600),
  add column if not exists hold_seconds_max smallint check (hold_seconds_max is null or hold_seconds_max between 1 and 600),
  add column if not exists duration_seconds_max smallint check (duration_seconds_max is null or duration_seconds_max between 1 and 3600);
alter table public.program_items add constraint program_items_ranges_check check (
  (sets_max is null or sets_max >= sets)
  and (reps_max is null or (reps is not null and reps_max >= reps))
  and (hold_seconds_max is null or (hold_seconds is not null and hold_seconds_max >= hold_seconds))
  and (duration_seconds_max is null or (duration_seconds is not null and duration_seconds_max >= duration_seconds))
);
-- (the same constraint as exercise_template_items_ranges_check on exercise_template_items)
-- The *_max columns are copied wherever `side` is copied, and returned by get_public_hep as
-- 'setsMax', 'repsMax', 'holdSecondsMax', 'durationSecondsMax'.

-- What the patient actually did, when they changed a number (item 43). NULL = untouched.
alter table public.program_logs
  add column if not exists actual_sets smallint check (actual_sets is null or actual_sets between 1 and 99),
  add column if not exists actual_reps smallint check (actual_reps is null or actual_reps between 1 and 600),
  add column if not exists actual_hold_s smallint check (actual_hold_s is null or actual_hold_s between 1 and 600),
  add column if not exists actual_duration_s smallint check (actual_duration_s is null or actual_duration_s between 1 and 3600);

-- Change summary for the "Updated by your therapist" banner (item 45), written by update_program.
alter table public.programs
  add column if not exists change_summary jsonb not null default '[]'::jsonb,
  add column if not exists patient_note text check (patient_note is null or char_length(patient_note) <= 300),
  add column if not exists last_changed_at timestamptz;
-- update_program gains p_change_summary jsonb and p_patient_note text (built in TS by summarizeProgramChanges)
-- and sets last_changed_at = now() when the summary is not empty.

-- Settings -> Patient page (item 48)
alter table public.clinics
  add column if not exists patient_page jsonb not null
    default '{"appointments":true,"packages":true,"book":true,"refer":true}'::jsonb,
  add column if not exists referral_phone text;

-- End-of-day check-in (item 30) and end-of-program outcome (item 34)
create table if not exists public.program_checkins (
  id uuid primary key default gen_random_uuid(),
  program_id uuid not null references public.programs(id) on delete cascade,
  log_date date not null,
  feeling smallint not null check (feeling in (1, 2, 3)), -- 1 better, 2 same, 3 worse
  note text check (note is null or char_length(note) <= 200),
  created_at timestamptz not null default now(),
  unique (program_id, log_date)
);
create table if not exists public.program_outcomes (
  id uuid primary key default gen_random_uuid(),
  program_id uuid not null unique references public.programs(id) on delete cascade,
  outcome text not null check (outcome in ('met', 'not_met')),
  habit_pct smallint check (habit_pct between 0 and 100),
  reasons text[] not null default '{}'::text[],
  difficulty smallint check (difficulty is null or difficulty between 1 and 3),
  note text check (note is null or char_length(note) <= 300),
  submitted_at timestamptz not null default now()
);
alter table public.program_checkins enable row level security;
alter table public.program_outcomes enable row level security;
create policy program_checkins_select on public.program_checkins for select to authenticated
  using (exists (select 1 from public.programs p where p.id = program_checkins.program_id and public.is_hep_staff(p.clinic_id)));
create policy program_outcomes_select on public.program_outcomes for select to authenticated
  using (exists (select 1 from public.programs p where p.id = program_outcomes.program_id and public.is_hep_staff(p.clinic_id)));

-- One rule for the accepted log day in every public write (item 54): today back to 3 days before, clinic zone.
create or replace function public.hep_log_day(p_clinic uuid, p_log_date date)
returns date
language sql
stable
security definer
set search_path = pg_catalog, public, platform_admin
as $$
  select case
    when p_log_date is null then platform_admin.clinic_today(p_clinic)
    when p_log_date between platform_admin.clinic_today(p_clinic) - 3 and platform_admin.clinic_today(p_clinic)
      then p_log_date
    else null  -- caller returns reason 'too_old'
  end;
$$;
revoke all on function public.hep_log_day(uuid, date) from public, anon, authenticated;
-- submit_exercise_log, undo_exercise_skip and submit_hep_session_feedback replace their
--   "v_day := case when p_log_date in (v_today, v_today - 1) ..." line with:
--   v_day := public.hep_log_day(v_clinic, p_log_date);
--   if v_day is null then return jsonb_build_object('ok', false, 'reason', 'too_old'); end if;
-- and submit_exercise_log gains a trailing p_actual jsonb default null, writing (only when not skipped)
--   actual_sets   = nullif((p_actual ->> 'sets'), '')::smallint,
--   actual_reps   = nullif((p_actual ->> 'reps'), '')::smallint,
--   actual_duration_s = nullif((p_actual ->> 'durationSeconds'), '')::smallint,
--   actual_hold_s = nullif((p_actual ->> 'holdSeconds'), '')::smallint
-- (values outside the column checks return reason 'invalid'; update the grant signature).

create or replace function public.submit_hep_checkin(
  p_token text, p_pin text, p_program_id uuid, p_feeling smallint,
  p_note text default null, p_log_date date default null, p_device text default null
) returns jsonb
language plpgsql security definer set search_path = pg_catalog, public, platform_admin as $$
declare v record; v_clinic uuid; v_day date;
begin
  if not public.hep_rate_ok(p_token) then return jsonb_build_object('ok', false, 'reason', 'busy'); end if;
  select * into v from public.hep_verify(p_token, p_pin, p_device);
  if v.outcome <> 'ok' then
    return jsonb_build_object('ok', false, 'reason', v.outcome, 'attemptsLeft', v.attempts_left);
  end if;
  select clinic_id into v_clinic from public.programs
   where id = p_program_id and patient_id = v.patient_id and status = 'active';
  if v_clinic is null then return jsonb_build_object('ok', false, 'reason', 'not_in_program'); end if;
  if p_feeling not in (1, 2, 3) then return jsonb_build_object('ok', false, 'reason', 'invalid'); end if;
  v_day := public.hep_log_day(v_clinic, p_log_date);
  if v_day is null then return jsonb_build_object('ok', false, 'reason', 'too_old'); end if;
  insert into public.program_checkins (program_id, log_date, feeling, note)
  values (p_program_id, v_day, p_feeling, nullif(left(btrim(coalesce(p_note, '')), 200), ''))
  on conflict (program_id, log_date) do update
    set feeling = excluded.feeling, note = excluded.note, created_at = now();
  return jsonb_build_object('ok', true);
end $$;
revoke all on function public.submit_hep_checkin(text, text, uuid, smallint, text, date, text) from public;
grant execute on function public.submit_hep_checkin(text, text, uuid, smallint, text, date, text) to anon, authenticated;
-- A 'worse' check-in (feeling = 3) or a non-empty note sends the 'hep_high_pain' kind push through a trigger
-- on program_checkins, the same way as Task 1b (the push never contains the note).

create or replace function public.submit_hep_outcome(
  p_token text, p_pin text, p_program_id uuid, p_habit_pct smallint,
  p_reasons text[] default '{}'::text[], p_difficulty smallint default null,
  p_note text default null, p_device text default null
) returns jsonb
language plpgsql security definer set search_path = pg_catalog, public, platform_admin as $$
declare v record; v_prog public.programs; v_end date;
begin
  if not public.hep_rate_ok(p_token) then return jsonb_build_object('ok', false, 'reason', 'busy'); end if;
  select * into v from public.hep_verify(p_token, p_pin, p_device);
  if v.outcome <> 'ok' then
    return jsonb_build_object('ok', false, 'reason', v.outcome, 'attemptsLeft', v.attempts_left);
  end if;
  select * into v_prog from public.programs where id = p_program_id and patient_id = v.patient_id;
  if v_prog.id is null or v_prog.duration_days is null then
    return jsonb_build_object('ok', false, 'reason', 'not_in_program');
  end if;
  v_end := v_prog.start_date + v_prog.duration_days - 1;
  if platform_admin.clinic_today(v_prog.clinic_id) <= v_end then
    return jsonb_build_object('ok', false, 'reason', 'not_ended');
  end if;
  if p_habit_pct not between 0 and 100 or (p_difficulty is not null and p_difficulty not between 1 and 3)
     or exists (select 1 from unnest(coalesce(p_reasons, '{}'::text[])) r
                 where r not in ('pain', 'no_time', 'forgot', 'didnt_understand', 'felt_better', 'other')) then
    return jsonb_build_object('ok', false, 'reason', 'invalid');
  end if;
  insert into public.program_outcomes (program_id, outcome, habit_pct, reasons, difficulty, note)
  values (
    p_program_id,
    case when p_habit_pct >= v_prog.target_pct then 'met' else 'not_met' end,
    p_habit_pct, coalesce(p_reasons, '{}'::text[]), p_difficulty,
    nullif(left(btrim(coalesce(p_note, '')), 300), '')
  )
  on conflict (program_id) do nothing;  -- asked once; reopening shows the thank-you
  return jsonb_build_object('ok', true);
end $$;
revoke all on function public.submit_hep_outcome(text, text, uuid, smallint, text[], smallint, text, text) from public;
grant execute on function public.submit_hep_outcome(text, text, uuid, smallint, text[], smallint, text, text) to anon, authenticated;
-- The habit % comes from the page's computeProgramAdherence (one rule, in TS; item 34). The server checks only
-- its range; the therapist's own view recomputes it from the logs.

-- Home tab data (items 40, 58). Returns only the listed fields; a card switched off returns nothing.
create or replace function public.get_patient_home(p_token text, p_pin text, p_device text default null)
returns jsonb
language plpgsql security definer set search_path = pg_catalog, public, platform_admin as $$
declare
  v record; v_patient public.patients; v_clinic public.clinics; v_cards jsonb;
  v_next jsonb; v_pkg jsonb; v_programs jsonb;
begin
  if not public.hep_rate_ok(p_token) then return jsonb_build_object('ok', false, 'reason', 'busy'); end if;
  select * into v from public.hep_verify(p_token, p_pin, p_device);
  if v.outcome <> 'ok' then
    return jsonb_build_object('ok', false, 'reason', v.outcome, 'attemptsLeft', v.attempts_left);
  end if;
  select * into v_patient from public.patients where id = v.patient_id;
  select * into v_clinic from public.clinics where id = v_patient.clinic_id;
  v_cards := jsonb_build_object(
    'appointments', coalesce((v_clinic.patient_page ->> 'appointments')::boolean, true),
    'packages',     coalesce((v_clinic.patient_page ->> 'packages')::boolean, true),
    'book',         coalesce((v_clinic.patient_page ->> 'book')::boolean, true) and v_clinic.online_booking_enabled
                    and v_clinic.booking_slug is not null,
    'refer',        coalesce((v_clinic.patient_page ->> 'refer')::boolean, true)
  );

  if (v_cards ->> 'appointments')::boolean then
    select jsonb_build_object('startsAt', a.scheduled_at,
                              'therapist', nullif(split_part(btrim(coalesce(t.name, '')), ' ', 1), ''))
      into v_next
      from public.appointments a
      left join public.therapists t on t.id = a.therapist_id
     where a.patient_id = v.patient_id and a.clinic_id = v_clinic.id
       and a.scheduled_at > now() and a.status in ('confirmed', 'rescheduled')
     order by a.scheduled_at
     limit 1;
  end if;

  -- Packages: return the raw package sessions; the page runs the app's own rule (groupOpenPackages,
  -- packageExpiresOn, sessionsRemaining in src/domain/packageTracking.ts) so there is one rule, not two.
  if (v_cards ->> 'packages')::boolean then
    select coalesce(jsonb_agg(jsonb_build_object(
             'id', vi.id, 'packageGroupId', vi.package_group_id, 'packageTotal', vi.package_total,
             'visitDate', vi.visit_date, 'packageValidityDays', vi.package_validity_days,
             'serviceName', sc.name)), '[]'::jsonb)
      into v_pkg
      from public.visits vi
      join public.service_catalog sc on sc.id = vi.service_catalog_id
     where vi.patient_id = v.patient_id and vi.clinic_id = v_clinic.id
       and vi.package_group_id is not null and not vi.deleted;
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
           'id', prog.id, 'title', prog.title, 'status', prog.status, 'startDate', prog.start_date,
           'durationDays', prog.duration_days,
           'itemCount', (select count(*) from public.program_items pi where pi.program_id = prog.id and pi.removed_on is null),
           'prescribedBy', nullif(split_part(btrim(coalesce(t.name, '')), ' ', 1), ''),
           'changeSummary', prog.change_summary, 'patientNote', prog.patient_note, 'lastChangedAt', prog.last_changed_at
         ) order by prog.start_date desc), '[]'::jsonb)
    into v_programs
    from public.programs prog
    left join public.therapists t on t.id = prog.therapist_id
   where prog.patient_id = v.patient_id;

  return jsonb_build_object(
    'ok', true,
    'firstName', nullif(split_part(btrim(coalesce(v_patient.name, '')), ' ', 1), ''),
    'clinic', jsonb_build_object(
      'name', v_clinic.name, 'logoPath', v_clinic.logo_path, 'phone', v_clinic.phone,
      'referralPhone', coalesce(nullif(btrim(v_clinic.referral_phone), ''), v_clinic.phone),
      'bookingSlug', case when (v_cards ->> 'book')::boolean then v_clinic.booking_slug end),
    'cards', v_cards,
    'nextAppointment', v_next,
    'packageSessions', coalesce(v_pkg, '[]'::jsonb),
    'programs', v_programs
  );
end $$;
revoke all on function public.get_patient_home(text, text, text) from public;
grant execute on function public.get_patient_home(text, text, text) to anon, authenticated;
-- Check before applying: the column names used here (patients.name, visits.clinic_id / patient_id / deleted /
-- package_validity_days, service_catalog.name, appointments.clinic_id) against the live schema.
```

**Files:** `HepHome.tsx`, `HepReferSheet.tsx`, `useHepOfflineQueue.ts`, `HepCheckin.tsx`, `HepProgramEnd.tsx` in `src/features/publicHep/`; `src/domain/doseRange.ts`, `src/domain/programChanges.ts` (+ tests); the exercise form, template and Prescribe rows (+ range); the therapist progress view (Did less / Did more, "Page opened"); Settings -> Patient page card; `send-agenda` exercise block.

**Tests that must exist:** Home shows the first name, current / other / earlier programs, next session and package, and omits any card switched off (and the server omits its data); the page opens on Exercises when something is left today, otherwise Home; Refer builds the message from the clinic name, booking link and referral phone and drops the booking sentence when online booking is off; editing Reps to 6 on 10-15 turns the cell amber ("was 10–15"), "Start 6 holds" builds 6 holds and sends `p_actual.reps = 6`, while 12 is not flagged and sends nothing; the therapist row reads "Wed: 7 of 10–15 reps" with Did less, and adherence is unchanged; a failed Mark as done shows "Saved on this phone, will upload when online", keeps its day and session, and is sent on `online` or after the next sign-in; a 4-day-old queued tap is dropped with the "too old" message; the Updated banner lists only added, removed or changed exercises and hides after it was seen on this phone; Do later shows its pill and is stored only on the phone; the check-in and end-of-program screens follow items 30 and 34.

**Docs:** update `FEATURES_AND_SCHEMA.md` and `README.md` in the same PR (CLAUDE.md).
