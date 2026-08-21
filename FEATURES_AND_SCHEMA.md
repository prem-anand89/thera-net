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
  - Today's visits with payment state at a glance (Paid / Collect ₹X / ₹0 session) — boxed cards on phone, a table on tablet/desktop
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
- **Quick "Mark paid"** action from Workspace pending feed
- **Monthly report** shows HV settlement card for variance tracking

#### Billing Access Control
- **Clinic-level toggle** restricts who is allowed to issue invoices
  - "Everyone" vs. "Billing staff only"
  - Enforced server-side inside `issue_invoice()` RPC, not just hidden in UI

#### Monthly Report
- **Fiscal-year-aware** (Apr–Mar)
- **Per-therapist metrics**: Bill, BM Share, TDS, Post-Tax, HV, unique patients, total
- **CSV export** capability

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
Patterns below.

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
Direct payment against a visit, independent of any invoice — lets cash/UPI
collection be recorded without requiring an invoice first, and supports
partial payments (an amount less than the visit's bill).

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

#### `patient_module_enrollments`
```sql
id              uuid PRIMARY KEY
clinic_id       uuid NOT NULL (FOREIGN KEY → clinics.id)
patient_id      uuid NOT NULL (FOREIGN KEY → patients.id)
module_type     text NOT NULL (e.g., "core_assessment")
status          text NOT NULL — episode open/closed state
created_by, updated_by  uuid (NULLABLE)
enrolled_at, updated_at  timestamptz NOT NULL
```

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

#### `clinic_module_settings`, `clinic_entitlements` — dead infrastructure
Both tables still exist (RLS enabled, no policies) but have **zero client
code** reading or writing them anywhere in `src/` — no Dexie table, no repo,
no sync. They were built for a Tier-1/Tier-2 module-gating mechanism that
was never wired up. The `modules` reference table they originally pointed
to was dropped (`20260820000001_drop_unused_modules_table.sql`); these two
were left in place since removing them wasn't asked for. Don't build new
features against them without first confirming they're actually meant to
be resurrected — as of this writing they're inert.

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
the month) and (2) an automatic package-attribution delta — a package's
total Post-Tax BM divided evenly across the therapists who ran its
sessions, using an exact whole-rupee **largest-remainder distribution**
(not independent per-session rounding) so the shares always sum to the
package's exact total with zero drift. Package attribution deltas are
applied **only to each visit's own row, never to `total.netPostTaxPaise`**
— attribution redistributes which row a rupee counts under, it never
changes what the clinic-wide total claims. This means a package spanning
two report periods (started one month, finished the next) can leave a
single month's row-level sum not exactly matching that month's total —
expected, since the whole point of attribution is that a session's true
credit doesn't always land in the billing month.

This is the one number used everywhere a therapist's own "how much revenue
did I generate" is shown — Trends KPI/chart, Therapist Comparison (both the
trend and the live table), and the Monthly Statement's "Net" column (shown
unconditionally, unlike "Shared" which stays behind the `enableTherapistSplit`
opt-in). There is no separate "gross attributed revenue, ignoring splits"
concept anymore — that used to be a parallel `attributedRevenuePaise` field/
column, folded into `netPostTaxPaise` instead so there's one lens, not two.

### 3. Sequential Gap-Free Invoices
- **Server-issued numbers** via `issue_invoice()` RPC
- **Per-clinic per-FY counter** in `invoice_counters` table
- **Prevents concurrent duplicates** with DB locking
- **Online-only** to maintain gap-free guarantee

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
- **Issued invoices and visits frozen** by DB triggers (corrections = future amendment/credit-note feature)
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

