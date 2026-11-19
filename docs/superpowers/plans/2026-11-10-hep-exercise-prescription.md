# Home Exercise Prescription — Locked Plan

> **For Gemini, Claude, or any implementer.** This file replaces the 2026-11-09 HEP draft (50-exercise seed, public `media_url`, PIN inside the WhatsApp text, templates deferred, Lite blocked or fully open). If that draft disagrees with this file, this file wins.
> **Status:** Product decisions locked 2026-11-10 via grill. Not built. Do not expand scope.
> **This ship:** Clinic-owned exercises, templates, prescribe, patient magic link, adherence. Inside TheraNet only.

---

## 1. What this is

A therapist builds exercises, saves templates, copies a template or a blank pick-list onto a patient, and sends one link. The patient marks sessions and pain. The therapist sees who is keeping up.

Two jobs, only the first is in this ship:

1. **Handoff.** Link plus monitoring for an existing or new patient.
2. **Public catalog.** Later. Not this ship. See §8.

---

## 2. Do not build

- No starter exercise library and no seed of 50 exercises.
- No public catalog, no upvotes, no AHP UI, no "Added from public."
- No exercise UI on the marketing site (theranet.in). No 3-patient website trial.
- No second prescribe app and no sixth phone tab.
- No booking button, no feedback form, no Google review on the patient link.
- No easier/harder variants, no "Too hard," no week engine, no PDF.
- No checkout inside the app.
- No photo-to-animation, no video files. GIF or 2–4 stills only.
- Do not import or merge the half-built AHP Supabase project.
- Do not put the PIN in the WhatsApp message.
- Do not treat a library edit as an edit of templates or programs already saved.

---

## 3. Locked rules

### 3.1 Words

| Word | Meaning |
|---|---|
| Exercise | One movement the clinic created. Title, body region, instructions, media, default dosage. |
| Template | A named recipe with no patient. Example: "ACL Rehab phase 1." Own copy of exercises and dosage. |
| Program | A template or a blank pick-list copied onto one patient. What the link shows. |
| Session | One "done" tap. The therapist sets **sessions per day** to 1, 2, or 3 on each exercise. Not a label. |
| Skip | Patient chose not to do it. Stored. Not a completion. No reason field. |

### 3.2 Copies, not live links

- Saving a template snapshots title, instructions, media pointer, and dosage.
- Copying a template onto a patient snapshots again into that program.
- "Save as template" on a program snapshots the program into a new recipe.
- Later edits do not flow backward or forward. Library edit does not change a template. Template edit does not change a program. Program edit does not change a template.
- The patient link reads the **program**. Saving the program updates the next load of the same link. Same token, same PIN. No second link.
- Removing an exercise from a program hides it from the patient. Logs already stored stay for the therapist.
- An exercise added today counts from today on. It is not written into earlier days.
- Sessions per day changed today apply from tomorrow. Today keeps the target the patient already saw. Logged rows are not rewritten.

### 3.3 Adherence

For finished days only:

`sessions completed ÷ (exercises on the program that day × sessions per day that day)`

- Today shows "1 of 2" (or whatever the target is) and does not move the percent until the day is over.
- The next day, a missed target shows on that patient's program.
- Skip and "never opened" count as not completed.
- Pain is asked once, on the first session of that exercise that day. Later taps only add a count.
- Pain at 7 or above is highlighted for the therapist.
- No WhatsApp and no push to the therapist in this ship. The signal is on the Active list and the patient tab.
- The patient sees the same percent.

Several active programs per patient are allowed. Pause or complete removes that program from the link and from Active. Copying "phase 2" creates another program. It does not close phase 1.

### 3.4 Lite

Signup is Lite. The exercise tool is on Lite, with caps per clinic:

- 10 exercises created here.
- 5 active programs.

A template does not count toward the 5 until it is copied. Charts with no program do not count. Paused and completed programs do not count.

The 11th exercise or the 6th active program does not save. The screen says it is the free-plan limit and points at theranet.in. No in-app checkout.

Solo and above, and any clinic marked paid in data before the shop exists, have no exercise cap.

### 3.5 Media

- GIF, or 2–4 stills in order. In the player, stills are frame, then Next. A GIF loops.
- Files go to **private R2**, not Supabase Storage.
- The app uploads with a short-lived upload URL.
- The patient page receives a short-lived view URL only after the PIN.
- A leaked file URL without the PIN does not show the picture.
- Store the object key on the row. Do not store a permanent public URL.

### 3.6 Patient access

- One token per patient (`/p/$token`), not per program. The page lists every **active** program.
- PIN: last 4 digits of the phone, or a 4-digit override the therapist sets.
- WhatsApp text has the link only. The therapist tells the patient the PIN separately.
- 5 wrong PINs lock the link for 15 minutes. The RPC returns no clinical data before the PIN is correct.
- One completion row per exercise per session-slot per local calendar day. Double taps do not inflate the count. Unique on `(prescription_item_id, log_date, session_index)`.
- Patient page copy (buttons, Skip, Start, percent) is English. Exercise words are whatever the therapist typed.
- Signup creates one clinic and opens Exercises. It does not force the team or prices wizard before the first program.
- Same phone in that clinic reuses the patient. It does not create a second chart.

### 3.7 Offline

Browsing exercises already on the device works offline. Saving an exercise, template, or program, and creating the link, need a connection. Those actions stay disabled when offline.

---

## 4. Therapist UI

No sixth phone tab. Phone: **More → Exercises**. Wider screens: **Exercises** in the header.

`/exercises` has three tabs.

**Library.** Empty until the clinic adds one. Add sheet: title, body region, instructions, GIF or 2–4 stills, default sets, reps, hold, sessions per day. Heading is "Created here" only.

**Templates.** Named recipes. New template picks from Library and sets dosage and order. Copy onto a patient (pick the patient, or the patient already open) creates a program. Delete template does not delete programs already copied.

**Active.** Every running program in the clinic: patient name, program name, today's count, percent, pain ≥ 7. A row opens that patient's Exercises tab. Not a separate dashboard.

**Patient chart, Exercises tab.** That patient's programs. Edit dosage, instructions, order, add, remove. Save. New program: from a template or a blank pick-list. Share via WhatsApp. "Save as template."

**Clinical note.** One button, "Prescribe exercises," opens the same prescribe sheet. The note is not a second builder. Opening and cancelling the sheet must not dirty the note.

People who can open the chart can edit the program.

---

## 5. Patient UI

Three screens. No other actions.

1. **PIN.** Lockout message if locked.
2. **List.** Every exercise in every active program. Each row defaults to Do. Patient can mark Skip. Shows today's "1 of 2" and the percent. **Start** plays only the Do rows, therapist order, one at a time. Tapping one row plays only that one.
3. **Player.** GIF or stills, dosage, stop-if line. Done for this session. Pain slider 0–10 on the first session only. Quit halfway: finished sessions stay logged. The rest stay untouched.

No "Request a visit." No feedback. No Google.

---

## 6. Data

TheraNet Supabase only. Suggested tables (names may match the codebase style; behavior is the contract):

**exercises** (clinic-owned): `clinic_id` required, title, body region, instructions, `media_key`, default sets, reps, hold, sessions per day (1–3), side, stop-if text, active, deleted. No global `clinic_id is null` rows in this ship.

**exercise_templates** and **exercise_template_items**: template name, clinic, ordered snapshot items (title, instructions, media_key, dosage, side, stop-if).

**programs** (was "prescriptions"): clinic, patient, therapist, title, status `active | paused | completed`, start date. Optional `source_template_id` for audit only. Not a live foreign key that updates the program.

**program_items**: snapshot fields plus sets, reps, hold, sessions per day, side, special instructions, sort order. `added_on` date so adherence for past days ignores items added later. `sessions_per_day` changes store the effective date (today's target stays; new value from tomorrow).

**patient_hep_access**: one row per patient, token, pin override, failed attempts, locked until.

**program_logs**: `program_item_id`, `log_date`, `session_index` (1..3), completed_at, pain (nullable except the first session may carry it), unique `(program_item_id, log_date, session_index)`.

**RPCs**

- `create_program` / `update_program` — online. Enforce Lite caps here, not only in the client.
- `save_template`, `copy_template_to_program`, `save_program_as_template`.
- `get_public_hep(token, pin)` — no payload before PIN. Returns programs, items, logs, and **short-lived media view URLs**.
- `submit_exercise_log(token, pin, item_id, session_index, pain, log_date)` — upsert on the unique key.
- `rotate_hep_token` — authenticated only.
- Upload URL mint — authenticated, clinic member, key prefix scoped to that clinic.

Dexie caches **exercises** for offline browse. Programs and logs are online reads in this ship (the patient page is online-only anyway). Do not pretend a program save is in the outbox.

R2 key shape: `clinics/{clinicId}/exercises/{id}/{n}`. Private bucket.

---

## 7. Share text

`wa.me` only. Origin is `window.location.origin`. Phone sanitized. Body includes clinic name and the `/p/{token}` URL. It does **not** include the PIN. Consent line is fine. It must not include a hardcoded production host.

---

## 8. Later (do not implement from this file)

Locked so a later agent does not invent a different shape.

- **Public catalog.** Private R2 stays private. Approval is a permission flag, not a public bucket. Approved rows show on a Public tab for every logged-in TheraNet therapist via short-lived view URLs. "Add to my clinic" copies the file into that clinic's prefix under "Added from public." Unapproved rows are visible to the author and an admin only. Votes, if built, only sort the review queue. Votes do not publish. The author cannot approve their own upload. **Who else may post is not decided.**
- **AHP.** Frozen. Do not merge its database. When it returns, it is another frontend on **this** Supabase Auth. One user id.
- **Marketing site.** Cloudflare. Plans and payment live there. Webhook sets the clinic plan. The app only reads it. Gut screening and fascial tools are later pages on that site, not this app.
- **Vercel Hobby** cannot host a commercial app. Moving checkout off Vercel does not fix that.
- **Request a visit.** One button under the patient list, later. Creates the existing booking request, name and phone prefilled, optional preferred day. No slot picker. Not on the player.
- Easier / harder links are therapist-only. "Too hard" only alerts. It does not change the program.

---

## 9. Build order

1. Migration, RLS, RPCs, Lite cap inside `create_program` / exercise insert, log uniqueness, contract test.
2. R2 private upload and view-URL mint. No public object URL in the database.
3. Domain helpers: PIN from phone, adherence over finished days, "today's target sticks," high pain ≥ 7. Unit tests before UI.
4. Library tab and add-exercise sheet.
5. Templates tab, copy onto patient, save-program-as-template.
6. Patient Exercises tab, prescribe sheet (template or blank), note button that does not dirty the note, Active tab.
7. `/p/$token` PIN, list, player. Shell already bypasses auth for `/f/` and `/book/`. Add `/p/`.
8. WhatsApp helper test: link present, PIN absent.
9. Docs: `FEATURES_AND_SCHEMA.md` and `README.md` in the same implementation PR. Not in a plan-only PR.

Existing clinic onboarding may still run for other entry paths. The exercise signup path must not block on the team or catalog wizard.

---

## 10. Tests that must fail if a rule is broken

- Lite clinic: 11th exercise and 6th active program rejected by the RPC.
- Template copy does not change when the template or library row is edited afterward.
- Program save is what `get_public_hep` returns. Library edit is not.
- Item added today is absent from yesterday's adherence denominator.
- Sessions per day changed today does not change today's denominator.
- Second tap on the same session index does not add a second log.
- Wrong PIN five times locks. Response contains no exercise titles.
- Share URL does not contain the PIN.
- Media helper never returns a URL when the PIN check fails.
- Cancelling the prescribe sheet leaves the note's dirty flag unchanged.
