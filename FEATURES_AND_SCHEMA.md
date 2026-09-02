# Thera.Net — Complete Features & Schema Documentation

## Overview

Thera.Net is an offline-first visit ledger, revenue-split tracker, and invoice book for physiotherapy clinics operating inside a partner hospital. Built with React + Vite + TypeScript, Supabase (Postgres/Auth/Realtime/Storage), Dexie (IndexedDB) local-first store with outbox sync, and Tailwind CSS.

**Multi-clinic from day one** with configurable revenue-split models (simple or hospital partnership), enforced server-side role-based access control, and complete offline-first capability.

---

## Features

### 1. Visit Management & Ledger

#### Visit Entry & Patient Lookup
- **Patient search** by MRNO or name with create-if-missing capability
- **Walk-in MRNO auto-generation** with sequential format `PREFIXYY-NNNN` (e.g., `W26-0001`, `W26-0002`)
  - Sequential per clinic per calendar year, resetting yearly
  - Auto-widening past 9999 with no configuration needed
  - Fully offline-supported via collision retry loop
  - Prefix configurable per clinic in Settings (defaults to 'W')
- **Visit entry** with catalog price autofill
- **Discount or extra** on new visits — by fixed amount or percent, with mandatory adjustment reason (stored as `adjustment_paise` on the visit)
- **Package session tracking** (1/3, 2/3, etc.) with ₹0 continuations for subsequent sessions
- **Reference panel** showing patient's last visit and open-package progress

#### Edit Visit
- Editable fields: condition, treatment notes, and (while not yet invoiced) bill amount, therapist, and date
- **Clinical fields** remain editable after invoicing; only billing locks
- **Scoped access** — therapists can edit only their own visits; admins can edit any visit

#### Today-First Workspace
- **Default landing page** showing:
  - Today's visits with payment state at a glance (Paid / Collect ₹X / Package / No charge) — boxed cards on phone, a table on tablet/desktop
  - Packages panel — Open/Stale/All status filter, plus a "Mine only" checkbox for anyone with a linked therapist record (admin included)
- **Stat strip** — Collected today, new patients this month, and either "My open packages" (linked therapist) or "Packages this month" (clinic-wide)
- **Quick actions** — take payment / issue invoice / split revenue / delete directly from each visit row's kebab menu; "Log visit" from a Packages row resumes the right package

#### Ledger & History
- **Dense table view** with patient enrichment (last visit + count, treatment, condition, bill amount)
- **Multi-tab interface**:
  - Visits tab — all-time visit history, URL-addressable (`/ledger?tab=visits`)
  - Invoices tab — issued invoice records, billing-access-gated, URL-addressable (`/ledger?tab=invoices`)
- **Filtering** — therapist dropdown, date range search
- **Bulk actions** on individual rows — Invoice, Repeat, Split, Delete
- **Only real visits can be invoiced** — no standalone "manual invoice" path

---

### 2. Clinical Assessment & Notes

#### Core Assessment (Initial & Follow-up)
- **Comprehensive consultation notes** with automatic episode-of-care tracking via patient enrollments
- **Two modes**:
  - **Initial** — full form entry
  - **Follow-up** — auto-collapses read-only carry-forward sections (medical history, screening), editable only for clinical follow-up sections

#### Multi-Section Accordion Layout
1. **Chief Complaint & History**
   - Anatomical region selection (9 regions: Cervical/Thoracic/Lumbar Spine, Shoulder, Elbow, Wrist/Hand, Hip, Knee, Ankle/Foot)
   - Onset/mechanism/episode pattern timeline
   - Occupation/activity context
   - Trauma & surgical history with structured dates
   - Secondary complaints array for multi-region presentations

2. **Subjective Assessment**
   - **Pain Profiling**: NRS current/best/worst (3-point scale), pain pattern (constant/intermittent/night-only/morning stiffness), sleep disturbance, aggravating/easing factors
   - **Previous pain history** — tracking historical episodes

3. **Body Chart**
   - Interactive tap-to-mark front/back/left-lateral outline
   - 4 mark types: pain, numbness, stiffness, referred
   - Responsive canvas layout

4. **Functional Status (PSFS)**
   - Up to 5 activities with baseline (locked on first save, carryable to follow-ups)
   - Current function scores
   - MCID (Minimal Clinically Important Difference) crossing counter

5. **Objective Examination**
   - **ROM (Range of Motion)**: region-driven movements with quick spine preset table (cervical/thoracic/lumbar with flexion/extension/lateral flexion/rotation)
   - **Manual Muscle Testing** with nerve-root tags
   - **Derived read-only myotome display**
   - **4-state neurological screening** (dermatomes/myotomes, T1/L2/L3/S2 extended levels)
   - **Red/Yellow flag tri-state screening banner** with collapsible detail

6. **Treatment & HEP (Home Exercise Program)**
   - Load management block (weight-bearing %, PWB %, brace, ROM limits)
   - Structured interventions with session duration quick-pick
   - HEP exercise rows with sets/reps/frequency
   - Plan & goals with target timeframe (short/long-term)

7. **Outcome Tracking**
   - Direction-aware outcome cards per instrument
   - NRS: ▼ Improving for lower scores
   - PSFS: ▲ Improving for higher scores
   - Comparison against most recent prior note in same episode

#### Note Features
- **Derived scalar columns** extracted at save time: `nrsScore`, `psfsMean`, `redFlagCount` (for filtering/reporting)
- **Patient profile integration** — "Clinical notes" section drilling into note editor
- **Contraindication banner** for clinical safety flags

#### Light Session Notes (SOAP) — per-visit documentation, distinct from Core Assessment
Two editors share the `consultation_notes` table, distinguished by `noteMode`
(`src/domain/types.ts`): **heavy** (`'initial' | 'followup'`, the Core
Assessment accordion above, `NoteEditorPage.tsx`) for initial evaluation and
periodic full re-assessment, and **light** (`'session'`,
`SessionNoteEditorPage.tsx`) for routine per-visit documentation — a small
single-screen SOAP form (`src/domain/sessionNote.ts`'s `SessionNotePayload`):
Subjective (pain 0–10 via the shared `ScaleWidget`, optional one-liner),
Objective (free text), Intervention (multi-select from
`src/domain/treatmentOptions.ts`'s combined manual-therapy/exercise/modality
vocabulary — the same list the heavy editor's Treatment section uses, kept
in one place so `dashboardService.ts`'s Modality-usage report recognizes
picks from either note kind), Assessment and Plan (single-choice chip
groups). No PSFS, no red-flag screening — `psfsMean`/`redFlagCount` are
written `null`/`0` for a session note by design.

**No heavy-first gate.** A light session note can be written for any visit
at any time — there is no requirement for a completed heavy (initial/
follow-up) assessment to exist first. (Billing & Notes Rebuild Phase 2
originally shipped this as a hard gate, "C8"; Phase 3 removed it — session
logs are meant to stand on their own, unpaired from the Core Assessment
episode.) A visit row's "+ Note" link (`VisitNoteLink` in
`src/components/VisitCard.tsx`) always routes to the light editor once the
visit `needsNote`. Patient Profile's own "New assessment" button always
opens the heavy editor (C5) — the two entry points are simply independent,
not one gating the other.

**Standalone entry point + batch editing (Phase 3).** Patient Profile's
main column has a "Session notes" section (above Visit History) showing
how many visits still need a note and a **"Write session notes"** button
that opens all of them back-to-back — `SessionNoteBatchPage.tsx`
(`/patients/$patientId/notes/session-batch`, `visitIds` search param).
Each visit gets its own mount of the shared `SessionNoteEditorBody.tsx`
(the form/autosave logic extracted out of `SessionNoteEditorPage.tsx` into
`useSessionNoteEditor.ts` so the two flows share one implementation),
keyed on visit id so switching visits gets a clean hook instance rather
than carrying over the previous visit's state. "Save & Next"/"Save draft &
Next" advance the queue (labeled "…& Finish" on the last visit); "Skip"
advances without saving; "Prev" revisits an earlier note in the queue
(read-only once completed). Nothing about the queue is durable session
state — every note that reaches draft or completed is saved immediately
via the same path the single editor uses, so leaving mid-queue just means
the remaining visits are still `needsNote` and reappear next time the
queue is recomputed. If another tab/device completes a queued visit's note
concurrently, the batch page auto-skips it with an inline notice rather
than erroring. "View session log"/"Insurer packet" links live in the same
section, resolved against the patient's active enrollment
(`patientModuleEnrollments.getActive`) rather than "whichever episode's
note was most recently touched" — the latter could point at a stale,
non-active episode for a patient with more than one enrollment over time.

**`/notes/$noteId` is mode-dispatched**, the first route in this app whose
rendered component depends on loaded data rather than the URL shape alone
(`NoteEditorDispatch.tsx`) — renders the heavy or light editor based on the
note's own `noteMode`, defaulting a legacy `null` value to heavy (never to
session — the reverse default would run a real Core Assessment through the
light editor's shallow-merge upcast and let autosave overwrite it with a
blank session payload). `/notes/$noteId/print` similarly guards against
rendering a session note as a blank Core Assessment: session notes print
only from the session log below, never individually.

**Multi-visit session log** (`SessionLogPrintPage.tsx`,
`/patients/$patientId/session-log/$enrollmentId`) — one enrollment's
completed session notes as a compact trend grid (date/therapist/pain/
assessment/plan/treatments, one row per session), narrative blocks for
sessions with a one-liner, and a single certifying attestation (clinic
signature + every treating therapist deduped by id — there is no
per-therapist signature field in the data model, only a clinic-level one).

**Insurer packet** (`InsurerPacketPage.tsx`,
`/patients/$patientId/insurer-packet/$enrollmentId`) — composes the most
recent completed heavy note, the session log, and whichever invoice(s)
already cover the episode's visits (read exactly as issued via the existing
`visitId → visits.invoiceId → invoice` join, no schema/RPC change) in one
print job, generated fresh, never stored. A visit with no invoice yet is
called out rather than silently omitted. Writing *new* clinical fields
(diagnosis, referring physician) onto an invoice would need schema/RPC
changes and stays out of scope here — deferred to whenever the billing
rebuild touches `issue_invoice()` for other reasons.

**Migration:** `consultation_notes.note_mode`'s CHECK constraint was widened
to allow `'session'` (`20260827000001_allow_session_note_mode.sql`) — a
**deploy-ordering requirement, not just a schema change**: a CHECK
violation is a permanent sync failure (`src/sync/status.ts`), and
`src/sync/engine.ts`'s handling for a permanent failure on an unsynced row
is to delete it locally (`revertToServerTruth`). The migration must be live
in Supabase before any deployed client can write `noteMode: 'session'`, or
the first session note a therapist writes is silently destroyed rather than
queued with a visible error.

---

### 3. Revenue & Invoicing

#### Revenue Split
- **Per-visit computation** at billing time with rate snapshot storage
- **Model**: BM Share (75% configurable), Post-Tax (90% of share), TDS (configurable basis), HV share
- **Rounding**: half-up to the rupee, once per visit — rollups reconcile by construction

#### Invoice Issuance
- **Server-issued gap-free sequential numbers** per clinic per FY (format: `PREFIX/FY-LABEL/NNNN`, e.g., `BM/26-27/0001`)
- **Immutable once issued** via DB triggers
- **Printable** on A4/A5 with clinic letterhead + optional partner-hospital branding
- **Document title**: "BILL" while outstanding, "BILL CUM RECEIPT" once paid — not
  "Invoice"/"Tax Invoice", which reads as GST terminology that doesn't apply to
  (generally GST-exempt) healthcare services and doesn't match how insurers/TPAs
  expect these documents to be labeled
- **Online-only** — gap-free numbers require the server counter
- **TPA-facing print layout**: dates-of-service get their own column,
  "Catalog price" becomes "Rate" (per-session, `/session`), a treatment
  period line ("Treatment period: 1 Jan – 15 Jan") sits above the
  itemization, and the old "Show visit dates" checkbox is gone — dates are
  always shown now, for legacy invoices too. See "Invoice line items (v2)"
  and "Clinical context on the bill" under the `invoices` schema entry
  above for what actually changed underneath.

#### Payment Status Badge & Collect Action
- **4-state display collapse** (`src/domain/paymentState.ts`'s
  `paymentBadge()`) over the raw 6-state `VisitPaymentState`: Paid /
  Partial / Due / Overdue / (no badge for `zero_session`). A visit reads
  **Overdue** once its bill has sat unpaid past `OVERDUE_AFTER_DAYS` (30) —
  the clock anchors on `visitDate` for an uninvoiced visit, or
  `max(visitDate, issuedAt)` once an invoice exists, so a package invoiced
  weeks after the visit gets a fresh 30-day window instead of reading
  Overdue the instant it's issued. A `partially_collected` balance past the
  threshold gets Overdue's urgent tone while keeping its "₹X of ₹Y" label —
  losing the partial-payment detail on an already-informative row would be
  a regression, not a simplification.
- **Collect promotion**: wherever money can still be taken (`take_payment`
  available), the passive status pill is replaced by a filled `Collect ₹X`
  button rather than shown alongside it; `Issue invoice` moved out of the
  visible row entirely into the row's kebab menu, so there's exactly one
  primary action per row. Two independent implementations both carry this
  (the desktop table's `PaymentStatusDisplay` and the mobile
  `SharedVisitCard` — confirmed they were never actually sharing markup
  despite an old doc comment implying otherwise) plus New Visit's "Last
  visit" summary tile, a third, easy-to-miss `PAYMENT_CHIP` consumer.

#### Needs-Receipt Queue
- **Ledger → Invoices tab**: a "Needs receipt (N)" section lists every
  visit that's `collected_no_receipt` (money taken, no invoice ever
  issued) clinic-wide, oldest first, each with a one-click "Issue invoice"
  into the existing dialog. `dashboardService.needsReceipt()` is the single
  source of truth for both this section and the tab's own count badge, so
  the two can never disagree — deliberately unbounded (no date filter),
  matching the sibling `outstandingInvoices()`'s own precedent, since a
  backlog like this is by definition old and shouldn't vanish behind a
  Ledger date preset.

#### Issue Invoice Right After Logging a Visit
- **`NewVisitPage.tsx`'s post-save screen** ("Visit logged") gained an
  "Issue invoice" button, gated on `canBill` (same entitlement/role check
  every other invoicing entry point uses), alongside the existing "Add
  clinical note"/"Another visit"/"Done" actions — billing staff no longer
  have to leave the page and find the visit again on Ledger/Workspace to
  invoice it immediately. Opens the same `IssueInvoiceDialog` those two
  pages use (`returnTo="/visits/new"`, added to `INVOICE_PRINT_BACK_TARGETS`
  in `router.tsx`), built from fields already computed at save time
  (`serviceLabel`, `isPackage`, `alreadyCollected`) rather than a second
  query — no new invoicing logic, just a third call site into the existing
  dialog/service.

#### Payment Status & HV Settlement
- **Three-fact payment model**: Billed / Collected / Receipted
  - Distinguishes cash collected without receipt from issued-but-unpaid invoice
  - Neither reads as the other
- **Zero-bill visits are labeled by why, not just that**: `zero_session`
  (bill = ₹0) covers two situations staff read very differently — a
  **package continuation** (session already billed on an earlier visit
  in the same package, `sessionIndex`/`packageTotal` both set — labeled
  "Package"/"package session") vs. a **standalone complimentary visit**
  (never meant to be charged, no package involved — labeled
  "No charge"/"complimentary session"). Both share one `VisitPaymentState`
  (nothing to collect or invoice either way); only the label differs,
  computed per-row from session/package fields via
  `isPackageContinuation()` (`src/domain/paymentState.ts`) rather than
  stored on the state itself.
- **Quick "Mark paid"** action from Workspace pending feed
- **Partial payments against an invoice**: recording an amount less than
  the invoice total leaves it `outstanding` with the balance tracked, not
  a full-or-nothing toggle. No amount column exists on `invoice_payments`
  (invoices are immutable, and that table is just a paid/outstanding flag)
  — instead the amount is logged as a visit-scoped `payments` row, the same
  mechanism the no-invoice direct-payment path already used, via
  `paymentService.recordInvoicePayment()`. A payment entered against an
  invoice spanning several visits (a package billed together) is allocated
  across those visits in date order, each visit's own bill as the ceiling
  for what lands on it, so every visit's individual payment state stays
  correct. The invoice flips to `paid` automatically once the running
  total reaches its total — same as the manual "Mark paid" toggle. Entry
  points: the Invoices tab's "Record payment" action (works for
  multi-visit invoices), and the existing "Take payment" dialog on any
  visit card (works standalone; for an invoiced visit it now looks up and
  is bounded by that invoice's real total rather than assuming one visit
  is the whole bill).
- **Monthly report** shows HV settlement card for variance tracking

#### Advance Payments
- **Record ahead of treatment**: Patient Profile's "Record advance" button
  logs money received with no visit attached yet — amount, method, date,
  optional note — and prints its own small receipt (`ADVANCE RECEIPT`,
  A5, no dates-of-service block, "Adjustable against future treatment").
- **Draws down against real visits**, not a separate ledger: applying an
  advance writes ordinary `payments` rows (stamped `advance_id`), so every
  existing payment-state computation, badge, and report already handles it
  correctly with zero special-casing. `TakePaymentDialog` surfaces "₹X
  advance available — apply" whenever the patient has an open balance,
  applying oldest-advance-first and capping at what's actually still owed.
  An advance flips to `exhausted` automatically once its balance reaches
  zero.
- **Not visible anywhere payment-state is read** until drawn down — an
  unapplied advance balance shows only in the two places above (the
  Patient Profile pill, `TakePaymentDialog`'s nudge), never in the
  needs-receipt queue, dashboard KPIs, or a visit's own badge.

#### Billing Access Control
- **Clinic-level toggle** restricts who is allowed to issue invoices
  - "Everyone" vs. "Billing staff only"
  - Enforced server-side inside `issue_invoice()` RPC, not just hidden in UI

#### Monthly Report
- **Fiscal-year-aware** (Apr–Mar)
- **Per-therapist metrics**: Bill, BM Share, TDS, Post-Tax, HV, unique patients, total
- **CSV export** capability
- **Attribution audit tab** (Reports → "Attribution audit"): a per-visit
  ledger of every rupee a manual split or automatic package attribution
  moved between therapists that month — see §2b.

---

### 4. Data & Offline

#### Offline-First Architecture
- **All entry works offline** — changes queue in an outbox
- **Automatic sync** when connection returns
- **Invoice issuance is deliberately online-only** — gap-free numbers need server counter
- **Dexie (IndexedDB)** local store with Supabase sync engine

#### Historical Import
- **Settings → Import historical visits** — one-time import from clinic's Excel ledger
- **Smart matching**:
  - Matches/creates patients by MRNO
  - Parses freeform service names into catalog items and package sessions
  - Flags anything it can't confidently resolve for manual review
  - Commits only after approval

---

### 5. Analytics & Dashboard

#### Dashboard
- **Rolling last-6-months view**:
  - Post-Tax BM revenue trend chart
  - Open packages sorted by days since last visit (flagged stale past 14 days)
  - Outstanding invoices summary
- **Hand-built SVG charts** (no charting dependency)
- **Validated categorical color palette**

#### Therapist Comparison
- **Opt-in chart** (off by default; admin enables in Settings → Features)
- **Shows side-by-side**: revenue and visit-count per therapist
- **Visible to therapists too**, not just admins — deliberate exception to "financial aggregates are admin-only"
- **3 key metrics** per therapist
- **6-month trend charts** need at least 2 months of history to render (otherwise read as a false spike);
  below them, a **live "this month" table** (revenue, visits, open packages per therapist) always shows
  as soon as there's at least one visit this month — not gated behind the trend's own history requirement

#### Analytics Capabilities
- Condition pie chart (grouped raw text)
- Referral source breakdown (doctor/hospital detail-name)
- Visit count aggregation
- Revenue trends with period toggle

---

### 6. Team & Permissions

#### Three Roles (Enforced Server-Side via RLS)
- **admin** — full read/write on everything: roster, catalog, all therapists' visits, billing settings, feature toggles
- **therapist** — clinic-wide reads, scoped writes (own visits/notes only), no roster/catalog/pricing changes
- **front_desk** — reads and visit/invoice entry, no clinical-notes access, no roster/catalog writes, excluded from clinical dashboards

#### Onboarding
- **Therapist invites** from Settings → Team create login *and* service-roster entry in one step
- **Admin/front_desk invites** only need login
- **Deactivation** (keeps history intact) or **permanent deletion** (zero visits/notes/invoices only)
- **Invite email → password setup**: `invite-therapist` calls
  `auth.admin.inviteUserByEmail()` with `redirectTo` set to the inviting
  browser's own origin + `/reset-password` (sent as `redirectOrigin` in the
  request body from `SettingsPage.tsx`). New invites also set
  `user_metadata.require_password_setup = true`; `Shell.tsx` redirects any
  signed-in user with that flag to `/reset-password` before they reach
  Workspace. `ResetPasswordPage.tsx` clears the flag when a password is chosen.
- **Member status in Team → Logins**: `list_clinic_members_with_email()` joins
  `auth.users.last_sign_in_at` and `raw_user_meta_data.require_password_setup` —
  **Pending** (never signed in, or still needs a password) vs **Active**.
  Pending cards get a **Resend email** action (`invite-therapist` with
  `action: 'resend'`, recovery mailer → `/reset-password`). Resend stays
  available while `require_password_setup` is true even if the invite link was
  opened (which sets `last_sign_in_at`).
- **Revoke** unlinks any `therapists.user_id` pointing at the removed login.
- **Delete clinic** (Settings → Data → Danger zone): `admin_delete_clinic()`
  RPC — admin-only, disables invoice/visit immutability triggers, deletes the
  `clinics` row (ON DELETE CASCADE to all child tables). Distinct from
  `admin_wipe_clinic_data()` which keeps the clinic shell. Client clears
  local Dexie and reloads afterward.
- **Invite email content**: the invite also seeds `user_metadata` with
  `clinicName`/`invitedByName`/`role` (looked up server-side from
  `clinics.name` and the caller's `clinic_members.display_name`), but the
  stock Supabase "Invite user" email template doesn't reference these —
  the email stays generic (no clinic name, no "invited by") until that
  template is edited in the Supabase dashboard (Authentication → Email
  Templates → Invite user) to include e.g. `{{ .Data.clinicName }}` /
  `{{ .Data.invitedByName }}`. This repo has no way to edit that template
  from code — it's hosted-project configuration, not migration-tracked.

#### Clinic-Level Toggles (Settings → Features/Billing)
- **Billing access** — who's allowed to issue invoices
- **Therapist comparison** — visible to therapists (off by default)

---

### 7. Patient Management

#### Patient Creation & Lookup
- **Search by MRNO, name, or phone**
- **Create-if-missing** on visit entry
- **Walk-in MRNO auto-generation** (sequential per clinic per year)
- **Editable fields**: age, sex, phone, primary condition, referring source
- Phone is searchable everywhere but only *displayed* on the Patient Profile
  page — dropped from the Patients list/card to save space there
- **Patients list period filter** — FY picker + a second dropdown: Full FY
  (default), Year to date, a specific month, or Custom range (From/To date
  inputs, same pattern as Ledger's custom date range)
- **Patients list "Bill" column** — a patient-level summary (lifetime
  billed total, plus an outstanding-due figure when nonzero), not the
  latest visit's own status phrase or package-session detail — those stay
  exclusively on the Ledger/Workspace visits table and the Packages
  panel, which already show them in full. Same reasoning for "Last
  visit," which is just date + visit count with no per-session dots.

#### Patient Profile
- **Visit history** — responsive table (tab-and-up widths) / card list
  (phone) shared with Ledger and Workspace, with a "hide ₹0 visits"
  filter for package sessions billed as part of the package's own invoice,
  and bulk visit selection for issuing one invoice across several visits
- **Payments summary** — lifetime billed / collected / outstanding for the
  patient, alongside the outstanding-balance pill in the header
- **Billing-lock indicator** — a small lock icon on invoiced-but-unpaid
  visit rows, since their billing fields are frozen even though the
  payment chip alone ("Due") doesn't say so
- **Clinical notes section** — drilling into note editor
- **Package tracking** — open and completed packages, with days-since-last-visit
  shown next to the date so staleness doesn't require doing the math
- **Referring source** shown as a badge next to the outstanding-balance and
  condition pills (not buried in small text)

#### Patient Hiding & Deletion
- **Hide (soft delete)** — default remediation for duplicates/mistakes, propagates to all devices via outbox
- **Restore** — unhide a hidden patient
- **Hard delete** — zero-visit patients only, enforced server-side by RPC, online-only

---

### 8. Settings & Configuration

#### Clinic Profile
- Name, address, phone, email, GST number
- Logo upload
- Partner hospital name and logo
- Invoice prefix (e.g., "BM" → `BM/26-27/0001`)
- Revenue split % (BM share, default 75%)
- Tax % (default 10%)
- TDS basis selection (gross bill or BM share)
- Fiscal year start month (default April → FY 26-27)
- **Walk-in MRNO prefix** (configurable, defaults to 'W')

#### Catalog (Settings → Catalog)
Single settings section with three sub-tabs — **Billing packages**, **Treatments
performed**, and **Referral sources** — each using the same card + **Edit**
(Save/Cancel) pattern as Team → Logins. Legacy `?tab=services|treatments|referrals`
URLs redirect to `?tab=catalog&catalogView=…`.

#### Service Catalog (Billing packages tab)
- Category and name per item — category is free text (autocompleted from
  existing categories via a datalist), grouped under category headings
- Session count (1, 3, 5, etc. for package pricing) — editable after create
- Base price (in paise) — price changes affect future visits only
- Active toggle (deactivate, not delete)
- Unique constraint per clinic

#### No-Return Reason Catalog
- Clinic-editable list of predefined reasons for patient no-shows
- Linked to visit records for reporting

#### Feature Toggles
- Therapist comparison chart (off by default)
- Billing staff restriction (on by default)

### 9. Patient Communications (Phase 0–5, plus Phase 9's Business API)

Full spec/roadmap: `docs/HANDOFF-patient-comms.md`. Phase 0 (foundation),
Phase 1 (visit "Ask for feedback"), Phase 2 (Requests → Feedback page),
Phase 3 (Google review nudge), Phase 4 (stale-package/single-visit
reminders), and Phase 5 (public booking → confirmed appointments →
Workspace "Expected today", folding in the doc's own Phase 6
reschedule/no-show/cancel actions since they share the same schema/RPC
surface) have shipped. Weekly availability/slot picker (Phase 7) and
analytics (Phase 8) remain later, un-started phases. Phase 9's WhatsApp
Business Cloud API is wired into all six patient-facing send actions —
see its own bullet below — but sends nothing for real until a clinic
configures it in Settings with a genuine Meta phone number ID, access
token, and at least one approved template name; until then every send
still falls through to the existing share sheet, unchanged.

- **`clinics.enable_patient_comms`** — module gate, off by default, same
  pattern as `clinicalDocsEnabled`/`enableExpectedToday`. Public token routes
  refuse to resolve when a clinic hasn't turned this on. Toggled from
  Settings → **Patient communications** (its own section/chip, admin-only —
  just the on/off switch for now; slug, Google review URL, message
  templates, and WhatsApp Business fields arrive with later phases).
- **`patients.do_not_message`** — opt-out flag, staff-settable, no automated
  detection. **Not actually checked anywhere client-side** — every send
  action (share-sheet and the Phase 9 Business API path alike) fires
  regardless of this flag; `doNotMessage` exists on `Patient` but nothing
  reads it. Pre-existing gap, not introduced by Phase 9's Business API
  wiring — flagged here rather than silently left implied-done by the
  field's own existence.
- **Public feedback link (`/f/$token`)** — the app's first and only
  anonymous write path. A therapist/front-desk/admin action creates a
  `feedback_requests` row with a server-generated 256-bit token; a patient
  opens `/f/$token` with no login, submits a 1–5 star rating and optional
  comment via `submit_feedback_response()`, and that's the entire
  interaction. Both public RPCs are rate-limited per IP and return an
  identical generic error for every failure case (invalid, expired, already
  responded, module off) — deliberately not distinguishable, so the endpoint
  can't be used to enumerate which tokens exist.
- **Feedback visibility is admin-only, at the RLS layer, not just the UI.**
  Front desk and therapists can see that a request exists/its status (no
  rating or comment content), but `feedback_responses` SELECT is restricted
  to `is_clinic_admin()` — this is a real access boundary, not a hidden menu
  item.
- **"Ask for feedback" trigger (Phase 1)** — an inline action on a visit
  row, next to the existing "+ Note" link (`VisitFeedbackLink` in
  `VisitCard.tsx`, kept inline rather than in the row's kebab menu, same
  convention as Note). Visible only when `enablePatientComms` is on and the
  viewer may act on that visit (`is_clinic_admin() OR is_own_therapist()`
  mirrored client-side, same shape as `canEdit`/`canSplit` — a per-row
  computed boolean, not a flat `Permissions` field, since the underlying
  RLS check is row-scoped). Also offered as a one-click button on
  `NewVisitPage`'s post-save screen, right after logging a visit.
  - **Creating a request is an online-only RPC,
    `create_feedback_request(p_visit_id uuid) returns table(...)`**, not
    Dexie + outbox. An earlier version went through the outbox (column
    default `generate_url_safe_token()` firing server-side, token
    round-tripping back on the next pull) — but that meant the very first
    "+ Feedback" click never had a token to share, so it never opened a
    WhatsApp share sheet at all; only Resend did. The RPC derives
    `clinic_id`/`patient_id`/`therapist_id` from the visit row rather than
    trusting the client, inserts (or, on a double-click race against the
    `feedback_requests_one_pending_per_visit` partial unique index, rotates
    the existing pending row — same `ON CONFLICT` shape as a fresh ask), and
    returns the full row in one round trip so the client can write it
    straight into Dexie (`putLocal`) and open the share sheet immediately.
    `security invoker`: the existing `feedback_requests_insert` RLS policy
    already gates who may call it correctly.
  - **Resending rotates the token via a dedicated RPC,
    `rotate_feedback_request_token(p_request_id uuid) returns text`** —
    column defaults never fire on UPDATE, so extending the 21-day expiry and
    generating fresh entropy needs a small online-only RPC instead of the
    outbox, the same reasoning `issue_invoice()` is an RPC rather than
    outbox-synced. `security invoker` (not definer): the existing
    `feedback_requests_update` RLS policy already gates who may call it
    correctly, so no elevated privileges are needed. One click both rotates
    the token and opens the WhatsApp share sheet with the new link
    (`feedbackService.resend`).
  - **Resend has a 3-day cooldown, client-side, no override.** Both create
    and resend stamp `feedback_requests.updated_at` to the moment the link
    went out, so the UI (`VisitFeedbackLink` in `VisitCard.tsx`) reads that
    as "last sent at" with no extra field: within 3 days it shows a plain
    "✓ Feedback" (no button at all), and only past that does "↻ Resend"
    appear. Deliberate — an easily-clickable resend invites back-to-back
    messages to a patient who just hasn't answered yet, so this is a hard
    floor rather than a confirm-to-override.
  - **Sharing** reuses the Web Share API + `wa.me` fallback pattern from
    `pdfShare.ts` (`shareTextViaWhatsApp`, the plain-text sibling of
    `shareFileToWhatsApp`) — no WhatsApp Business API required for v1. The
    message template is a hardcoded string for now; per-clinic template
    editing is a later phase.
  - **One pending request per visit** — the foundation's own unique index
    enforces this. A visit whose last request is `expired` offers
    "+ Feedback" again (a fresh row); a `pending` request offers "Resend"
    instead of creating a duplicate; a `responded` request shows a plain
    "★ Responded" marker instead of either — the same marker for every
    role, since the actual rating/comment stays admin-only at the RLS
    layer (rating is simply never populated client-side for a non-admin
    viewer — RLS filters the row out at the sync-pull level, not a
    client-side check).
  - The visit row's "★ Responded" marker only says a response exists, not
    what it says — see the **Requests → Feedback** page below for that.
- **Requests → Feedback page (Phase 2)** — `/requests?tab=feedback`, admin-
  only (`RequestsPage.tsx`), lists every `feedback_responses` row with its
  rating (★★★★☆) and comment, joined locally against the already-synced
  `feedback_requests`/`patients`/`therapists`/`visits` tables for context
  (patient, visit date, therapist) rather than duplicating that data. A
  `Bookings` tab sits alongside it — a stub through Phase 4, real as of
  Phase 5 (see below) — matching the doc's own "Requests" naming/IA
  decision (one page for both workflows).
  - **`feedback_responses` is a synced-but-read-only Dexie table**, same
    shape as `invoices` (`ALL_SYNCED_TABLES` but not
    `CLIENT_WRITABLE_TABLES`) — a response is only ever written by the
    anonymous patient's own SECURITY DEFINER RPC call, never the client.
    The table originally had no `updated_at` column (responses are
    immutable, never updated) but the sync engine hardcodes `updated_at`
    as the delta column for every synced table, so a migration added one
    (`updated_at = created_at` always, a permanent alias for the sync
    engine's benefit, not a real "last modified" signal).
  - **Nav**: desktop gets a top-nav item, **Requests**, originally
    admin-only (Feedback was the only tab that existed) and widened at
    Phase 5 to admin + front_desk — front_desk's whole reason to be on
    this page is Bookings, its primary surface per the handoff doc's role
    table. (It was the sixth item when added; Settings has since moved to
    the account menu to get the row back within its width budget — see
    **Header layout budget** below — so it's the fifth now.)
    The mobile bottom tab bar is a separate hand-built 5-item row
    (Workspace/Patients/+New/Ledger/More), not driven by the same array,
    so this doesn't add a 6th phone tab; mobile reaches it via **More**
    instead (also widened to the same admin + front_desk gate), per the
    handoff doc's own "no sixth phone tab" decision. A front_desk viewer
    who lands on `?tab=feedback` directly is redirected to `?tab=bookings`
    rather than shown a disabled tab, per the doc's own resolved note.
    **Bookings is the first tab and the default landing tab for every
    role** (including admin) — it's the busier, more actionable surface
    day to day; the un-parameterized `/requests` URL defaults to
    `?tab=bookings` rather than `?tab=feedback`.
  - **Workspace "new response" banner** — admin + module-on only, reading
    a `db.meta` "last viewed Requests" timestamp (clinic-scoped key, same
    pattern as `lastBackupMetaKey`) that gets stamped the moment
    `RequestsPage` mounts; the count is exported from a small
    `requestsSignals.ts` module rather than `RequestsPage.tsx` itself so
    that reading it from the eagerly-bundled `WorkspacePage.tsx` doesn't
    pull the route-code-split Requests page into that eager bundle.
- **Google review nudge (Phase 3)** — `clinics.google_review_url` (nullable
  text; unset means the nudge never shows, even for a 4-5★ response). Two
  surfaces, both gated on rating ≥ 4 **and** the URL being set — 1-3★ never
  gets a Google button, anywhere, per the spec:
  - **Patient-facing**: the `/f/$token` thank-you screen shows "Leave a
    Google review" (a plain external link) when eligible.
    `submit_feedback_response()` itself decides eligibility and returns
    the URL (or `null`) as its result — the RPC's return type changed from
    `void` to `text`, so the migration drops and recreates it (grants
    don't survive a drop, re-stated explicitly same as the original). No
    second round trip or extra client-side rating logic needed; the public
    page just shows the button if the return value is non-null.
  - **Staff-facing**: an "⭐ Google review" nudge on the visit row, next to
    the "★ Responded" marker — a pure share action (`shareTextViaWhatsApp`,
    no DB write, no `message_log` entry), gated the same way.
    `VisitCardData.feedbackRequest.googleReviewEligible` is a bare boolean
    (not the rating itself), populated two different ways depending on
    role: an admin caller derives it from the synced, RLS-filtered
    `feedback_responses.rating` (`>= 4`), the same bulk fetch the
    "★ Responded" marker already uses. A front_desk caller has no rating
    available at all — `feedback_responses_select` is
    `is_clinic_admin()`-only, so the row never reaches their Dexie, not
    even filtered client-side — so they instead call
    `list_google_review_eligible_requests(clinic_id)`, a `security
    definer` RPC that answers "which request_ids currently qualify"
    without ever returning a rating or a comment. This closes the gap the
    Phase 3 slice originally shipped with (spec's send-table lists front
    desk as eligible to send; the first cut only worked for admins).
    `useGoogleReviewEligibleRequestIds` (`requestsSignals.ts`) is the
    front_desk-only fetch — a one-shot RPC call on mount/clinic-change,
    re-run on window focus, skipped entirely for admin.
- **Re-engagement reminders (Phase 4)** — "No new detection" per the
  handoff doc: both surfaces reuse existing dashboard queries rather than
  adding a new signal. Pure `shareTextViaWhatsApp` actions, no DB write, no
  `message_log` entry, no booking link (public booking is a later phase,
  nothing to link to yet) — same shape as the Google review nudge.
  - **Stale packages** — a "Send reminder" button on `OpenPackageRow`s
    where `stale` is already `true`, on both of that data's existing
    homes: Workspace's Packages section (mobile card + desktop table) and
    Ledger's "Due for follow-up" list (which is already stale-only, so no
    extra `stale` check needed there). Gated on `clinic.enablePatientComms`.
  - **Single-visit patients** — a "Send reminder" button next to the
    existing `tel:` call link on Reports' single-visit-patients list
    (`dashboardService.singleVisitPatients`), gated the same way plus
    `p.phone` present — mirroring the existing call link's own gating,
    even though the share itself doesn't target that number directly (see
    below).
  - **Deliberately not phone-targeted.** `SingleVisitPatientRow.phone` and
    the `tel:` link already on that row could in principle build a
    number-specific `wa.me/<digits>` deep link, but patient phone numbers
    aren't stored in a guaranteed international format (no confirmed
    country-code convention) — a malformed number there fails silently.
    Every WhatsApp share in this module (feedback link, resend, Google
    review, reminders) instead uses the same generic Web-Share-sheet
    fallback (`shareTextViaWhatsApp`) and lets staff pick the recipient
    themselves, consistent behavior across the whole feature rather than
    a special-cased, riskier path for reminders alone.
- **Public booking, no slots (Phase 5, folding in the doc's own Phase 6)**
  — a public form collects name/phone/optional-therapist/preferred-
  day-time-as-text; front desk or admin confirms it by hand into a real
  scheduled appointment, which becomes Workspace's "Expected today". No
  slot picker/availability matrix — that's a later, separate phase the
  doc explicitly says not to start here.
  - **There was no legacy "Expected Today" to retire.** An earlier
    session fully dropped `expected_visits`/`clinics.
    enable_expected_today` (table, column, service, UI — zero
    consumers). The doc's "retire the legacy path" framing was moot by
    the time this phase shipped; Workspace's "Expected today" section is
    new, not a replacement.
  - **`clinics.booking_slug`** — nullable unique text, the public
    `/book/$slug` segment. Not a secret (meant to live on Google/the
    clinic's own website), unlike a feedback token — `get_booking_clinic_
    name`/`list_booking_therapists` just need the slug to exist and the
    module to be on, no rate-limited-oracle concern beyond the same
    generic-error/IP-throttle discipline every public RPC in this module
    uses.
  - **`appointment_requests`** — one row per public submission: `name`,
    `phone`, `email` (raw, unresolved against any patient), `preferred_
    therapist_id` (nullable), `notes` (free text — reason for visit,
    symptoms, anything else; deliberately its own column, not folded
    into the time preference — an earlier version of the form did that
    and silently dropped it whenever the patient didn't also tick
    "flexible"), `preferred_date` + `preferred_time_text`
    (both plain preferences — **no availability checking against either**,
    per the doc's "do not start here" on slots; front desk still picks
    the real `scheduled_at` by hand at confirm), `status`
    (`pending|confirmed|declined`), `appointment_id` (set on confirm).
    The form itself was redesigned mid-phase after reviewing a fuller
    reference design (richer than the locked spec's plain "name, phone,
    optional therapist, preferred day/time as text") — added email as a
    genuinely useful optional field, and gave the date/time preference a
    real date input plus a "flexible" quick-toggle, but deliberately did
    not adopt that reference's "pick a date to see available times"
    behavior, which implies real per-therapist slot availability the doc
    reserves for a later, separate phase. A `service_catalog_id` field
    and its `list_booking_services` RPC were added in that same redesign
    pass and then removed shortly after (dropped, not hidden — matching
    this repo's convention of not leaving unused scaffolding behind):
    the service picker didn't earn its place on a form patients fill out
    unauthenticated, and front desk already asks reason-for-visit via the
    `notes` field.
  - **`appointments`** — one row per confirmed expected attendance, **not**
    a billed visit. `patient_id` is **null from confirm until arrival** —
    identity is resolved exactly once, at arrival, reusing the existing
    New Visit typeahead rather than a confirm-time judgment call on a raw
    public submission. `patient_name`/`patient_phone` (the request's raw
    values) are kept on the row throughout, so it always has something to
    display before/without a resolved identity. `status`:
    `confirmed|rescheduled|no_show|cancelled|arrived`. `visit_id` is set
    only once arrival creates the real `visits` row.
  - **Both tables are synced-but-read-only Dexie tables** — same
    `ALL_SYNCED_TABLES`-without-`CLIENT_WRITABLE_TABLES` shape as
    `feedback_responses`/`invoices`, for the same reason: every write is
    an online-only RPC (public submit; confirm/decline; reschedule/
    no-show/cancel; mark-arrived/link-visit), never a client Dexie write.
    Both carry `updated_at` from creation (unlike `feedback_responses`,
    which needed one added after the fact) so the sync engine's
    hardcoded delta-pull column works from day one.
  - **RLS is SELECT-only for staff; every mutation is a `security
    definer` RPC with its own in-body role check**, not a matching RLS
    write policy — confirm/decline/reschedule/no-show/cancel need *admin
    or front_desk* (a new `is_front_desk(p_clinic)` helper, mirroring
    `is_own_therapist`'s shape), but marking an appointment arrived or
    linking it to a freshly-created visit needs the same broad membership
    check `visits_insert` already uses (`is_clinic_member`) — two
    different rules that don't map to one clean RLS policy, the same
    reasoning `list_google_review_eligible_requests` (Phase 3's
    front-desk-parity fix) already established. `appointment_requests`
    SELECT is admin/front_desk-only (matches who can reach the Bookings
    tab at all); `appointments` SELECT is clinic-member-wide, since it's
    the day list every role needs to see.
  - **Both tables also needed `created_by`/`updated_by`, added in a
    follow-up migration** (bug found live, not caught in review): the
    shared `set_updated_at()` trigger was redefined by an earlier,
    unrelated migration to unconditionally stamp `updated_by`/`created_by`
    on every row it fires for — it never checks whether the table
    actually has those columns. Every other synced staff table already
    carried them; these two were the first to attach the trigger without
    them, so any UPDATE (confirm, decline, reschedule, ...) failed with
    `record "new" has no field "updated_by"` until the columns were
    added, matching `feedback_requests`' own shape.
  - **Ten RPCs**: three public (`get_booking_clinic_name`,
    `list_booking_therapists`,
    `submit_appointment_request` — anon + authenticated grants,
    rate-limited); seven staff-only
    (`confirm_appointment_request` returns the new appointment id,
    `decline_appointment_request`, `reschedule_appointment`,
    `mark_appointment_no_show`, `cancel_appointment`,
    `mark_appointment_arrived`, `link_appointment_visit` — authenticated-
    only, explicit `revoke ... from public, anon` same grant-hygiene
    discipline as every RPC in this module). `link_appointment_visit` is
    the one `NewVisitPage.tsx` calls right after a visit saves, when that
    visit was started via `?appointmentId=...` — sets `patient_id`,
    `visit_id`, and flips `status` to `arrived` in one call.
    **`create_appointment_staff(clinic_id, name, phone, therapist_id,
    scheduled_at)`** was added later, alongside the manual-booking form on
    the Bookings tab — same admin-or-front_desk check and
    `security definer` shape as the other six, but inserts straight into
    `appointments` with no `appointment_requests` row at all (`request_id`
    stays null): a staff member entering a booking by hand already knows
    the confirmed date/time/therapist, so there's no "pending" state to
    pass through first.
  - **`bookingService.ts`'s eight staff-mutation wrappers all call
    `syncEngine.schedule(0)` right after their RPC succeeds** — found
    missing in the same post-ship workflow review, not present originally.
    `appointment_requests`/`appointments` carry no outbox (see
    `src/lib/db.ts`'s comment on why), so nothing tells the sync engine to
    pull after one of these RPCs the way a normal Dexie write does;
    without an explicit kick, confirming/declining/rescheduling/marking
    no-show or cancelled or arrived/linking a visit/creating a manual
    booking would all succeed server-side while the Bookings tab's
    `useLiveQuery`-driven lists (and Workspace's "Expected today") kept
    showing the pre-mutation state for up to 5 minutes — e.g. a just-
    confirmed request still listed under "Pending requests" with its own
    Confirm/Decline buttons, inviting a double-click. `schedule(0)` is the
    same near-immediate debounced pull the manual "Sync now" button and
    `CreateClinicForm`'s post-create refresh already use.
    `feedbackService.ts` didn't need this fix — it already writes the
    RPC's returned row straight into Dexie via `putLocal()` (see its own
    file comment) rather than waiting on a pull, but most of the booking
    RPCs return only void or a bare id, not a full row, so a pull kick was
    the simpler fix here than adding `putLocal` to both booking repos.
  - **All five appointment-mutating RPCs (reschedule/no-show/cancel/
    mark-arrived/link-visit) row-lock and check the appointment's current
    status before acting**, same discipline as
    `confirm_appointment_request`/`decline_appointment_request` already
    had — found missing during a post-ship workflow review, not shipped
    this way originally. Without it, two staff acting on one appointment
    at once, a stale browser tab, or a double-click could flip an
    already-arrived appointment (with a real linked visit) back to
    `no_show`, resurrect a cancelled one via reschedule, or double-link a
    second visit onto one appointment row, silently overwriting the first
    `visit_id`. The UI already only offers each action from the right
    states; this closes the gap server-side too.
  - **`NewVisitPage.tsx`'s existing `?prefillName=...` mechanism grew a
    `?prefillPhone=...` sibling** (feeds `newPatient.phone` the same way
    `prefillName` feeds `newPatient.name`) plus a new `?appointmentId=...`
    — "Create visit" links from an appointment row pass all three, so the
    same existing search-or-create typeahead this mechanism already
    drives surfaces likely-existing-patient candidates for free; staff
    still explicitly pick or create, never auto-selected (no silent
    find-or-create by phone, per the doc's explicit-scope list).
  - **Requests → Bookings tab** (`RequestsPage.tsx`) — a "New booking" card
    at the top (`create_appointment_staff(clinic_id, name, phone,
    therapist_id, scheduled_at)`, security-definer, same admin-or-
    front_desk check as every other staff booking RPC) lets staff enter a
    booking taken by phone or walk-in directly, alongside the public
    patient-facing `/book/$slug` link — it writes straight to a confirmed
    `appointments` row with `request_id` left null rather than going
    through the pending-request queue first, since staff already know the
    date/time/therapist when entering one by hand. Reuses the same
    post-confirm `justConfirmed` banner ("Send confirmation"/"Notify
    therapist") as a request that was confirmed through the queue, since a
    manually-created booking is functionally identical to a freshly-
    confirmed one. Below that: a pending-requests list (Confirm opens an
    inline scheduled-datetime + therapist mini-form; Decline is a plain
    confirm-then-RPC) and an appointments list
    (Reschedule/No-show/Cancel inline, status shown via a shared
    `Pill`-tone map in `src/domain/appointmentStatus.ts` — kept in its own
    tiny module, not defined in either page, because importing one
    route-code-split page's export from the other would leak that page's
    whole bundle into the importer's chunk, the same reason
    `requestsSignals.ts` exists). Confirming shows two independent
    "Send confirmation"/"Notify therapist" share buttons afterward — two
    explicit clicks, not one auto-fired double share-sheet — matching the
    rest of the module's per-action-button convention rather than the
    doc's plainer "sends a confirmation" phrasing.
  - **Workspace "Expected today"** — a new section (not a replacement of
    anything, per the point above), sourced from
    `dashboardService.todayAppointments`, scoped the same way "Seen
    today" already is (clinic-wide for admin/front_desk, own-therapist
    otherwise). Row actions: "Mark arrived" (any clinic member, matching
    the RPC's own membership check), "No-show"/"Cancel"
    (admin/front_desk only), "Create visit" (once `visit_id` is still
    unset). Reschedule is deliberately Requests-only, not offered inline
    on Workspace — a more deliberate action than a single click, better
    suited to the dedicated management surface. Requests → Bookings'
    Appointments table carries the same "Create visit" condition (found
    missing in review — an appointment manually marked arrived without a
    visit yet had no way back to New Visit once it wasn't "today" anymore
    and had dropped off Workspace's list; Requests' table has no
    date-scoping, so it's the recovery path for that case). A second banner (same
    shape as Phase 2's "new feedback response" one) surfaces the pending-
    booking-request count for admin/front_desk, linking to
    `/requests?tab=bookings`.
  - **Settings** gained a booking-link field in the same Patient
    communications section (client-validated lowercase-alphanumeric-plus-
    hyphens pattern; the DB only enforces uniqueness) with a "Copy link"
    button, alongside the existing module toggle and Google review URL.
  - **`message_log` gets its first writer via the Phase 9 wiring below** —
    every send action, `shareTherapistNotify` included as of the
    `therapists.phone` addition below, now goes through the Business API
    path first (when a recipient phone number is known), and a successful
    send there writes a `message_log` row server-side. Until a clinic
    actually configures the Business API and has an approved template,
    every send still falls through to the share sheet — which still
    doesn't log anything, same gap as before.
- **WhatsApp Business Cloud API — wired, pending real templates (Phase 9)**
  — built ahead of the clinic actually having Meta credentials, so that
  turning real sending on is a config step, not a code change.
  - **`clinic_whatsapp_config`** — `phone_number_id`, `access_token`
    (a real Meta secret), `enabled`. Carries **no SELECT policy for any
    client role at all** (RLS enabled, zero policies) — only
    `service_role`, used exclusively inside the Edge Function below,
    can ever read it. Two RPCs give the client everything it legitimately
    needs without exposing the token: `set_whatsapp_config(...)`
    (admin-only write; a `null` access token argument leaves the stored
    one untouched, so re-saving the phone number ID or flipping `enabled`
    doesn't force re-entering the secret) and
    `get_whatsapp_config_status(...)` (admin-only read of `enabled` /
    `phone_number_id` / `has_token: boolean` — never the token itself).
  - **`supabase/functions/send-whatsapp-template/index.ts`** — the one
    place in the app that would ever call Meta's Graph API
    (`https://graph.facebook.com/v20.0/{phone_number_id}/messages`),
    structurally mirroring `invite-therapist/index.ts` (JWT-verified
    caller, a `clinic_members` membership check, a service-role client
    for the privileged read). Template-shaped from the start — the
    caller supplies `templateName`/`languageCode`/`bodyParams`, never
    freeform text — because Meta requires an approved template for any
    business-initiated message outside a 24h customer-service window;
    this function has no opinion on what a given clinic's approved
    template actually says. Returns `{ configured: false }` (not an
    error) when the clinic has no config row or hasn't enabled it. On a
    successful send, writes a `message_log` row (`channel:
    'wa_business_api'`) — see the note above.
  - **Settings** gained a collapsed-by-default "WhatsApp Business API
    (advanced)" sub-block in the Patient communications section
    (`WhatsAppBusinessSubsection` in `SettingsPage.tsx`) — enable toggle,
    phone number ID, and a password-type access-token field that's never
    re-populated with the real value, only a "Connected ✓" / "Not
    connected" status line. Its own small save/status state, not part of
    the section's shared `useClinicSectionForm` dirty-tracking — this is
    a separate table with write-only semantics, not a few more `Clinic`
    columns.
  - **`src/lib/whatsappSend.ts`'s `sendWhatsAppMessage()`** is now the one
    place any send action decides *how* to send: try
    `whatsappBusinessService.sendViaBusinessApi()` first when a recipient
    phone number is known, and fall back to the existing
    `shareTextViaWhatsApp` share sheet whenever the clinic hasn't
    configured it, there's no phone number, Meta rejects the send (e.g. an
    unrecognized template name), or the request fails outright — so
    turning this on for real is purely a Settings config change plus a
    template-name/param swap in `WHATSAPP_TEMPLATES`, not a code change.
    All seven patient/staff-facing send actions (`askForFeedback`,
    `resend`, `askForGoogleReview`, `sendStalePackageReminder`,
    `sendSingleVisitReminder`, `shareBookingConfirmation`,
    `shareTherapistNotify`) go through it, reading the recipient's phone
    off `Patient.phone` (added to `VisitCardData` as `patientPhone`,
    `OpenPackageRow` as `phone`, and threaded through `NewVisitPage`'s
    post-save state and `RequestsPage`'s `justConfirmed` state to reach the
    call sites) or, for `shareTherapistNotify`, off the new
    `therapists.phone` column (nullable text; `RosterCard`'s edit form in
    Settings, next to Registration no. — absent still means share-sheet-
    only for that therapist, exactly like every other action falls back
    when its recipient's phone is unknown).
  - **Template names are hardcoded placeholders** (`WHATSAPP_TEMPLATES` in
    `whatsappSend.ts`, e.g. `'feedback_request_v1'`) — Meta assigns the
    real name when a clinic's own template is approved, and it has no
    relationship to this string; an unrecognized name is exactly what
    makes Meta return `{ configured: true, success: false }`, which this
    wrapper treats the same as "not configured" and falls back to the
    share sheet. Swap these for the clinic's actual approved template
    names (and adjust `bodyParams` ordering to match that template's own
    `{{1}}`, `{{2}}`, ... variables) once real ones exist — there's no way
    to know a template's variable shape in advance, so `bodyParams` here
    is a best-effort guess at "the same information the share-sheet text
    already sends," in the same order.
  - **Phone numbers are normalized, not validated** —
    `normalizePhoneForWhatsApp()` in `whatsappSend.ts` strips non-digits
    and prepends `91` to a bare 10-digit number (this app's phone fields
    are free text with no format enforced, and a 10-digit local number is
    what staff overwhelmingly type); anything else passes through as-is
    and Meta's own validation is the real backstop.

---

## Application Architecture

### Directory Structure

```
src/domain/              Pure business logic (no framework imports)
                         Money, splits, fiscal year, clinical assessments
                         Unit-tested, fully offline-capable

src/repositories/        Data-access interfaces + Dexie implementations
                         UI reads/writes local only; sync handles remote

src/sync/                Outbox push / delta pull engine
                         Against Supabase realtime & storage

src/services/            Orchestration layer (no React imports)
                         Visit, invoice, report, patient, dashboard,
                         consultation-note, therapist, advance services

src/features/            UI pages and components (React + TanStack Router)
  ├── workspace/         WorkspacePage (Today, Recent, Open Packages, Pending)
  ├── visits/            LedgerPage at /ledger (Visits/Invoices sub-tabs); NewVisitPage
  ├── patients/          PatientsPage, PatientProfilePage, NoteEditorPage
  ├── reports/           ReportsPage at /insights (Trends + monthly statement),
                         MonthlyLedgerPrintPage
  ├── settings/          SettingsPage at /settings; CreateClinicForm
  ├── invoices/          InvoicePrintPage
  ├── import/            Historical Excel visit import (preview + commit)
  ├── auth/              Login, reset-password
  ├── requests/          RequestsPage at /requests (Feedback tab, admin;
                         Bookings tab, admin + front_desk); requestsSignals.ts
                         (the "new response" count + the front-desk Google-
                         review-eligibility hook, kept out of RequestsPage
                         itself so Workspace's eager bundle can read them
                         without pulling in the route-code-split page)
  ├── publicFeedback/    FeedbackFormPage at /f/$token (anonymous, no Shell)
  ├── publicBooking/     BookingFormPage at /book/$clinicSlug (anonymous, no Shell)
  └── more/              Mobile-only overflow nav page

src/components/          Shared UI components — VisitCard (shared card/table
                         list), BodyChart, ScaleWidget, IssueInvoiceDialog,
                         TakePaymentDialog, SplitModal, UpiQrModal, SyncBadge,
                         BarChart/PieChart/IndexedTrendChart, MonthlyReportTable,
                         TherapistComparisonCard, SearchableSelect, ui.tsx
                         (shared primitives: Pill, buttons, table cells)

src/lib/                 Utilities (Supabase client, errors, image resize, db)

src/app/                 Shell, router, hooks (useClinicRole, usePermissions,
                         useVisitColumnPrefs, useWorkspaceScope)

supabase/                SQL migrations, RLS policies, RPCs, realtime
                         publications, seed data
```

### App Routes

| Route | Purpose | Access |
|-------|---------|--------|
| `/workspace` (default) | Today's work, recent history, open packages, pending items | All roles |
| `/visits/new` | New visit entry | All roles (billing fields gated by `canBill`) |
| `/ledger` | Historical visit records & invoices, URL-addressable sub-tabs (`?tab=visits\|invoices`) | All roles (Invoices tab requires billing access) |
| `/patients` | Patients list | All roles |
| `/patients/$patientId` | Individual patient profile, visit history, payments summary, clinical notes | All roles |
| `/patients/$patientId/notes/new`, `/patients/$patientId/notes/$noteId` | Core Assessment note editor (Initial/Follow-up) | Therapists & admins (`canViewClinicalNotes`) |
| `/patients/$patientId/notes/$noteId/print` | Printable consultation note | Therapists & admins |
| `/insights` | Dashboard + monthly per-therapist statement (`?tab=monthly`) | Admins & front_desk (monthly statement sub-view further gated admin-only) |
| `/insights/print` | Printable monthly ledger (portrait A4) | Admins & front_desk |
| `/invoices/$invoiceId/print` | Printable Bill/Bill Cum Receipt (A4/A5) | Anyone who can reach the invoice |
| `/settings` | Clinic configuration, MRNO settings, billing mode, rate setup, feature toggles | Admins only |
| `/settings/import-visits` | Historical Excel visit import | Admins only |
| `/more` | Mobile-only overflow nav (Settings/Reports/Requests on narrow screens) | All roles |
| `/requests` (`?tab=feedback\|bookings`) | Feedback: every response with rating + comment (Phase 2). Bookings: pending requests → confirm/decline, appointments → reschedule/no-show/cancel (Phase 5) | Feedback tab: admins only. Bookings tab: admins + front_desk |
| `/reset-password` | Password reset | Unauthenticated |
| `/f/$token` | Public patient feedback form (Patient Communications, Phase 0) | Unauthenticated — token-scoped, no clinic membership |
| `/book/$clinicSlug` | Public booking request form (Patient Communications, Phase 5) | Unauthenticated — slug-scoped, no clinic membership |
| `/archive`, `/setup`, `/setup/import-visits`, `/invoices`, `/reports`, `/reports/print` | Legacy redirects for old bookmarks | All roles |

---

## Database Schema

*Verified against the live schema (`information_schema.columns`), not
hand-maintained from memory — if this section and the actual database ever
disagree again, trust the database and fix this doc, not the other way
around.*

### Core Tables

#### `clinics`
```sql
id                          uuid PRIMARY KEY
name                        text NOT NULL
address, phone, email, gst_no, logo_path  text (NULLABLE)
partner_hospital_name, partner_hospital_logo_path  text (NULLABLE)
invoice_prefix              text NOT NULL (e.g., "BM")
bm_split_pct                numeric NOT NULL (default 75)
tax_pct                     numeric NOT NULL (default 10)
tds_basis                   text NOT NULL CHECK (IN 'gross_bill', 'bm_share')
fy_start_month              int NOT NULL (default 4 = April)
clinic_type                 text (NULLABLE) — 'individual' | 'multiple'
has_partner                 boolean NOT NULL
billing_mode                text NOT NULL — legacy, maps to clinic_type+has_partner
enable_therapist_split      boolean (NULLABLE)
own_share_label, partner_share_label  text (NULLABLE) — default "BM"/"HV"
billing_enabled              boolean NOT NULL
invoicing_access            text NOT NULL — 'everyone' | 'billing_staff'
clinical_docs_enabled       boolean NOT NULL
show_therapist_comparison   boolean NOT NULL
walk_in_mrno_prefix         text (NULLABLE, default 'W')
visit_column_prefs          jsonb (NULLABLE) — legacy, superseded by per-user
                             Dexie prefs (useVisitColumnPrefs); no client code
                             reads/writes this column today
upi_vpa, upi_payee_name, upi_qr_path  text (NULLABLE)
upi_qr_enabled               boolean (NULLABLE)
signature_path               text (NULLABLE)
created_by, updated_by       uuid (FOREIGN KEY → auth.users.id, NULLABLE)
updated_at                  timestamptz NOT NULL
```

#### `clinic_members`
```sql
clinic_id       uuid NOT NULL (FOREIGN KEY → clinics.id)
user_id         uuid NOT NULL (FOREIGN KEY → auth.users.id)
role            text NOT NULL CHECK (IN 'admin', 'therapist', 'front_desk')
title           text (NULLABLE)
display_name    text (NULLABLE)
created_by, updated_by  uuid (NULLABLE)
updated_at      timestamptz NOT NULL
PRIMARY KEY (clinic_id, user_id)
```

#### `therapists`
```sql
id              uuid PRIMARY KEY
clinic_id       uuid NOT NULL (FOREIGN KEY → clinics.id)
name            text NOT NULL
active          boolean NOT NULL (default true)
user_id         uuid (FOREIGN KEY → auth.users.id, NULLABLE) — linked login
photo_path      text (NULLABLE)
registration_no text (NULLABLE) — printed on invoices under the therapist's name
phone           text (NULLABLE) — lets `shareTherapistNotify` use the WhatsApp
                Business API instead of always falling back to the share sheet
created_by, updated_by  uuid (NULLABLE)
updated_at      timestamptz NOT NULL
```

#### `service_catalog`
```sql
id               uuid PRIMARY KEY
clinic_id        uuid NOT NULL (FOREIGN KEY → clinics.id)
category         text NOT NULL — free text, autocompleted client-side
name             text NOT NULL
session_count    int NOT NULL (default 1, package pricing)
base_price_paise bigint NOT NULL
active           boolean NOT NULL (default true)
created_by, updated_by  uuid (NULLABLE)
updated_at       timestamptz NOT NULL
```

#### `patients`
```sql
id                    uuid PRIMARY KEY
clinic_id             uuid NOT NULL (FOREIGN KEY → clinics.id)
mrno                  text NOT NULL
mrno_source           text NOT NULL — 'hospital' | 'auto'
name                  text NOT NULL
age                   int (NULLABLE)
sex                   text (NULLABLE) — 'M' | 'F' | 'Other'
phone                 text (NULLABLE) — searchable everywhere, but only
                       *displayed* on Patient Profile, not the Patients list
primary_condition     text (NULLABLE)
referring_source      text (NULLABLE) — legacy fixed enum, kept only so
                       patients tagged before referring_source_catalog
                       existed keep displaying correctly; no longer written
referring_source_id   uuid (FOREIGN KEY → referring_source_catalog.id, NULLABLE)
                       — current source of truth for new/edited patients
referring_source_detail text (NULLABLE)
no_return_reason_id   uuid (FOREIGN KEY → no_return_reason_catalog.id, NULLABLE)
deleted_at            timestamptz (NULLABLE) — soft delete
created_by, updated_by  uuid (NULLABLE)
updated_at            timestamptz NOT NULL
```

#### `visits`
```sql
id                    uuid PRIMARY KEY
clinic_id             uuid NOT NULL (FOREIGN KEY → clinics.id)
patient_id            uuid NOT NULL (FOREIGN KEY → patients.id)
therapist_id          uuid NOT NULL (FOREIGN KEY → therapists.id)
visit_date            date NOT NULL
condition, treatment_notes  text (NULLABLE)
treatment_ids         uuid[] NOT NULL (default '{}') — which treatment_catalog
                       entries were performed this visit
service_catalog_id    uuid NOT NULL (FOREIGN KEY → service_catalog.id)
catalog_price_paise   bigint NOT NULL — snapshot at billing time
actual_bill_paise     bigint NOT NULL
adjustment_paise      bigint NOT NULL — actual − catalog
adjustment_reason     text (NULLABLE)
session_index, package_total  int (NULLABLE)
package_group_id      uuid (NULLABLE)
shared_therapist_id   uuid (FOREIGN KEY → therapists.id, NULLABLE) — internal
                       revenue-split assist, reporting only
shared_pct            numeric (NULLABLE)
bm_split_pct, tax_pct, tds_basis  NOT NULL — rate snapshot at billing
bm_share_paise, post_tax_paise, tds_paise, hv_paise  bigint NOT NULL — computed
invoice_id            uuid (FOREIGN KEY → invoices.id, NULLABLE)
pending_payment_note  text (NULLABLE) — "collect later" reason
patient_consent_confirmed  boolean NOT NULL
patient_signature_url text (NULLABLE)
clinical_status       text NOT NULL — 'pending' | 'documented' | 'reviewed'
consultation_note_id  uuid (FOREIGN KEY → consultation_notes.id, NULLABLE)
reauthorization_required  boolean NOT NULL
location              text (NULLABLE) — 'clinic' | 'home'
deleted               boolean NOT NULL (default false)
created_by, updated_by  uuid (NULLABLE)
updated_at            timestamptz NOT NULL
INDEXES: clinic+date, patient, clinic+updated
```

#### `invoices`
```sql
id                  uuid PRIMARY KEY
clinic_id           uuid NOT NULL (FOREIGN KEY → clinics.id)
invoice_no          text NOT NULL — `PREFIX/FY-LABEL/NNNN`
fy_label            text NOT NULL (e.g., "26-27")
seq                 int NOT NULL
issued_at           timestamptz NOT NULL
patient_snapshot    jsonb NOT NULL — patient details at issue time
line_items          jsonb NOT NULL — see "Invoice line items (v2)" below
total_paise         bigint NOT NULL
payment_mode        text NOT NULL — 'Cash' | 'Card' | 'UPI' | 'Insurance'
therapist_id        uuid (FOREIGN KEY → therapists.id, NULLABLE)
supersedes_invoice_id uuid (FOREIGN KEY → invoices.id, NULLABLE) — set on an amendment
clinical_snapshot   jsonb (NULLABLE) — see "Clinical context on the bill" below
created_by, updated_by  uuid (NULLABLE)
updated_at       timestamptz NOT NULL
```
Immutable once issued (DB trigger) — with one narrow exception:
`clinical_snapshot` alone can be corrected in place afterward, see "Editing
clinical details after issuance" below and §3d. Payment status is **not** a
column here — see `invoice_payments` below.

**Invoice line items (v2).** `line_items` is opaque jsonb — a legacy invoice's
entries have only the original 6 fields (`serviceName`, `sessionCount`,
`sessionDates`, `catalogPricePaise`, `adjustmentPaise`, `adjustmentReason`,
`totalPaise`); every invoice issued or amended since the Billing & Notes
Rebuild Phase 1 gets a v2 entry, marked by `lineItemVersion: 2`, adding
`billedSessionCount`, `authorizedSessionCount` (null = not a package),
`ratePerSessionPaise` (snapshotted, never re-derived from live catalog
prices), `rateBasis`, `adjustmentReasons` (a merged group can span more than
one), and `therapistIds` (ditto). `sessionCount`'s meaning is unchanged
(`authorizedSessionCount ?? billedSessionCount`) so old readers of the raw
field still work. All build- and print-side code goes through
`src/domain/invoiceLine.ts` (`isV2Line`, `lineRatePerSessionPaise`,
`sessionCountLabel`, `lineReconciles`, `normalizeAuthorizedCount`,
`invoicePeriod`) rather than reading either shape directly, so the two
sides can't drift the way the invoice-print page and the insurer-packet
summary once did.

**Bill by service, not just by package.** Invoice line grouping
(`invoiceService.ts` → `invoiceLine.ts`'s `groupVisitsForInvoicing`) keys on
`packageGroupId` when present, otherwise on `service + catalog price` — so
several independently-logged (non-package) visits of the same service at
the same price collapse into one line reading "10 sessions," not ten
separate ₹0-context rows. A merged line's `catalogPricePaise` is always the
**sum** of every visit's own snapshot in the group (not one visit's), which
is what keeps `catalogPricePaise + adjustmentPaise = totalPaise` holding
exactly for every line, by construction.

**Long-running packages (e.g. post-op TKR/THR rehab, 20-30+ sessions).**
Nothing in the schema or invoicing logic caps a package's session count —
a 24-session package invoices through the exact same line-item build as a
3-session one. The one place volume affects the printed layout: a line's
"Dates of service" column would otherwise list every individual date,
wrapping into an unreadably dense cell past a handful of sessions.
`sessionDatesDisplay()` (`src/domain/invoiceLine.ts`) condenses to a
"from – to (N sessions)" range once a line has more than 8 session dates;
at or under that it still lists every date. Used by both
`InvoicePrintPage.tsx` table variants (legacy and v2); the Insurer Packet's
invoice summary and the issue-invoice preview step never showed the date
list in the first place — they already use the compact `sessionCountLabel`
— so neither needed a change. `SessionLogPrintPage`'s trend grid is
unaffected by volume in a different way: it's one row per session with no
condensing, since a clinical trend genuinely needs every date as its own
row; print pagination (not this page) is what splits a long table across
pages.

**Partial-package printing.** A package billed in full but only partly
delivered prints its real total (not a fabricated partial amount), with a
caption under the service name whenever the row's own arithmetic doesn't
reconcile (`lineReconciles()` — checks `billedSessionCount ×
ratePerSessionPaise + adjustmentPaise = totalPaise` exactly, catching both
a genuine partial delivery and a plain rounding mismatch on a fully-billed
package). The Sessions column itself reads "N delivered of M authorised" on
a non-reconciling row so the printed numbers don't invite the reader to
multiply Rate × the smaller number and land on the wrong answer.

**Clinical context on the bill.** `clinical_snapshot` (nullable jsonb, old
invoices predate it) holds `diagnosis`, `diagnosisIcdCode`,
`referringPhysician`, `physicianRegistrationNo`, `placeOfService`
('clinic' | 'home'), `treatmentPerformed`, `sourceNoteId` (provenance), and
`editedByBiller`. Pre-filled in `IssueInvoiceDialog` from the visit's own
completed note, falling back to the patient's most recent completed heavy
(initial/follow-up) note — a light session note (see Light Session Notes
below) has no referral field to pull from. Editable before issuing, then
frozen with the rest of the invoice (never re-read from the note
afterward). **Known gap, by design**: Patient Profile's bulk-issue path
(select several visits → issue one invoice) bypasses this dialog entirely
and always issues with `clinical_snapshot: null` — giving it the same
pre-fill would need either a second clinical form or a reshaped multi-visit
dialog, deferred as real follow-up work rather than folded into this pass.

**Preview before issuing.** `IssueInvoiceDialog` is a two-step flow: "Review
invoice" moves from the fields form to a review screen built from
`invoiceService.previewLineItems()` — the same line-item build
`issueForVisits` itself calls (via the shared `buildLineItems` closure in
`invoiceService.ts`), so the preview can never drift from what actually
gets issued. No RPC call happens until "Confirm & issue" on the review
screen; "← Back to edit" returns to the form with every field intact.

**Editing clinical details after issuance.** Once issued, `clinical_snapshot`
alone can still be corrected — a typo'd diagnosis, a missed physician
registration number — without reopening the financial record. "Edit
details" on `InvoicePrintPage` opens `EditInvoiceDetailsDialog`
(`src/components/EditInvoiceDetailsDialog.tsx`), pre-filled from the
invoice's existing snapshot, calling the `update_invoice_clinical_details()`
RPC (§3d). This is deliberately narrower than an amendment: the amount,
line items, and invoice number are untouched and no new invoice number is
minted — for those, "Amend this invoice" (§3b) is still the only path. The
clinical-fields form itself (`InvoiceClinicalFieldsForm`,
`src/components/InvoiceClinicalFields.tsx`) is shared between this dialog
and `IssueInvoiceDialog` rather than duplicated.

**Share via WhatsApp.** "Share via WhatsApp" on `InvoicePrintPage` renders
the same DOM node "Print / Save PDF" shows into an actual PDF, entirely
on-device (`renderElementToPdf` in `src/lib/pdfShare.ts`, via `html2canvas`
+ `jsPDF` — no server round trip, matching this app's offline-first
design), then hands that file to the Web Share API so WhatsApp — or any
other installed app — shows up in the OS share sheet with the real PDF
attached (`shareFileToWhatsApp`). Both libraries are dynamically imported
only when the button is clicked (a ~180KB-gzip chunk that every invoice
view would otherwise pay for, whether or not Share is ever used). Web
Share API's `files` support is mobile-browser-only (recent Chrome/Android,
Safari/iOS); on a browser without it (desktop, mainly), this falls back to
a `wa.me` click-to-chat link carrying just a text summary — WhatsApp's own
link scheme has no way to carry a file, so the fallback is deliberately
text-only rather than silently doing nothing.

**UPI listed and defaulted first.** `PAYMENT_MODES` in `IssueInvoiceDialog`/
`AmendInvoiceDialog` and `PAYMENT_METHODS` in `NewVisitPage`'s direct-
payment collector all list UPI before Cash, and `IssueInvoiceDialog`/
`NewVisitPage` default their selection to UPI — the most common collection
method at an Indian clinic front desk. `AmendInvoiceDialog` is the one
exception: its default still carries over the original invoice's own
`paymentMode` rather than defaulting to UPI, since it's correcting an
already-issued bill's record, not starting a fresh collection.

#### `invoice_counters`
```sql
clinic_id       uuid NOT NULL (FOREIGN KEY → clinics.id)
fy_label        text NOT NULL
next_seq        int NOT NULL (default 1)
PRIMARY KEY (clinic_id, fy_label)
```

---

### Financial Tables

#### `invoice_payments`
```sql
id              uuid PRIMARY KEY
invoice_id      uuid NOT NULL (FOREIGN KEY → invoices.id)
clinic_id       uuid NOT NULL (FOREIGN KEY → clinics.id)
status          text NOT NULL — 'paid' | 'outstanding'
paid_at         timestamptz (NULLABLE)
created_by, updated_by  uuid (NULLABLE)
created_at, updated_at  timestamptz
```
Lives apart from `invoices` (which is immutable once issued). A missing row
for an invoice reads as **paid** — see the payment-state note in Key Design
Patterns below. Deliberately has **no amount column** — flipping `status` is
the only write this table itself supports; a partial amount toward an
invoice is tracked via `payments` below instead (see
`paymentService.recordInvoicePayment()`), keyed to the invoice's own
constituent visits.

#### `payments`
```sql
id              uuid PRIMARY KEY
clinic_id       uuid NOT NULL (FOREIGN KEY → clinics.id)
visit_id        uuid NOT NULL (FOREIGN KEY → visits.id)
amount_paise    bigint NOT NULL
method          text NOT NULL — 'cash' | 'upi' | 'card' | 'bank_transfer' | 'cheque'
received_date   date NOT NULL
notes           text (NULLABLE)
advance_id      uuid (FOREIGN KEY → patient_advances.id, NULLABLE — see below)
created_by, updated_by  uuid (NULLABLE)
updated_at      timestamptz NOT NULL
```
A payment toward one visit's bill — cash/UPI collection recorded without
requiring an invoice, and supports partial payments (an amount less than
the visit's bill). No `invoice_id` column: this same table is also how a
*partial* payment against an **invoiced** visit's bill is recorded (an
invoice itself has no amount-paid field — see `invoice_payments` above),
so a payment stays keyed to the visit it was collected for either way. For
an invoice spanning several visits, one entered amount is allocated across
those visits' `payments` rows in date order — the shared
`allocateAcrossVisits()` helper in `src/services/advanceService.ts` (both
`paymentService.recordInvoicePayment` and advance draw-down use it, so the
two paths can't allocate differently). `advance_id` is set only when this
payment was drawn down from a patient's advance balance rather than
collected fresh; `visit_id` still stays required either way, so
`computeVisitPaymentState` needs no special-casing for advance-funded
payments.

#### `patient_advances`
```sql
id              uuid PRIMARY KEY
clinic_id       uuid NOT NULL (FOREIGN KEY → clinics.id)
patient_id      uuid NOT NULL (FOREIGN KEY → patients.id)
amount_paise    bigint NOT NULL (> 0)
method          text NOT NULL — 'cash' | 'upi' | 'card' | 'bank_transfer' | 'cheque'
received_date   date NOT NULL
receipt_no      text (NULLABLE) — no numbered series yet, see below
notes           text (NULLABLE)
status          text NOT NULL default 'open' — 'open' | 'exhausted' | 'refunded' | 'void'
deleted         boolean NOT NULL default false
created_by, updated_by  uuid (NULLABLE)
updated_at      timestamptz NOT NULL
UNIQUE (id, clinic_id) — backs the composite FK on payments.advance_id below
```
Money received ahead of treatment. **Not a `payments` row until drawn
down** — `computeVisitPaymentState` and everything derived from it (badges,
the needs-receipt queue, dashboard KPIs) stays untouched by an advance
until a real `payments` row is written against a real visit
(`advanceService.applyAdvance`), which stamps that row's `advance_id` and
flips this row's `status` to `'exhausted'` once the balance reaches zero.
Remaining balance is computed, not stored:
`amount_paise − Σ payments.amount_paise where advance_id = this.id`.
`payments.advance_id` is a **composite** FK to `(id, clinic_id)` rather
than a plain `references patient_advances(id)`, so a payment can never
reference a different clinic's advance even by a client bug — RLS already
scopes reads correctly, but this closes the write-side gap outright.
`method` uses the `PaymentMethod` vocabulary (`'cash'|'upi'|…`), not the
older `PaymentMode` (`'Cash'|'Card'|'UPI'|'Insurance'`) that belongs only
to `Invoice.paymentMode` — easy to confuse. **No gap-free numbered receipt
series yet** — `receipt_no` exists but is unused; the printed
`AdvanceReceiptPrintPage` identifies a receipt by date + a short slice of
its id instead. A real counter can be added later with no data migration
if it turns out to matter. Entry point: Patient Profile's "Record advance"
button; `TakePaymentDialog` also surfaces "₹X advance available — apply"
and draws down (oldest advance first) when a patient with an open balance
is being collected from elsewhere.

#### `settlements`
```sql
id                     uuid PRIMARY KEY
clinic_id              uuid NOT NULL (FOREIGN KEY → clinics.id)
year, month            int NOT NULL
amount_received_paise  bigint NOT NULL
received_date          date (NULLABLE)
notes                  text (NULLABLE)
created_by, updated_by uuid (NULLABLE)
updated_at             timestamptz (NULLABLE)
```
Per-month partner-hospital (HV) settlement record, for the Monthly Report's
variance tracking.

---

### Clinical Documentation Tables

#### `consultation_notes`
```sql
id                        uuid PRIMARY KEY
clinic_id                 uuid NOT NULL (FOREIGN KEY → clinics.id)
patient_id                uuid NOT NULL (FOREIGN KEY → patients.id)
therapist_id              uuid NOT NULL (FOREIGN KEY → therapists.id)
visit_id                  uuid (FOREIGN KEY → visits.id, NULLABLE)
enrollment_id             uuid (FOREIGN KEY → patient_module_enrollments.id, NULLABLE)
note_mode                 text (NULLABLE) — 'initial' | 'followup' | 'session'
                           ('session' = light SOAP note, everything else is
                           the heavy Core Assessment editor; null = legacy
                           row predating this field, treated as heavy)
status                    text NOT NULL — 'draft' | 'completed' | 'archived'
assessment_payload        jsonb (NULLABLE) — either the whole Core Assessment
                           form (history, pain, PSFS, body chart, objective
                           exam, treatment/HEP) or, when note_mode='session',
                           domain/sessionNote.ts's small SOAP payload — one
                           versioned/upcastable blob either way, shape keyed
                           off note_mode, not separate columns per section
authorized_session_count  int (NULLABLE)
notes_text                text (NULLABLE)
nrs_score                 int (NULLABLE) — derived, for outcome tracking
psfs_mean                 numeric (NULLABLE) — derived
red_flag_count            int NOT NULL — derived
created_by, updated_by    uuid (NULLABLE)
updated_at                timestamptz NOT NULL
```

**`visits.consultation_note_id` only ever points at a *completed* note —
a draft never gets written back onto the visit row.**
`consultationNoteService.saveAssessment()` deliberately updates
`visits.clinical_status`/`consultation_note_id` only when `status ===
'completed'` ("a draft save deliberately does not — the note isn't
finished yet, so the visit should keep prompting until it is"). So any
UI that wants to show a visit's note status (draft vs. completed vs.
none) — the Ledger/Workspace/Patient-Profile visit-row "Note" column —
can't trust the visit's own field alone; it has to join against
`consultation_notes` on `visit_id` (`VisitCardData.consultationNoteId`/
`noteStatus`, computed independently at each of those three call sites,
same pattern as `packageInvoicePending` above). Ledger/Workspace fetch
`consultationNotes.listByClinic()` once (clinic-wide, skipped for a
viewer without `canViewClinicalNotes`) and index it by `visitId`; Patient
Profile already loads the patient's full note history via
`listByPatient`, so it just re-indexes what it has.

#### `patient_module_enrollments`
```sql
id              uuid PRIMARY KEY
clinic_id       uuid NOT NULL (FOREIGN KEY → clinics.id)
patient_id      uuid NOT NULL (FOREIGN KEY → patients.id)
module_type     text NOT NULL, CHECK in ('gut_screening', 'return_to_sport',
                 'scoliosis_screening', 'face_scale', 'facial_palsy',
                 'consultation_notes')
status          text NOT NULL — episode open/closed state
created_by, updated_by  uuid (NULLABLE)
enrolled_at, updated_at  timestamptz NOT NULL
```
Only `'consultation_notes'` is actually written client-side today
(`consultationNoteService.ts`) — the other five values are schema-permitted
(matching the five region-module response tables above) but nothing in
`src/` creates an enrollment with them.

#### `ai_generation_log`
```sql
id                uuid PRIMARY KEY
clinic_id         uuid NOT NULL (FOREIGN KEY → clinics.id)
consultation_id   uuid NOT NULL (FOREIGN KEY → consultation_notes.id)
raw_ai_output     text NOT NULL
model_name        text NOT NULL
created_at        timestamptz NOT NULL
```

#### Region-module response tables
Each region module (opt-in extensions to Core Assessment) has its own
response table, all following the same shape: `id`, `clinic_id`, `patient_id`,
`enrollment_id` (FK → `patient_module_enrollments.id`, NULLABLE), a `responses
jsonb` blob, one or two derived score/category columns, `created_by`/
`updated_by`, `updated_at`.

- **`screening_responses`** — `computed_score numeric`, `triage_level text`
- **`return_to_sport_responses`** — `computed_score numeric`, `risk_category text`
- **`scoliosis_screening_responses`** — `cobb_angle numeric`, `severity_level text`
- **`face_scale_responses`** — `side_affected`, `visit_label`, `vas_movement`,
  `vas_qol`, `domain_scores jsonb`, `total_score numeric`
- **`facial_palsy_assessments`** — `side_affected`, `visit_label`, `hb_grade`,
  `sunnybrook_resting/voluntary/synkinesis jsonb`, `sunnybrook_score numeric`,
  `synkinesis_total int`

None of the five has a Dexie table, repo, sync entry, or any UI anywhere in
`src/` — they're reserved schema for modules that haven't been built, not
available features. Only `face_scale_responses` and
`facial_palsy_assessments` even have `can_use_module()`-gated RLS on insert/
update (see `clinic_module_settings`/`clinic_entitlements` below); the
other three (`screening_responses`, `return_to_sport_responses`,
`scoliosis_screening_responses`) have no entitlement check at all — any
clinic member can write to them.

#### Consent tables
```sql
consent_form_templates:
  id, clinic_id, consent_type, version, locale, title, body_text, purpose,
  is_active, effective_from, created_by, updated_by, updated_at

consents:
  id, clinic_id, consent_type, template_id (FK), subject_type,
  patient_id (NULLABLE), therapist_id (NULLABLE), granted, granted_at,
  granted_via, evidence_url, withdrawn_at, withdrawn_reason, captured_by,
  created_by, updated_by, updated_at
```
`current_consents` is a **view** (not a table) over `consents` exposing the
latest, still-in-force consent per subject (`is_in_force boolean`).

---

### Additional Tables

#### `feedback_requests` / `feedback_responses` / `message_log` (Patient Communications, Phase 0–3)
```sql
-- feedback_requests: one row per "ask this patient for feedback" action
id              uuid PRIMARY KEY
clinic_id       uuid NOT NULL (FOREIGN KEY → clinics.id)
visit_id        uuid NOT NULL (FOREIGN KEY → visits.id)
patient_id      uuid NOT NULL (FOREIGN KEY → patients.id)
therapist_id    uuid NOT NULL (FOREIGN KEY → therapists.id) — denormalized from the visit for RLS
token           text NOT NULL UNIQUE — 256-bit, base64url, server-generated default
status          text NOT NULL — 'pending' | 'responded' | 'expired'
expires_at      timestamptz NOT NULL (default now() + 21 days)
created_by, updated_by  uuid (NULLABLE)
created_at, updated_at  timestamptz NOT NULL
-- one pending request per visit — unique partial index on visit_id where status = 'pending'

-- feedback_responses: the patient's submission (only written by
-- submit_feedback_response(), a SECURITY DEFINER function — no client INSERT policy exists)
id           uuid PRIMARY KEY
request_id   uuid NOT NULL UNIQUE (FOREIGN KEY → feedback_requests.id)
clinic_id    uuid NOT NULL (FOREIGN KEY → clinics.id) — denormalized so admin-only RLS needs no join
rating       smallint NOT NULL (1-5)
comment      text (NULLABLE)
created_at   timestamptz NOT NULL
updated_at   timestamptz NOT NULL (default now()) — always == created_at;
             the row is immutable, this column exists only because the
             sync engine hardcodes updated_at as every table's delta
             column (Phase 2 migration)

-- message_log: shared audit trail for every send action across all four
-- patient-comms workflows (only feedback_request is wired up so far)
id                    uuid PRIMARY KEY
clinic_id             uuid NOT NULL (FOREIGN KEY → clinics.id)
kind                  text NOT NULL — 'feedback_request' | 'booking_confirmation' | 'therapist_notify' |
                        'google_review' | 'reminder_stale_package' | 'reminder_single_visit'
recipient_patient_id  uuid (NULLABLE, FOREIGN KEY → patients.id)
recipient_phone       text (NULLABLE)
channel               text NOT NULL — 'wa_share' | 'wa_business_api'
sent_by               uuid (NULLABLE, FOREIGN KEY → auth.users.id)
sent_at               timestamptz NOT NULL
```
RLS: `feedback_requests` is member-visible (status carries no rating/comment
content) but only admin/front_desk/own-therapist can insert or update it —
same shape as the visits table's own admin-or-own-therapist policies.
`feedback_responses` SELECT is `is_clinic_admin()` only — front desk and
therapists get zero visibility into ratings/comments, at the database layer,
not just hidden in the UI. Two SECURITY DEFINER RPCs — `get_feedback_request_by_token()`
and `submit_feedback_response()` — are explicitly granted EXECUTE to `anon`;
every other function in this schema either relies on `is_clinic_member()`
failing for an anonymous caller or explicitly revokes that default. A
`public_rpc_rate_limit` table (self-pruning, no cron dependency) throttles
both by client IP.

`feedback_requests` is a synced Dexie table (`ALL_SYNCED_TABLES`, pulled
like any other clinic data) but **not** in `CLIENT_WRITABLE_TABLES` — staff
creation and resend both go through online-only RPCs
(`create_feedback_request`, `rotate_feedback_request_token`) rather than
the outbox, so the local write is always a `putLocal` caching a
server-confirmed row, never a queued push. (An earlier version created
through the outbox with `token` left unset for the column default to fill
in; that meant the token — and so the ability to share it — didn't exist
until the next sync pull, so the very first "Ask for feedback" click never
opened a share sheet. See `create_feedback_request` below.)
`feedback_responses` (Phase 2) is also synced, but read-only client-side —
`ALL_SYNCED_TABLES` without `CLIENT_WRITABLE_TABLES`, same shape as
`invoices` — since a response is only ever written by the anonymous
patient's own SECURITY DEFINER RPC call; it needed an `updated_at` column
added (a permanent alias for `created_at`, purely so the sync engine's
hardcoded delta-column assumption holds) since the row is otherwise
immutable. `message_log` has no Dexie table or repo at all — the app never
reads or writes it directly.

`create_feedback_request(p_visit_id uuid) returns table(...)` (Phase 1,
added after the outbox-creation gap above was found) — `security invoker`,
EXECUTE revoked from `public`/`anon` and granted only to `authenticated`.
Derives `clinic_id`/`patient_id`/`therapist_id` from the `visits` row
rather than trusting client-supplied values, then inserts a new
`feedback_requests` row — or, on `ON CONFLICT (visit_id) WHERE status =
'pending'` against the existing `feedback_requests_one_pending_per_visit`
partial unique index (a double-click race), rotates the existing pending
row's token instead of erroring — and returns the full row in one round
trip. The existing `feedback_requests_insert` RLS policy is the real
authorization boundary.

`rotate_feedback_request_token(p_request_id uuid) returns text` (Phase 1) —
`security invoker`, EXECUTE revoked from `public`/`anon` and granted only
to `authenticated`. Rotating an existing row's token is an UPDATE, where
column defaults never fire, so "resend" needs this small RPC rather than
the outbox; the existing `feedback_requests_update` RLS policy is the real
authorization boundary, same as any other invoker-security RPC in this
schema.

**`clinics.google_review_url`** (Phase 3) — nullable text; unset means the
Google review nudge never shows, on either the public thank-you page or
the staff visit-row action, regardless of rating.
`submit_feedback_response(p_token text, p_rating int, p_comment text)
returns text` (was `returns void` through Phase 0-2) — now returns the
clinic's `google_review_url` when `p_rating >= 4` and one is configured,
`null` otherwise; the public thank-you page conditions "Leave a Google
review" on this return value instead of a second round trip. Return-type
changes require dropping the function first (grants don't survive a drop,
so the migration re-states them).

`list_google_review_eligible_requests(p_clinic_id uuid) returns setof uuid`
— `security definer` (unlike `rotate_feedback_request_token` above, this
one must bypass RLS on purpose), EXECUTE revoked from `public`/`anon` and
granted only to `authenticated`. Lets a front_desk caller — who has zero
RLS visibility into `feedback_responses` at all, not just a filtered view
of it — ask "which requests currently qualify for a Google review nudge"
without the function ever returning a rating or a comment, just bare
`request_id`s where `rating >= 4`. The function body re-implements its own
narrower check (`is_clinic_member`) rather than relying on RLS, since RLS
itself is what's being deliberately bypassed here.

#### `audit_log`
```sql
id           bigint PRIMARY KEY
clinic_id    uuid (NULLABLE, FOREIGN KEY → clinics.id)
table_name   text NOT NULL
row_id       uuid NOT NULL
action       text NOT NULL — 'create' | 'update' | 'delete'
old_data, new_data  jsonb (NULLABLE)
changed_by   uuid (NULLABLE, FOREIGN KEY → auth.users.id)
changed_at   timestamptz NOT NULL
```

#### `no_return_reason_catalog`
```sql
id              uuid PRIMARY KEY
clinic_id       uuid NOT NULL (FOREIGN KEY → clinics.id)
name            text NOT NULL
is_closed       boolean NOT NULL
active          boolean NOT NULL (default true)
created_by, updated_by  uuid (NULLABLE)
updated_at      timestamptz NOT NULL
```
Every clinic gets an 8-item starter set (Moved away / relocated, Discomfort
with treatment, Cost / could not afford, Recovered — no longer needed care,
Switched to another provider, Lost contact / unreachable, Scheduling
conflict, Referred elsewhere) — seeded by `create_clinic_with_admin()` for
new clinics and by a one-time backfill migration for existing ones. Fully
editable afterward from Reports' "Manage reasons" panel (add / deactivate /
mark "counts as closed"); the starter rows aren't locked, just pre-filled.

#### `referring_source_catalog`
```sql
id              uuid PRIMARY KEY
clinic_id       uuid NOT NULL (FOREIGN KEY → clinics.id)
name            text NOT NULL
detail_label    text (NULLABLE) — label for the follow-up detail field this
                source needs (e.g. "Referring doctor"), null if it needs none
active          boolean NOT NULL (default true)
created_by, updated_by  uuid (NULLABLE)
updated_at      timestamptz NOT NULL
UNIQUE (clinic_id, name)
```
Clinic-editable list of referral channels shown when adding/editing a
patient (Settings → Catalog → Referral sources), same add / deactivate-not-delete / edit
pattern as `no_return_reason_catalog`. Seeded with the app's original six
labels (Hospital referral, Doctor referral, Walk-in, Word of mouth, Online,
Other) for every clinic — new via `create_clinic_with_admin()`, existing via
a backfill migration. `patients.referring_source_id` is the source of truth
for patients tagged after this catalog existed; the legacy
`patients.referring_source` enum column is kept (not backfilled) so older
patients keep displaying via the old `REFERRING_SOURCE_LABELS` fallback —
see `dashboardService.referralSourceStats` for how both are reconciled.

#### `treatment_catalog`
```sql
id              uuid PRIMARY KEY
clinic_id       uuid NOT NULL (FOREIGN KEY → clinics.id)
name            text NOT NULL
active          boolean NOT NULL (default true)
created_by, updated_by  uuid (NULLABLE)
updated_at      timestamptz NOT NULL
UNIQUE (clinic_id, name)
```
Clinic-editable list of treatment types (Manual Therapy, Exercise Therapy,
Kinesio Taping, ...), managed from Settings → Treatments, its own tab
alongside Services and Referral sources (all three used to be stacked in
one "Services" tab; split apart so each is its own scroll). Independent of
the billing-side `service_catalog` — one visit is
billed under one service package but can record several treatment types
performed via `visits.treatment_ids`, picked from the catalog on both the
visit-logging and edit-visit forms — plus a free-text add-on
(`visits.treatment_notes`, the same field clinical shorthand notes always
used) for anything not in the list, grouped under one "Treatments" field
on both forms. Displayed as a single combined "Treatments" column/cell
everywhere the visits table shows it (Ledger, Workspace, Patient Profile)
— catalog names joined by commas, then the free-text add-on after a dash
if present (`treatmentsDisplayText` in `components/VisitCard.tsx`) — not
two separate columns. Independent of Core Assessment/clinical docs too, so
it works for every clinic regardless of `clinicalDocsEnabled`. Patient
Profile's Care plan card shows a per-package breakdown (e.g. "Manual
Therapy: 4 · Exercise: 6") computed client-side from the patient's own
visits — no separate
aggregation query. Seeded with a 6-item starter set for every clinic.
Also shown as a toggleable "Treatments" column/row on the Visits table
(Ledger, Workspace, Patient Profile) — a separate `VisitColumnKey` from the
pre-existing free-text `'treatment'` (treatmentNotes) column.

#### `clinic_module_settings`, `clinic_entitlements` — live at the RLS layer, zero client integration
Not dead — `can_use_module(clinic_id, module_key)` (defined in
`20260718000001_module_registry.sql`, revised in
`20260721000001_entitlements_audit_log.sql`) checks `clinic_entitlements`
(fail-open: no row = entitled) then `clinic_module_settings` (fail-closed
otherwise, further gated by the caller's `clinic_members.role` against
`allowed_roles`), and is called from the insert/update RLS policies on
`consultation_notes`, `face_scale_responses`, and `facial_palsy_assessments`.
Every write to those three tables runs through it today.

What's genuinely missing is the **client side**: no Dexie table, no repo,
no sync, no UI anywhere in `src/` reads or writes either table — so nothing
in the app currently sets a narrower entitlement or surfaces a "this module
is off" state. In practice every clinic reads as fully entitled, because
nothing has ever populated `clinic_entitlements` with a restrictive row,
and every clinic gets a `clinic_module_settings` row for `'consultation_notes'`
seeded `enabled = true` (both the one-time backfill and the
`seed_default_module_settings()` AFTER INSERT trigger, in
`20260721000001_entitlements_audit_log.sql`). This is `can_use_module()`'s
**real, always-on gate for whether a note can be written at all** — but
there's no Settings toggle for it, so it stays on for every clinic by
construction, indefinitely, until someone writes SQL by hand.

**This is easy to conflate with `clinics.clinical_docs_enabled` (client-side,
has a Settings toggle) — but they act at different layers and never
conflict.** `can_use_module()` decides whether a note *can be written*
(server-side, RLS, always on). `clinical_docs_enabled` is a client-side
*visibility* flag deciding which clinical-documentation surfaces render.
Four read it:

| Surface | What `clinical_docs_enabled` gates |
| --- | --- |
| `visitService.ts` | auto-flags a new visit `clinicalStatus: 'pending'` |
| `NewVisitPage.tsx` | the "Add clinical note" CTA on the post-save screen |
| `LedgerPage.tsx` | the "Not documented" filter checkbox |
| `ReportsOverviewPage.tsx` | the modality-usage chart (query, nav entry, section) |

**One surface differs from those four, deliberately.**
`PatientProfilePage`'s `ConsultationNotePanel` — "New note" / "Continue
draft" — is gated on role (`canViewClinicalNotes`, i.e. every therapist,
never front desk) and *not* on `clinical_docs_enabled`. **Confirmed
intentional, not an inconsistency to fix:** notes access is role-based only
— every therapist always has it, full stop. The `clinical_docs_enabled`
surfaces above are a separate, opt-in layer on top of that baseline: does
*this clinic* want the per-visit reminder, the "Not documented" filter, and
the modality report — a workflow/reporting preference, not an access gate.
A clinic with the flag off still has every therapist able to write notes
from Patient Profile at any time; it just isn't nudged to do so on every
visit or tracked for completeness.

**Rule for any new consultation-notes entry point:** gate on
`canViewClinicalNotes` for access (matches Patient Profile). Gate on
`clinical_docs_enabled` only if the new surface is itself a reminder/filter/
report in the same spirit as the four above — not if it's a place to
actually write a note, which should behave like Patient Profile's baseline
and stay available regardless of the flag.

**Confirmed not tier-gated either** — no `PlanFeature` in `src/domain/plans.ts`
covers clinical notes today, by design (its own docstring excludes
"anything clinical-note- or advanced-module-content-shaped ... still open
design work"). **One tier restriction is planned but not yet built:** Lite
should not be able to print/export a note as PDF (`NotePrintPage.tsx` is
currently unrestricted by tier for every clinic). This needs a new
`PlanFeature` (e.g. `notePrinting`) wired into `TIER_FEATURES`,
`useEntitlements()`, and a gate on `NotePrintPage.tsx`'s print action —
not yet scoped or built; captured here so it isn't lost before the Phase 2
notes work lands.

Note also that no admin-facing control exists for the *real* gate: turning
consultation notes genuinely off for a clinic means flipping
`clinic_module_settings.enabled` for `'consultation_notes'` by hand in SQL.
The Settings toggle does not do this, despite reading like it might.

The `modules` reference table these two originally pointed to was dropped
(`20260820000001_drop_unused_modules_table.sql`), taking its FK on
`module_key` with it via CASCADE. Restored as a plain `CHECK` constraint
(`20260823120000_restore_module_key_check.sql`) against the same seven
keys the `modules` table used to hold: `'gut_screening'`,
`'return_to_sport'`, `'scoliosis_screening'`, `'face_scale'`,
`'facial_palsy'`, `'consultation_notes'`, `'invoicing'`. Don't build new
gating logic on top of this without first confirming the tier-subscription
plan is what's meant to populate it — `can_use_module()`'s fail-open
default is backwards for a paywall and would need to change before these
tables can gate a paid tier.

#### `clinic_plans` — the tier boundary, service-role write only
Added as Phase 0 of the tier-subscription plan
(`20260823120001_clinic_plans.sql`). One row per clinic:

```sql
clinic_plans (
  clinic_id             uuid PRIMARY KEY (FOREIGN KEY → clinics.id, CASCADE)
  plan_tier             text NOT NULL, CHECK in ('lite', 'solo', 'clinic', 'clinic_plus')
  status                text NOT NULL DEFAULT 'active', CHECK in ('active', 'past_due', 'read_only')
  max_members           int NOT NULL       -- tunable per clinic, seeded from tier
  visit_cap_per_month   int                -- NULL = unlimited
  updated_at            timestamptz NOT NULL DEFAULT now()
)
```

RLS is deliberately asymmetric: `clinic_plans_select` lets any clinic
member read their own clinic's row, and there is **no write policy at
all**. With RLS enabled and zero write policies, Postgres denies every
`INSERT`/`UPDATE`/`DELETE` from the `authenticated` role outright — only
`service_role` (which bypasses RLS) can write this table. This is the
actual fix for the plan-tier-must-not-be-self-serve-editable problem: a
`plan_tier` column on `clinics` itself couldn't get this property, since
`clinics_update` already grants clinic admins unrestricted column access
and `clinics` rides the client-writable outbox.

Seeded automatically, mirroring `add_creator_as_admin()` and
`seed_default_module_settings()` (both existing AFTER INSERT triggers on
`clinics`): `seed_default_clinic_plan()` inserts a `lite` / `active` / 1
seat / 50 visits-per-month row for every newly created clinic. All four
existing clinics at migration time were backfilled as `clinic_plus` /
`active` / unlimited — a deliberate placeholder that grandfathers today's
de-facto behavior (nothing has ever been gated), not a real tier
assignment; real per-clinic tiers need deciding before enforcement
(seat cap, visit cap, invoicing gate — none of it is wired up yet) lands
on top of this table.

**Read path (Phase 1):** `useEntitlements(clinicId)` (`src/app/useEntitlements.ts`)
is the sole read point. `clinic_plans` has no Dexie table and isn't part of
the sync engine's generic per-table pull (`ALL_SYNCED_TABLES` in
`src/lib/db.ts`) — that loop assumes every table has an `id` primary key,
and this one is keyed by `clinicId`. Instead the hook fetches it directly
via Supabase, exactly mirroring `useClinicRole`'s pattern: cached as JSON in
Dexie's `meta` table (key `plan:${clinicId}`) so the tier survives offline,
a fresh online fetch always wins, and an unresolved fetch never flashes the
least-restrictive default (`lite`/1 seat/50 visits — the same fail-closed
default `DEFAULT_PLAN` uses when nothing has loaded yet). The hook also
returns `seatsUsed` (a live `clinic_members` count, online-only — `null`
when unknown) and `visitsThisMonth` (computed from local Dexie visits via
`repos.visits.list`, so it works offline). `src/domain/plans.ts` holds the
pure tier → feature map (`tierIncludes()`) the hook's `can()` reads, plus
`currentMonthRange()` — both unit-tested.

No UI reads this yet — Phase 1 only builds the read path. Enforcement
(Phase 2) and the Settings `plan` section (Phase 3) are what consume it.

**Enforcement (Phase 2):** four gates, all reading `clinic_plans` directly
(server-side) so none of them can be bypassed by a client that doesn't call
`useEntitlements()`:

- **Invoicing** — `issue_invoice()` checks plan status and tier *before*
  the pre-existing `clinic_entitlements('invoicing')` /
  `billing_enabled` / `invoicing_access` chain. Full precedence: **plan
  status (`read_only` blocks outright) → plan tier (`lite` blocks) →
  `clinic_entitlements` → `billing_enabled` → `invoicing_access`.** Each
  layer raises its own distinct error message.
- **New patients** — `enforce_clinic_plan_on_patient_insert()`, a
  `BEFORE INSERT` trigger on `patients`, blocks while `status <> 'active'`.
  Edits to existing patients are unaffected — only new rows are gated.
- **New visits** — `enforce_clinic_plan_on_visit_insert()`, a
  `BEFORE INSERT` trigger on `visits`, blocks while `status <> 'active'`,
  and separately enforces `visit_cap_per_month` **with a +20 buffer**
  (a hard block at the exact cap risks losing a real visit to a
  multi-device offline-sync race — the buffer absorbs that, the client
  pre-check below is the real day-to-day gate). Counted by the visit's own
  `visit_date`'s calendar month, not today's date — this is also what
  makes `importVisitsService.ts`'s bulk historical importer safe with no
  special-casing: it writes through this exact same insert path (no
  separate RPC to exempt), but imported rows are virtually always dated in
  past months, so they don't touch the current month's count. A same-month
  bulk import can still hit the buffer.
- **Seat cap** — the `invite-therapist` edge function counts
  `clinic_members` against `clinic_plans.max_members` before inviting or
  re-linking an existing account to the clinic (both add a
  `clinic_members` row, both count). Fails open if a clinic somehow has no
  `clinic_plans` row (shouldn't happen — every clinic is seeded one).
- **Client pre-check** — `NewVisitPage.tsx`'s `save()` reads
  `useEntitlements(clinic.id)` and blocks before attempting to save once
  `visitsThisMonth >= visitCapPerMonth`, so a normal user sees a clear
  message before ever reaching the server buffer above.

Deliberately **not** touched: `can_use_module()` / `consultation_notes` /
the five assessment-module keys. `clinics.clinical_docs_enabled` and
`clinic_module_settings('consultation_notes')` were previously suspected of
being two conflicting gates on the same feature; traced precisely, they act
at different layers — server-side write permission vs. client-side surface
visibility — and never conflict. See the dead-infrastructure section above
for the full mechanism, including a real inconsistency it surfaced (Patient
Profile's notes entry point isn't gated by `clinical_docs_enabled` while
three comparable surfaces are) that is still undecided. Adding a third
(plan-tier) gate would need to go through `can_use_module()` specifically,
since that's the one that actually governs whether a note can be written.
The five module keys have zero client code today regardless, so gating them
has no practical effect yet. Deferred to the still-open "advanced modules
content" planning pass.

**Bug fixed during Phase 2 testing:** `clinic_plans_updated` (Phase 0) used
the generic `set_updated_at()` trigger function, which unconditionally sets
`updated_by`/`created_by` — columns `clinic_plans` doesn't have (there's no
write path through an authenticated user's own session for this table).
Every `UPDATE` failed until `20260823130001_fix_clinic_plans_updated_trigger.sql`
gave it its own minimal trigger function that only sets `updated_at`. Caught
by direct testing before anything in production exercised the broken path.

**Settings UI (Phase 3)** — the first user-visible part of the tier plan.
`SettingsPage.tsx` gains an "Account" group with a read-only `plan` section
(`PlanSection`): tier, status, seats used/limit, visits this month/cap, and
a per-feature "what's included" list, all read from `useEntitlements()`.
Every section resolves to one of three states, per the design in Part 3 of
the tier plan:

- **available** — normal.
- **locked** — above the tier (`billing`, gated on `can('invoicing')`).
  Stays visible in the rail, greyed with a lock glyph; clicking it shows
  `LockedSectionNotice` (informational only — "Included in Solo and
  above," no CTA button, since there's no self-serve upgrade flow yet) in
  place of the real form.
- **hidden** — genuinely inapplicable, not a paywall (`partner`, gated on
  `can('revenueSplit')` — a Lite/Solo clinic can't have a hospital
  revenue-split relationship at all under its plan). Filtered out of both
  nav lists at render time; a mid-session redirect effect bounces `activeKey`
  away from `partner` if the resolved plan stops including it, mirroring
  the existing pattern `LedgerPage.tsx`/`ReportsPage.tsx` already use for a
  role changing mid-session.

`usePermissions()` folds `useEntitlements()` into `canBill` (also requires
`can('invoicing')` now, ahead of the pre-existing `billingEnabled`/
`invoicingAccess` checks) and `canViewPayouts` (also requires
`can('revenueSplit')`) — since `LedgerPage.tsx`'s Invoices tab and
`ReportsPage.tsx`'s Attribution Audit tab both already consume those two
booleans, tier-gating happens there for free. `TherapistComparisonCard.tsx`
needed its own `can('revenueSplit')` check instead (it's gated on
`clinic.showTherapistComparison`, not a `usePermissions()` flag).

Team's Invite form locks (with the same informational-only copy) once
`clinic_members.length >= maxMembers` — a client-side hint only, since
`invite-therapist`'s own seat-cap check (Phase 2) is the real boundary.

`FirstWeekChecklist.tsx` is an 8-step setup sequence (clinic profile →
services → invite team → link therapists → log a visit → wait for Synced →
clinical notes decision → backup), replacing what was once a flat list of
gotcha tips with no ordering logic. Two steps get plan-aware copy
(`invite-team`, `wait-synced`).

**Auto-detected steps, not self-reported.** Six of the eight steps derive
their own done state from real data instead of asking the admin to
remember to tick a box — `useFirstWeekSignals(clinicId)` reads
`clinic.address` (clinic profile), `service_catalog.length` (services),
`useEntitlements().seatsUsed > 1` (team invited — `clinic_members` gets a
row the moment an invite is issued, not only once accepted), therapists
with no unlinked roster row (therapist linking), any visit existing
(logged a visit), and a new `db.meta` key `lastBackupExportedAt` —
written by `DataBackup`'s export handler on a successful download — for
the backup step. Each auto step's "Continue" link goes straight to that
step's own screen (a specific Settings tab, or `+ New visit`), typed as a
small closed union (`StepLink`) rather than a generic `{ to, search }`
shape, since TanStack Router types each route's `search` against that
route's own schema. Only two steps stay genuinely self-reported, because
neither is a fact any query can confirm: "Wait for Synced" is a behavioral
reminder with no completion state at all, and "Decide on clinical notes"
is a decision where On and Off are both valid, so a boolean toggle's value
can't distinguish "decided" from "never looked at it" — these two alone
still use the original per-step completion flag (`db.meta` key
`` `firstWeekChecklistCompletedSteps:${clinicId}` ``, a JSON array of
stable step ids, not indices, so reordering the list later can't corrupt
in-progress state). The card collapses to a "Setup complete" summary once
all 8 read done. The single dismiss flag (`db.meta` key
`` `firstWeekChecklistDismissed:${clinicId}` ``) still exists unchanged
for the explicit "Hide" button, which fully removes the card regardless of
completion. Both keys are clinic-scoped (not bare constants) for the same
reason `lastBackupMetaKey` is below — `db.meta` is one global table shared
by every clinic on a multi-clinic device (see "Multi-clinic accounts"),
so an unscoped key would let dismissing/completing the checklist for one
clinic silently do the same for every other clinic on the device.

**Header layout budget** (`Shell.tsx`'s `<header>`) — the desktop header
row has a fixed width to spend (`max-w-6xl`, ~1120px usable) and four
things wanting it: brand, nav, sync badge, account trigger. With a text
label on all of them at once it doesn't fit — six labelled nav items plus
the clinic name alone overran it by ~160px, which showed up first as the
account dropdown rendering off-screen at iPad-portrait widths (the row
overflowed, taking the `right-0`-anchored panel's anchor with it) and then,
after a stopgap `overflow-x-auto`, as a squeezed horizontally-scrolling nav
even on a full-width screen. Three rules keep it fitting, and a change to
any element in this row has to keep them true:
- **Only the brand name shrinks.** The nav and the sync/account cluster are
  `shrink-0`; the clinic name truncates (`max-w-[11rem]`) and is hidden
  outright below `desktop:`. It's the one genuinely redundant item in the
  row — the account dropdown names the current clinic and switches between
  them — so it yields first, and clicked targets never squeeze.
- **Nav labels are `desktop:`-only** (1000px+). Between `sm:` and there,
  the nav is icons carrying `aria-label` + `title` (the label span is
  `display:none`, which screen readers skip, so the accessible name has to
  come from the attribute). This is what makes the row fit an iPad in
  portrait at all.
- **Five nav items, not six** — Settings lives in the account menu's Clinic
  section instead (see below), under the same `role === 'admin'` gate the
  `NAV` filter used to apply. Mobile is unaffected: `/more` has always been
  its route there, and the phone tab bar is hand-built, not `NAV`-driven.
The sync badge deliberately keeps its text label (`Synced`/`3 pending`/
`Offline`) rather than collapsing to a bare dot — sync state is the one
thing in this row a user needs to read, not decode.

**Account menu** (`AccountMenu` in `src/app/Shell.tsx`) — one dropdown,
same markup at every breakpoint (the name/role label collapses to just the
initials-avatar trigger below `sm:`), replacing what used to be two
separate, independently-built account areas: a flat always-visible
name+Sign-out pair on desktop, and an ad-hoc hamburger-icon dropdown on
mobile with its own copy of the same `NameEditor`. Panel contents: the
existing click-to-edit name/role (`NameEditor`, unchanged), a First Week
nudge for an admin who hasn't finished or dismissed the checklist above
(`useFirstWeekChecklistSummary(clinicId)` — shares `useFirstWeekSignals`
with the full card so both read the exact same derived state, and also
returns `nextStep`: the first not-done step's own title and link, so the
nudge's "Continue →" opens exactly where setup was left off — a Settings
tab or `+ New visit` — instead of always bouncing to Settings' own default
tab), a clinic switcher, **"Clinic settings"** and "Add another clinic"
actions (the switcher and "Add another clinic" only relevant to
multi-clinic accounts — see "Multi-clinic accounts" below), a "Change
password" action (`ChangePasswordDialog`,
`src/components/ChangePasswordDialog.tsx` — calls
`supabase.auth.updateUser({ password })` directly, since the account menu
only exists post-login, unlike `ResetPasswordPage.tsx`'s invite/recovery-
link flow which first has to establish a session from the email link's
token), and Sign out.

**Multi-clinic accounts** — one admin can create and switch between
multiple clinics under a single login; the schema/RLS/billing/sync layers
were already built for this (every policy is keyed off a row's own
`clinic_id`, `clinic_members`' PK is the composite `(clinic_id, user_id)`,
`clinic_plans`' PK is `clinic_id` so each clinic gets its own independent
plan/seat-count) — the gap was entirely client-side UI, closed as follows:

- **Switching clinics**: `AccountMenu` lists every clinic in `db.clinics`
  (alphabetically) whenever an account has 2+, and clicking one writes
  `db.meta.put({ key: 'activeClinicId', value: clinic.id })` and navigates
  to `/workspace` — landing anywhere on a per-record route (e.g.
  `/patients/$patientId`) would point at an id belonging to the clinic
  just left. `Shell.tsx`'s `clinic` resolution (`clinics.find(c => c.id
  === activeClinicId)`) and the `useClinicRole`/`useEntitlements` hooks
  that key their own `db.meta` caches off `clinicId` do the rest — nothing
  else needed to change for the switch to ripple through the whole app.
- **Adding a second clinic**: `CreateClinicForm` (`create_clinic_with_admin`
  RPC — no DB-level limit on clinics-per-admin) takes a `variant: 'page' |
  'dialog'` prop. `'page'` is the original zero-clinic-account screen
  (`Shell.tsx` renders it once sync confirms the account truly has no
  clinics). `'dialog'` is the same fields/logic, bare, wrapped by
  `AddClinicDialog` and opened from `AccountMenu`'s "Add another clinic"
  item — gated to `role === 'admin'` of the currently active clinic, same
  as the Settings-tab gate. Creating a clinic from either entry point
  makes it the new active clinic immediately.
- **Stale `activeClinicId` self-repair**: `Shell.tsx`'s auto-pick effect
  now also fires when `activeClinicId` no longer matches any locally
  known clinic (not just when it was never set) — a removed membership or
  leftover device state resolves back to `clinics[0]` instead of leaving
  the app stuck showing "Preparing…" or, worse, misreading a real
  multi-clinic account as having zero clinics and offering to create a
  duplicate.
- **Sync cursor reconciliation** (`SyncEngine.reconcileClinicMembership`,
  `src/sync/engine.ts`) — every table's pull cursor (`db.meta` key
  `` `cursor:${table}` ``) only moves forward against `updated_at`, so a
  clinic that becomes newly visible on this device (a fresh invite, or
  this same account creating/joining a second, pre-existing clinic) can
  have rows — including its own `clinics` row — older than a cursor this
  device already advanced while syncing its first clinic; those rows
  would never come back from an incremental `.gt(cursor)` pull. Before
  every `push()`/`pull()` cycle, a cheap uncursored
  `clinic_members` query for the signed-in user's own membership rows is
  compared against a `db.meta`-cached `knownClinicIds` set; if it grew,
  every `cursor:*` entry is deleted, forcing one full EPOCH-based re-pull
  (safe, since RLS still scopes exactly what returns) — a general "always
  re-verify membership before trusting a cursor" pattern worth applying
  anywhere else a cursor's validity depends on which rows a user can even
  see. **Known limitation**: a membership being *removed* is not handled
  symmetrically — pull only adds/updates, so a clinic's already-synced
  rows linger in local Dexie after the membership granting access to them
  is revoked, until that table is cleared for some other reason (e.g.
  sign-out). Not addressed here; would need explicit tombstone/reconcile
  logic if it becomes a real problem.

**Pilot kill switch (Phase 4)** — pilot clinics need to run with zero tier
limits until payments are integrated, without hand-editing every clinic's
`clinic_plans` row (that's the wrong tool: per-clinic override, not a
global pause). `platform_config` is a singleton-row table (`id boolean
primary key default true check (id)` forces exactly one row):

```sql
platform_config (
  id                          boolean PRIMARY KEY DEFAULT true CHECK (id)
  tier_enforcement_enabled    boolean NOT NULL DEFAULT true
  updated_at                  timestamptz NOT NULL DEFAULT now()
)
```

RLS: `select` for any authenticated user (a boolean, not sensitive — every
clinic needs to read it), **no write policy** — same service-role-only
pattern as `clinic_plans`; flipped via manual SQL, same as tier assignment
itself. `tier_enforcement_enabled()` (SQL function, `stable`) wraps the
read with `coalesce(..., true)` so a missing row fails toward *enforced*,
matching the fail-closed-for-monetization principle the whole tier design
follows.

Every Phase 2 enforcement point checks it first and skips its own logic
entirely when it's `false`: `issue_invoice()` (only the two tier checks —
the pre-existing `clinic_entitlements`/`billing_enabled`/`invoicing_access`
checks are a separate, unrelated concern and stay active regardless),
`enforce_clinic_plan_on_patient_insert()`/`enforce_clinic_plan_on_visit_insert()`
(early-return), and `invite-therapist` (reads `platform_config` alongside
`clinic_plans`).

Client-side, `useEntitlements()` fetches `platform_config` in the same
round trip as `clinic_plans`, cached in `db.meta` under a fixed
(non-clinic-scoped) key with the same fail-closed-to-`true` default. The
hook exposes `enforcementEnabled: boolean`, and `can()` returns `true`
unconditionally when it's `false` — since every Phase 3 UI gate
(`SettingsPage.tsx`'s locked/hidden resolution, `usePermissions()`'s
`canBill`/`canViewPayouts`) already derives from `can()`, this alone
unlocks all of them with no changes needed in those files. Three call
sites read `maxMembers`/`visitCapPerMonth` directly instead of through
`can()`, so they carry an explicit `enforcementEnabled` guard: `Therapists()`'s
`atSeatCap`, `NewVisitPage.tsx`'s visit-cap pre-check, and
`FirstWeekChecklist.tsx`'s seat-limited copy branch. `PlanSection` shows a
"Tier limits are paused for pilot testing" note when disabled, so a future
admin doesn't mistake fully-unlocked plans for a bug.

Verified live against a disposable test clinic set to `read_only` status
and a deliberately-impossible visit cap: with the switch off, a patient
insert, a visit insert, and (implicitly, same code path) invoicing all
succeed despite both restrictions; flipping the switch back on immediately
re-blocks the same clinic with no other change.

---

## Key Design Patterns

### 1. Offline-First with Outbox Sync
- **Dexie** for local IndexedDB storage
- **Outbox table** (in Supabase) for tracking changes made offline
- **Sync engine** pushes to Supabase when online, pulls deltas to stay in sync
- **Collision handling** — visit/patient/invoice conflicts resolved server-side
- **Sign-out clear must gate on `loading`, not just `!session`** —
  `Shell.tsx` wipes every synced Dexie table plus the outbox on sign-out
  (privacy: prevents one account's cached data leaking to the next login
  on a shared device). `useSession()`'s state starts as `{loading: true,
  session: null}` for one render before the real `getSession()` call
  resolves — that transient `null` is not a confirmed sign-out. The
  clearing effect must check `loading === false` before treating `session
  === null` as "actually signed out"; keying it off `session` alone fires
  the wipe on every app launch/reload, discarding any outbox entry not
  yet pushed to the server (e.g. a patient added while offline, then the
  tab closed before sync ran) with no warning and no way to recover it.

### 2. Revenue Split Snapshot at Billing
- **Rates stored with each visit** (bm_split_pct, tax_pct, tds_basis)
- **Computed once at invoice time**: bm_share, post_tax, tds, hv
- **Immutable invoice** via DB trigger
- **Rate changes** only affect new visits, not historical records

### 2b. Reporting-Layer Attribution (`reportService.monthly`'s `netPostTaxPaise`)
The per-visit split above answers "how was this bill divided between the
clinic and the partner hospital" — a billing fact, never touched after the
fact. A separate question, answered only at the reporting layer (never
stored on the visit itself), is "how much did this THERAPIST actually
generate" — which the raw per-visit numbers get wrong for two real cases:

- **Multi-session packages**: a package's full price is billed on one
  session's visit; every other session is logged separately at ₹0 so it
  isn't double-billed. Naively summing `postTaxPaise` per therapist credits
  100% of a 3-session package to whoever logged session 1, even when a
  colleague ran the other two.
- **Manual same-visit Shared/Split**: an admin can explicitly move a % of
  one visit's Post-Tax BM to an assisting therapist (`visits.shared_therapist_id`/`shared_pct`, set via `visitService.setSplit`).

Both are folded into ONE number, `TherapistMonthRow.netPostTaxPaise`
(`reportService.ts`), rather than kept as parallel concepts: the base is
each row's summed `postTaxPaise`, adjusted by (1) the manual-split delta
(a same-visit % moved between two named therapists, always net-zero across
the month) and (2) an automatic package-attribution delta, computed
**per package group, as explicit deltas the biller gives away** —
`packageAttributionDeltas()`:
1. Find the group's **billing visit** (the one with the largest bill —
   everything else is logged at ₹0 by convention).
2. `perSessionShare = floor(billingVisit.postTaxPaise / packageTotal)`
   — a fixed whole-rupee amount, computed from the package's **declared**
   session count so it stays stable as later sessions get logged.
3. For every *other* logged session run by a **different** therapist than
   the biller, move one `perSessionShare` from the biller's row to
   theirs. A session the biller ran themselves needs no delta.
4. Whatever isn't explicitly claimed this way stays with the biller —
   including the share reserved for sessions **not yet logged**. Earlier
   versions of this algorithm divided evenly across only the *logged*
   sessions, which silently dropped the un-logged share into neither
   row (confirmed on live data as ~53% of a month's revenue missing from
   every therapist's Net); the current version never leaves a rupee
   unattributed.

**Settlement is scoped to the report's own month, not the whole package.**
Step 3's giving-loop only considers sibling sessions whose own `visitDate`
falls inside the report's `[from,to]` window — a package spanning several
months settles **incrementally**, one month's sessions at a time, instead
of re-applying every session's share retroactively whenever a later
month's report touches the same group. Two consequences worth knowing:
- **A past month's report is immutable to later events.** Re-running
  `monthly()` for a month that has already "closed" always reproduces the
  same numbers, because no future visit's date can ever fall inside a
  past window — there is no stored/materialized report to retroactively
  edit, only a live computation over dated rows.
- **The biller can get a zero-visit row with a negative Net** in a later
  period, if a colleague runs that period's session of a package the
  biller billed earlier. This is the debit actually landing, not a bug —
  the row is forced into existence via `rowFor` specifically so the debit
  has somewhere to go; an earlier version of this fix instead skipped
  creating the row (`rowsById.get` returning nothing), which silently
  credited the colleague without debiting anyone and broke the invariant
  below for any package spanning more than one report period.

Deltas always sum to zero **within a single `monthly()` call**, so
`total.netPostTaxPaise` is untouched, and `sum(rows.netPostTaxPaise)`
always equals `total.netPostTaxPaise` for every report period — with no
exception, unlike an earlier version of this doc that carved one out for
cross-month packages (that carve-out described the bug, not a real
limit).

This is the one number used everywhere a therapist's own "how much revenue
did I generate" is shown — Trends KPI/chart, Therapist Comparison (both the
trend and the live table — which also gained a `Post Tax {own}` column and a
Total row alongside Net, so the reconciliation is visible there too, not
just on the Monthly Statement), and the Monthly Statement's "Net" column
(shown unconditionally, unlike "Shared" which stays behind the
`enableTherapistSplit` opt-in). There is no separate "gross attributed
revenue, ignoring splits" concept anymore — that used to be a parallel
`attributedRevenuePaise` field/column, folded into `netPostTaxPaise` instead
so there's one lens, not two.

**Manual Shared and package attribution move money on different bases.**
The `Shared` column is a % of the **gross** bill; the amount actually
reflected in `Net` for the same split is the same % applied to
**post-tax**. Same visit, two different numbers by design — `Shared` is a
useful gross reconciliation figure against the original bill, `Net` is the
real take-home. The Monthly Statement's Shared column tooltip states this
explicitly so it doesn't read as the two disagreeing by mistake.

**Attribution audit view** (`attributionAuditService.ts`,
`AttributionAuditPage.tsx`, Reports → "Attribution audit" tab): a
per-transaction ledger for a month — every rupee either mechanism moved,
with the visit, patient, from/to therapist, and gross/post-tax amounts —
so a disputed Shared or Net figure can be traced back to the specific
visit(s) that produced it, rather than taken on faith. Mirrors
`reportService.monthly`'s own two loops exactly (same source visits, same
in-window scoping for package attribution) so the list always sums to the
same deltas that produced that month's Net figures. A **Basis** column
shows what the moved amount is a share OF — a bare "₹500" moved between
two names is unverifiable on its own: for `manual_split`, the full visit
bill and the % applied; for `package_attribution`, the billing visit's
total price, the package's declared session count, and which session
number triggered this row (e.g. "Session 2 of 3 · ₹1,500 package"). Gross
is null for every `package_attribution` row by design — continuation
sessions are billed at ₹0, so only a Post-Tax share (derived from the
billing visit) ever moves there; the UI explains this via a tooltip on
the empty cell rather than leaving it unexplained.

**`hv_paise` (Partner Share) is the bill split between the two
organizations, pre-tax — not "everything that isn't the clinic's post-tax
take."** `hvPaise = billPaise - bmSharePaise`, so `bmSharePaise + hvPaise
=== billPaise` always. An earlier formula (`billPaise - postTaxPaise`)
silently folded TDS into the partner-share figure, since
`postTaxPaise = bmSharePaise - tdsPaise` — the partner's column read as
their share plus the clinic's own withheld tax, overstating it by exactly
the TDS every time. `TDS Deducted` already has its own column, so this was
a wrong formula, not a missing one. Fixed going forward in
`computeVisitSplit` (`src/domain/split.ts`); existing rows were backfilled
live via a flag-gated bypass of the invoice-freeze trigger (migration
`20260822034435_backfill_hv_paise.sql` — the same `app.allow_invoice_amendment`
flag `amend_invoice()` uses for `invoice_id` re-points, extended to also
cover `hv_paise`, since correcting this one snapshot field is the same
kind of narrow, flag-gated exception; every other financial field on an
invoiced visit stays frozen either way). `hv_paise` never drives real
payout logic — the hospital settlement in `MonthlyStatementPage` reconciles
against `postTaxPaise` only — so the backfill carries no risk to real
figures, only to a previously-mislabeled report column.

### 3. Sequential Gap-Free Invoices
- **Server-issued numbers** via `issue_invoice()` RPC
- **Per-clinic per-FY counter** in `invoice_counters` table
- **Prevents concurrent duplicates** with DB locking
- **Online-only** to maintain gap-free guarantee

### 3b. Invoice Amendments
A TPA/insurance payer sometimes asks for a corrected bill-cum-receipt on an
already-issued invoice (e.g. missing visit dates added). Invoices are
immutable by design (`invoices_immutable` trigger, corrections raise "issued
invoices are immutable; corrections require an amendment record") — so a
correction is a brand-new invoice that **supersedes** the old one, never an
edit to it. Both stay on record for audit; only the latest is what a payer
should honor.

- **`invoices.supersedes_invoice_id`** — a one-directional forward pointer
  (new → old) only. The old invoice can never be updated to point at its
  replacement without violating immutability, so "X is amended by Y" is
  always derived by querying `where supersedes_invoice_id = X.id`, never
  stored on X itself.
- **`amend_invoice()` RPC** mirrors `issue_invoice()`'s membership/
  entitlement/access checks and gets its own real, gap-free sequential
  invoice number from the same counter — but accepts visit IDs already on
  the invoice being amended (in addition to any newly-added, previously
  uninvoiced visits) and stamps `supersedes_invoice_id`.
- **`protect_invoiced_visit()` trigger bypass**: re-pointing `invoice_id`
  on an already-invoiced visit is normally blocked unconditionally.
  `amend_invoice()` sets a transaction-local flag
  (`set_config('app.allow_invoice_amendment', 'true', true)`) that the
  trigger checks specifically for that one field — every other financial-
  field freeze on an invoiced visit stays fully enforced even during an
  amendment, so an amendment can only add/re-point visits, never edit a
  visit's billed amount. The same flag also gates `hv_paise` (extended in
  `20260822034435_backfill_hv_paise.sql` to backfill the corrected
  Partner Share formula, §2b) — the only two fields this bypass ever
  covers; every other check in the trigger's OR-chain is unconditional.
- **UI**: `InvoicePrintPage` shows a "Superseded by …" banner on an old
  invoice and an "Amendment to …" banner on the new one, each linking to
  the other. "Amend this invoice" opens `AmendInvoiceDialog`
  (`src/components/AmendInvoiceDialog.tsx`), which carries the original's
  own visits forward and lets staff pick additional uninvoiced visits for
  the same patient before issuing.
- **Reporting impact**: none needed — `reportService`/`dashboardService`
  query `visits` directly, and each visit's `invoice_id` always points to
  whichever invoice currently claims it, so reports automatically reflect
  only the latest state.

**"Not invoiced" nudge for a trailing package session** — `issue_invoice()`
sweeps in every session that exists in a package group *at issue time*
(including ₹0 continuations), stamping `invoice_id` on all of them. A
session logged **after** that point never gets swept in, so two ₹0 rows
of the same package can show arbitrarily different lock state (one 🔒,
one not) with nothing explaining why — this is exactly the case
Invoice Amendments exists to fix, but nothing pointed a viewer at it.
`VisitCardData.packageInvoicePending` (`src/components/VisitCard.tsx`)
closes that gap: true for a ₹0 package-continuation row whose own
`invoiceId` is null but a sibling in the same `packageGroupId` already
has one, rendered as an amber "Not invoiced" pill next to the status
chip. Computed independently at each of the three places that build
`VisitCardData` (Ledger, Workspace, Patient Profile) since each already
shapes its own rows from a different source query — Ledger/Workspace
check the full package group via `repos.visits.listByPackageGroup()`
(their loaded visit list is date/day-scoped and would miss an
out-of-window sibling), while Patient Profile scans its already-loaded,
unbounded per-patient visit history directly.

### 3c. Adding a Parameter to an Existing RPC Function (Postgres identity gotcha)

Postgres identifies a function by **name + argument types**, not name
alone. `create or replace function` with a **changed argument list does
not replace the existing function** — it silently creates a second,
distinct one alongside it. `issue_invoice()`/`amend_invoice()` needed a new
optional trailing `p_clinical_snapshot jsonb default null` parameter for
Billing & Notes Rebuild Phase 1's clinical-context feature; the naive
`create or replace` approach would have left the old N-arg function live
next to a new N+1-arg one, and the moment both matched a call (any
unrefreshed client still sending the old arg set), PostgREST/Postgres can
no longer tell which one to call — **invoice issuance hard-fails clinic-
wide for the deploy window**, on the one operation in this app that can't
be retried offline.

**Correct pattern, used by the migration that added this field**: an
explicit `drop function <exact old signature>` followed by
`create function <new signature>`, in the same migration transaction, so
exactly one candidate function ever exists. PostgREST's own
missing-key-resolves-to-SQL-default behavior then means an old client
sending only the original argument set still succeeds against the new
function (the omitted parameter resolves to its `default`), while a
refreshed client sending the new key succeeds too. Any signature-scoped
grant/revoke (e.g. `revoke execute … from anon`, see RLS Hardening in
Phase-0-era migrations) must be **re-issued against the new signature** —
it does not carry over from the old one, since as far as Postgres is
concerned this is a different function, not an edit to the old one.

### 3d. Invoice Clinical-Details Editing
Amendment (§3b) is the right tool for a correction that changes what's
being billed — added visits, a different total. Most real-world "fix this
invoice" requests are narrower than that: a diagnosis was mistyped, a
physician's registration number was missing. Minting a whole new invoice
number for a metadata typo is disproportionate, so `clinical_snapshot` gets
its own narrow in-place edit path instead.

- **`reject_invoice_mutation()` trigger, narrowed**: previously rejected
  every update unconditionally. Now allows an update through IFF (a) it
  runs inside `update_invoice_clinical_details()`'s transaction-local
  `set_config('app.allow_invoice_clinical_edit', 'true', true)` bypass —
  the same pattern §3b's amendment flag uses — AND (b) no column outside
  `clinical_snapshot` actually changed, checked column-by-column in the
  trigger itself as a second line of defense against a bug in the RPC.
  Every other financial field (amount, line items, invoice number, payment
  mode, `supersedes_invoice_id`, …) stays genuinely immutable.
- **`update_invoice_clinical_details()` RPC** — same membership +
  `invoicing_access` permission check as `issue_invoice()`/`amend_invoice()`
  (any clinic member when `all_staff`, admin/front_desk only when
  `billing_staff`), `security definer` so it can bypass invoices' select-
  only RLS policy the same way the other two invoice RPCs do.
- **`invoices` now carries the generic `audit_log` trigger** (see §M0's
  `audit_row_change()`), added in the same migration. It was deliberately
  excluded when `audit_log` first shipped, on the reasoning that a fully
  immutable table could never produce a meaningful before/after row — that
  reasoning no longer holds now that one field can change, so every
  clinical-details edit gets a genuine before/after audit row like any
  other editable table.
- **UI**: `EditInvoiceDetailsDialog` (see "Editing clinical details after
  issuance" in §3) — reachable from `InvoicePrintPage`'s "Edit details"
  button, hidden once an invoice is superseded (same guard as "Amend this
  invoice").
- Migration: `20260827000004_invoice_clinical_edit.sql`.

### 4. Walk-In MRNO Auto-Generation
- **Sequential per clinic per year**: `PREFIXYY-NNNN` (W26-0001, W26-0002)
- **Sequence derived by scanning** existing walk-in MRNOs (no running counter)
- **Naturally resets each January** when YY changes
- **Auto-widening** past 9999 via padStart no-op behavior
- **Collision retry loop** for offline generation safety

### 5. Episode of Care via Enrollments
- **patient_module_enrollments** tracks when a patient enters/exits a clinical episode
- **Consultation notes** linked to enrollment for follow-up context
- **Carry-forward** logic in follow-up mode uses this enrollment

### 6. Role-Based Access Control (Server-Side RLS)
- **Three roles**: admin, therapist, front_desk
- **Postgres RLS policies** restrict table visibility and write scope
- **Helper functions**: `is_clinic_member()`, `is_clinic_admin()`
- **SECURITY DEFINER RPCs** bypass RLS where needed (e.g., `issue_invoice()`)

### 7. Audit Trail & Compliance
- **audit_log table** logs mutations per row (`table_name`, `row_id`, `action`)
- **old_data / new_data** capture the full before/after row as jsonb
- **changed_by** tracks who made the change
- **created_by / updated_by** on financial tables (visits, invoices, payments)

### 8. Soft Deletes for Safety
- **Patients**: `deleted_at` — soft delete, still resolves in notes
- **Visits**: `deleted` boolean — hard delete via RPC only
- **Therapists**: `active` boolean — deactivation, hard delete only if zero visits

### 9. Date Display: Short On-Screen, Full On Paper
- **`formatDateDM`** (`DD/MM`, no year) — the default for interactive
  on-screen dates: visit rows/cards, invoice dates, note editor/list dates.
  The year is redundant when the date is always close to "now" in context.
- **`formatDateDMY`** (`DD/MM/YY`) — reserved for dates that can legitimately
  be a very different year: first/last visit, package start, arbitrary
  date-range filter text, historical import rows.
- **All printed/exported documents keep full-year dates unconditionally**
  (visits CSV, invoice print, monthly ledger print, note print) — they're
  standalone records that may be reviewed later without app context.
- Both functions live in `src/domain/fiscalYear.ts`; the choice between them
  is a per-usage judgment call, not something to change without checking
  which bucket a given date falls into.

---

## Key Technologies

### Frontend
- **React 18** with hooks
- **TanStack Router** for URL-first routing
- **TypeScript** for type safety
- **Tailwind CSS** for styling
- **Dexie** for IndexedDB local-first storage
- **Supabase Client** for realtime subscriptions and storage

### Backend
- **Supabase** (Postgres database)
- **Row-Level Security (RLS)** policies
- **Postgres Functions** (SECURITY DEFINER RPCs)
- **DB Triggers** for immutability and audit trails

### Testing & Quality
- **Vitest** for unit tests
- **Playwright** for e2e smoke tests
- **TypeScript strict mode** (`tsc --noEmit`)
- **ESLint** for code quality

---

## Security & Data Governance

- **Every table carries `clinic_id`** — RLS restricts all access to clinic members
- **Patient data is health data** — no anonymous read path
- **Issued invoices and visits frozen** by DB triggers; corrections go through the invoice-amendment feature (§3b) — a new invoice that supersedes the old one, never an edit to it
- **Rate/tax changes apply to new visits only** — history keeps the rates it was billed under
- **Export monthly CSVs** — this app should never be the only copy of financial records

---

## Deployment & Environment

### One-Time Setup
1. Create Supabase project
2. Apply migrations in filename order from `supabase/migrations/`
3. Run `supabase/seed.sql`
4. Provision a clinic and its first admin via `supabase/provision_clinic.sql`
   / grant further clinic access via `supabase/setup_members.sql`
5. Deploy the `invite-therapist` edge function (`supabase/functions/`) —
   used by Settings → Team to invite a new login without exposing a
   service-role key to the browser. `supabase/config.toml` pins
   `[functions.invite-therapist] verify_jwt = false` so browser CORS
   preflights reach the handler (the function still checks the caller's
   JWT + admin role inside). Redeploy after changing the function or
   config: `supabase functions deploy invite-therapist`. Ensure
   Authentication → URL configuration lists every production/staging
   origin in **Redirect URLs** (the invite link uses
   `{origin}/reset-password`) and that **SMTP** or Supabase's built-in
   mailer is configured under Authentication → Email — without it,
   `inviteUserByEmail()` creates the user but no message is delivered.
6. `cp .env.example .env` and fill in project URL + anon key
7. `npm install && npm run dev`

### Development Commands
| Command | Purpose |
|---------|---------|
| `npm run dev` | Dev server on :5173 |
| `npm test` | Unit tests (domain + services) |
| `npm run typecheck` | Strict TypeScript check |
| `npm run lint` | ESLint |
| `npm run build` | Production build |
| `npm run e2e` | Playwright smoke tests |

### Sync & Offline Handling
- **SyncBadge** component shows connection state and sync status
- **Outbox pattern** queues changes offline
- **Delta pull** on reconnection fetches updates
- **Realtime subscriptions** keep local store fresh

---

## Phase Roadmap

### Phase 1: Ledger & Revenue ✅ LIVE
- Visit entry and ledger
- Invoice issuance (gap-free sequential)
- Revenue split tracking
- Offline-first sync
- Historical import

### Phase 2: Core Assessment ✅ LIVE
- Consultation notes (initial/follow-up)
- Clinical assessment fields (ROM, MMT, neuro, pain profiling)
- Episode-of-care tracking
- Outcome tracking with direction-aware cards

### Phase 3: Role Model & Billing Access ✅ LIVE
- Server-side role enforcement (admin/therapist/front_desk)
- Billing access gating
- Therapist comparison chart
- Nav restructure

### Phase 3b: Sync Fixes & Patient ID Redesign ✅ LIVE
- Sequential walk-in MRNO format (PREFIXYY-NNNN)
- Auto-widening behavior
- Yearly reset capability
- Schema drift fixes (missing columns)
- useClinicRole empty clinicId fix

