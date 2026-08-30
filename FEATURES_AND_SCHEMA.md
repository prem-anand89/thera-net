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
- **Price override** with mandatory adjustment reason
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

#### Service Catalog
- Category and name per item — category is free text (autocompleted from
  existing categories via a datalist), and the Settings list/table groups
  items under a category heading rather than repeating it per row
- Session count (1, 3, 5, etc. for package pricing)
- Base price (in paise)
- Active toggle
- Unique constraint per clinic

#### No-Return Reason Catalog
- Clinic-editable list of predefined reasons for patient no-shows
- Linked to visit records for reporting

#### Feature Toggles
- Therapist comparison chart (off by default)
- Billing staff restriction (on by default)

### 9. Patient Communications (Phase 0 — foundation only)

Full spec/roadmap: `docs/HANDOFF-patient-comms.md`. Only the foundation has
shipped so far — a staff-facing "Ask for feedback" trigger, triage inbox,
booking requests, and reminders are later phases, not yet built.

- **`clinics.enable_patient_comms`** — module gate, off by default, same
  pattern as `clinicalDocsEnabled`/`enableExpectedToday`. Public token routes
  refuse to resolve when a clinic hasn't turned this on.
- **`patients.do_not_message`** — opt-out flag, honored by every send path
  once those paths exist (Phase 1+); staff-settable toggle, no automated
  detection.
- **Public feedback link (`/f/$token`)** — the app's first and only
  anonymous write path. A therapist/front-desk/admin action (Phase 1, not
  yet built) will create a `feedback_requests` row with a server-generated
  256-bit token; a patient opens `/f/$token` with no login, submits a 1–5
  star rating and optional comment via `submit_feedback_response()`, and
  that's the entire interaction. Both public RPCs are rate-limited per IP
  and return an identical generic error for every failure case (invalid,
  expired, already responded, module off) — deliberately not distinguishable,
  so the endpoint can't be used to enumerate which tokens exist.
- **Feedback visibility is admin-only, at the RLS layer, not just the UI.**
  Front desk and therapists can see that a request exists/its status (no
  rating or comment content), but `feedback_responses` SELECT is restricted
  to `is_clinic_admin()` — this is a real access boundary, not a hidden menu
  item.

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
                         consultation-note, therapist services

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
| `/more` | Mobile-only overflow nav (Settings/Reports on narrow screens) | All roles |
| `/reset-password` | Password reset | Unauthenticated |
| `/f/$token` | Public patient feedback form (Patient Communications, Phase 0) | Unauthenticated — token-scoped, no clinic membership |
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
enable_expected_today       boolean NOT NULL
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
id               uuid PRIMARY KEY
clinic_id        uuid NOT NULL (FOREIGN KEY → clinics.id)
invoice_no       text NOT NULL — `PREFIX/FY-LABEL/NNNN`
fy_label         text NOT NULL (e.g., "26-27")
seq              int NOT NULL
issued_at        timestamptz NOT NULL
patient_snapshot jsonb NOT NULL — patient details at issue time
line_items       jsonb NOT NULL
total_paise      bigint NOT NULL
payment_mode     text NOT NULL — 'Cash' | 'Card' | 'UPI' | 'Insurance'
therapist_id     uuid (FOREIGN KEY → therapists.id, NULLABLE)
created_by, updated_by  uuid (NULLABLE)
updated_at       timestamptz NOT NULL
```
Immutable once issued (DB trigger). Payment status is **not** a column here —
see `invoice_payments` below.

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
those visits' `payments` rows in date order.

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

#### `expected_visits`
```sql
id            uuid PRIMARY KEY
clinic_id     uuid NOT NULL (FOREIGN KEY → clinics.id)
patient_id    uuid (FOREIGN KEY → patients.id, NULLABLE) — NULL for a
              not-yet-a-patient expected arrival
patient_name  text (NULLABLE)
time_note     text NOT NULL — free text, e.g. "4pm" or "after lunch"
visit_date    date NOT NULL
status        text NOT NULL
created_by, updated_by  uuid (NULLABLE)
updated_at    timestamptz NOT NULL
```
Backs Workspace's "Expected today" list — manually added or matched patients
expected in that day, independent of any actual visit record.

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
note_mode                 text (NULLABLE) — 'initial' | 'followup'
status                    text NOT NULL — 'draft' | 'completed' | 'archived'
assessment_payload        jsonb (NULLABLE) — the whole Core Assessment form
                           (history, pain, PSFS, body chart, objective exam,
                           treatment/HEP) as one versioned/upcastable blob,
                           not separate columns per section
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

#### `feedback_requests` / `feedback_responses` / `message_log` (Patient Communications, Phase 0)
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
patient (Settings → Referral sources, its own tab), same add / deactivate-not-delete / rename
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
otherwise), and is called from the insert/update RLS policies on
`consultation_notes`, `face_scale_responses`, and `facial_palsy_assessments`.
Every write to those three tables runs through it today.

What's genuinely missing is the **client side**: no Dexie table, no repo,
no sync, no UI anywhere in `src/` reads or writes either table — so nothing
in the app currently sets a narrower entitlement or surfaces a "this module
is off" state. In practice every clinic reads as fully entitled, because
nothing has ever populated `clinic_entitlements` with a restrictive row.
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
`clinic_module_settings('consultation_notes')` are two separate gates for
the same live, actively-used feature (see the dead-infrastructure section
above) — adding a third (plan-tier) gate on top without reconciling those
first risks breaking real clinical documentation. The five module keys have
zero client code today regardless, so gating them has no practical effect
yet. Deferred to the still-open "advanced modules content" planning pass.

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

`FirstWeekChecklist.tsx` was rewritten into an actual 8-step setup
sequence (clinic profile → services → invite team → link therapists → log
a visit → wait for Synced → clinical notes decision → backup), replacing
the old flat list of gotcha tips with no ordering logic. Two steps get
plan-aware copy (`invite-team`, `wait-synced`). Completion is now tracked
per-step (`db.meta` key `firstWeekChecklistCompletedSteps`, a JSON array of
stable step ids — not indices, so reordering the list later can't corrupt
someone's in-progress state) rather than the old single dismiss flag; the
card collapses to a "Setup complete" summary once all 8 are checked. The
original single dismiss flag (`firstWeekChecklistDismissed`) still exists
unchanged for the explicit "Hide" button, which fully removes the card
regardless of completion.

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
   service-role key to the client
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

