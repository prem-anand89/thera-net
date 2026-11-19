# Public Exercise Library (later; not part of the HEP build)

**Status:** parked by the owner on 2026-11-13 ("we will build it later"). Nothing here is scheduled. Start only after HEP Slices 1 and 2 have shipped (`2026-11-09-hep-module.md`) and the owner picks which stage to begin.

**Goal:** give every clinic a good starting library and let clinics share their best exercises and templates, without TheraNet publishing photos it has no consent for, content it has no rights to, or clinical instructions nobody has checked.

**Relationship to the HEP plan:** that plan keeps "no public catalog, upvotes or 'Added from public'" out of scope (Global Constraints). This plan is what replaces that line when the owner starts it; until then the HEP rules stand. Everything here keeps HEP's core rule: **copies, not links**. A clinic that adds a public exercise gets its own editable copy, and later public changes never alter it.

---

## Why (owner question, 2026-11-13)

- **The empty first day.** Every clinic starts with a blank library (HEP owner decision); building it is the biggest setup cost found in the workflow review. The HEP starter set (text-only, about 40 exercises) helps but has no pictures.
- **Quality spreads.** Clear photos and plain steps made by one clinic could help every clinic.
- **Product advantage.** A growing shared library is hard for a competitor to copy and makes TheraNet more valuable as more clinics join.

## Risks this plan must handle

1. **Consent for photos (India's DPDP Act and equivalents abroad).** A photo of an identifiable person is personal data. Consent given to one clinic does not cover showing it to every clinic. Pelvic floor and face exercises make this sharper.
2. **Copyright.** Clinics may upload images taken from Google, YouTube or other apps. If TheraNet publishes them, TheraNet is the publisher.
3. **Clinical responsibility.** A wrong or unsafe instruction in a library TheraNet approved carries TheraNet's name.
4. **Review work.** Every submission needs a qualified reviewer. Unreviewed, the library fills with duplicates and mixed quality (the "generic, cookie-cutter library" complaint about the large HEP apps).
5. **Mixed look.** Photos from many clinics, rooms and lighting look patchy next to a consistent set.
6. **Lite cap.** Free clinics are capped at 10 exercises; public exercises must not become a way around it.

---

## Stages (recommended order; the owner decides which to start)

### Stage 1: TheraNet library, made by TheraNet
The HEP starter set grows into a curated library produced by the owner or a physiotherapist the owner hires: consistent photos or simple line drawings, models who signed a release kept on file, plain numbered steps, a default dose and a stop-if line, reviewed by a named physiotherapist.
- Gives most of the benefit (no empty start, good quality) with no consent or copyright risk from other clinics.
- Clinics browse it from the Library ("TheraNet library" tab or source filter) and **Add to my library** (one, several, or a whole region).
- Recommended first if the main goal is filling empty libraries.

### Stage 2: shared templates without pictures
Clinics share **text-only** templates: name, note, exercises (names, kind, dose, steps, stop-if). Low risk, quick to review.
- On adding, each exercise is matched to the clinic's own library by name and other names (HEP amendment 78) or created as a text-only exercise.

### Stage 3: clinic uploads with review
Clinics submit their own exercises (with pictures) and templates for the public library; a reviewer approves them.
- Open only when there are enough clinics and a reviewer with time, and with the terms, review queue and Report button below in place first.

---

## How it works (all stages)

### Data (sketch; final SQL when the stage starts)
- **Separate tables, owned by the platform**, not clinic rows marked public:
  - `public_exercises` (same exercise fields as `exercises`: title, other names, region, also regions, equipment, type, kind, dose, rest, side, steps, stop-if, media keys and captions, thumbnail) plus `source` ('theranet' | 'clinic'), `contributed_by_clinic_id` (null for TheraNet), `credit_name` (null = anonymous), `status` ('draft' | 'in_review' | 'published' | 'withdrawn'), `reviewed_by`, `reviewed_at`, `version`.
  - `public_templates` and `public_template_items` (as the clinic tables).
  - `public_submissions` (what a clinic sent: the clinic exercise or template id, the terms version accepted, the consent answers, the reviewer's checklist and decision, reasons).
  - `public_reports` (a clinic's report on a published item: reason, note, status).
- **Clinic copies carry their origin** in `exercise_origins` (`source_kind` library or public; built with the TheraNet Library curation work, see FEATURES_AND_SCHEMA.md), so the Library can show "From the TheraNet library" and offer "A newer version is available" without changing the clinic's copy. Templates would need their own link.
- **Media:** public pictures live under their own prefix in a **public** R2 bucket (or a separate public prefix with its own read rule), never the clinic's private keys. On approval the platform **copies** the files there; on "Add to my library" they are copied again into the clinic's private prefix, so a withdrawn public item never breaks a clinic's programs.
- **Lite cap:** adding public exercises counts toward the clinic's exercise cap like any other.

### Submitting (Stage 3; Stage 2 for templates)
- From an exercise or template: **Share with all clinics…**. The clinic confirms, per submission:
  - "Everyone shown in these pictures has agreed in writing that they can be shown to other clinics" (or "No person is identifiable").
  - "These pictures and words are our own work, not copied from other apps, websites or books."
  - "TheraNet may publish, edit and remove this, and other clinics may copy and change it." (Terms text and version stored with the submission; legal review of the wording before launch.)
  - Credit: "Show our clinic name" or "Share anonymously".
- Pelvic floor submissions accept **text only**. Face submissions require the consent answer.

### Reviewing (Platform admin)
- A **Review queue** in the existing in-app Platform admin (`2026-11-06-in-app-platform-admin.md`): submitted items with the clinic, date and checklist.
- Checklist: identifiable face or body and consent given; no watermark or third-party content; pictures clear; steps plain and safe; dose sensible; stop-if present; not a duplicate (search by name and other names).
- Actions: **Approve**, **Edit and approve** (reviewer fixes wording or dose; the clinic is told what changed), **Reject** with a reason sent back to the clinic.
- Every published item shows the reviewer's name to platform admins (not to clinics).

### Using it (all stages)
- Library: a **TheraNet library** source switch (or tab) with the same layout, filters and search as the clinic library (HEP amendments 61 and 78), marked "From the TheraNet library", with **Add to my library** (one, several, or all of a region) and **Use for a patient** on public templates.
- After adding, the exercise is the clinic's own (edit, archive, delete as usual).
- **Report** on every public item (wrong instruction, unsafe, copyright, consent, duplicate, other) goes to the review queue; a reported item can be withdrawn; clinic copies already made stay as they are, and the platform can notify clinics that hold a copy of a withdrawn-for-safety item.

### Updates
- Public items are versioned. A clinic copy never changes by itself; the Library shows "A newer version is available" with **Compare** and **Update my copy** (the clinic's own edits are replaced only if it chooses).

---

## Questions for the owner when starting

1. Main goal: fill empty libraries fast (start with Stage 1) or build a sharing community (Stages 2 and 3)?
2. Who produces Stage 1 content and photos (owner, hired physiotherapist, an illustrator), and who is the named clinical reviewer?
3. Photos or simple drawings for the TheraNet library?
4. Is the TheraNet library free for every plan, or part of a paid plan?
5. Credit for contributing clinics: shown by default, or anonymous by default?
6. Should contributing clinics get anything back (for example a higher Lite cap or a discount)?
7. Countries: does the library start India-only, and how are language versions handled (ties to the HEP second-language future scope)?

## Before building any stage

- Legal review of the submission terms, the consent wording and a takedown process.
- Decide storage costs and limits for the public bucket.
- Update `FEATURES_AND_SCHEMA.md` and remove the "no public catalog" line from the HEP plan's Global Constraints in the same change (CLAUDE.md).
- Write the implementation plan for the chosen stage (tasks, SQL, tests) at that time; this file is the design brief, not the task list.
