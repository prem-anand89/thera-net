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
  - Today's visits with payment state at a glance (Paid / Collect ₹X / ₹0 session)
  - Open packages with stale flags (14+ days since last visit)
  - Pending work (outstanding invoices, incomplete notes)
  - Recent visits in rolling 7/15/30 day windows
- **Stat strip** — Today's visits count, collected today, new patients this month, packages this month
- **Quick actions** — "Mark paid" for invoices, visit entry, patient creation

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
- **Setup → Import historical visits** — one-time import from clinic's Excel ledger
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
- **Search by MRNO or name**
- **Create-if-missing** on visit entry
- **Walk-in MRNO auto-generation** (sequential per clinic per year)
- **Editable fields**: age, sex, phone, primary condition, referring source

#### Patient Profile
- **Visit history** with dense table
- **Clinical notes section** — drilling into note editor
- **Package tracking** — open and completed packages
- **Referring source** display with detail (doctor/hospital names)

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
- Category and name per item
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
  ├── visits/            VisitsPage at /ledger (Visits/Invoices sub-tabs, URL-addressable)
  ├── patients/          PatientProfilePage, clinical notes, visit history
  ├── insights/          Dashboard + monthly statement at /insights
  ├── setup/             SetupPage at /settings (clinic configuration)
  ├── invoices/          Invoice printing and management
  ├── reports/           Monthly ledger and reports
  └── patients/notes/    NoteEditorPage (Core Assessment notes)

src/components/          Shared UI components
                         BodyChart, ScaleWidget, TreatmentNote, ColumnsPicker,
                         ChartComponents, PaymentState, etc.

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
| `/ledger` | Historical visit records & invoices, URL-addressable sub-tabs (`?tab=visits\|invoices`) | All roles (Invoices tab requires billing access) |
| `/patients/$patientId` | Individual patient profile, clinical notes history | All roles |
| `/patients/$patientId/notes/$noteId` | Core Assessment note editor (Initial/Follow-up) | Therapists & admins |
| `/insights` | Dashboard + monthly per-therapist statement (`?tab=monthly`) | Admins & front_desk only |
| `/settings` | Clinic configuration, MRNO settings, billing mode, rate setup, feature toggles | Admins only |
| `/archive`, `/setup`, `/invoices`, `/reports` | Legacy redirects for old bookmarks | All roles |

---

## Database Schema

### Core Tables

#### `clinics`
```sql
id              uuid PRIMARY KEY
name            text NOT NULL
address         text
phone           text
email           text
gst_no          text
logo_path       text
partner_hospital_name   text
partner_hospital_logo_path  text
invoice_prefix  text DEFAULT 'INV'
bm_split_pct    numeric(5,2) DEFAULT 75
tax_pct         numeric(5,2) DEFAULT 10
tds_basis       text CHECK (tds_basis IN ('gross_bill', 'bm_share'))
fy_start_month  int DEFAULT 4 CHECK (fy_start_month BETWEEN 1 AND 12)
billing_mode    text CHECK (billing_mode IN ('standalone', 'partnership'))
billing_enabled boolean DEFAULT true
walk_in_mrno_prefix text (NULLABLE)
therapist_comparison_enabled boolean DEFAULT false
updated_at      timestamptz SERVER_DEFAULT now()
```

#### `clinic_members`
```sql
clinic_id       uuid NOT NULL (FOREIGN KEY → clinics.id)
user_id         uuid NOT NULL (FOREIGN KEY → auth.users.id)
role            text DEFAULT 'admin'
                CHECK (role IN ('admin', 'therapist', 'front_desk'))
display_name    text (NULLABLE)
photo_path      text (NULLABLE)
updated_at      timestamptz SERVER_DEFAULT now()
PRIMARY KEY (clinic_id, user_id)
```

#### `therapists`
```sql
id              uuid PRIMARY KEY
clinic_id       uuid NOT NULL (FOREIGN KEY → clinics.id)
name            text NOT NULL
active          boolean DEFAULT true
user_id         uuid (FOREIGN KEY → auth.users.id, NULLABLE)
photo_path      text (NULLABLE)
updated_at      timestamptz SERVER_DEFAULT now()
```

#### `service_catalog`
```sql
id              uuid PRIMARY KEY
clinic_id       uuid NOT NULL (FOREIGN KEY → clinics.id)
category        text NOT NULL
name            text NOT NULL
session_count   int DEFAULT 1 CHECK (session_count >= 1)
base_price_paise bigint NOT NULL CHECK (base_price_paise >= 0)
active          boolean DEFAULT true
updated_at      timestamptz SERVER_DEFAULT now()
UNIQUE (clinic_id, name)
```

#### `patients`
```sql
id              uuid PRIMARY KEY
clinic_id       uuid NOT NULL (FOREIGN KEY → clinics.id)
mrno            text NOT NULL
mrno_source     text DEFAULT 'hospital'
                CHECK (mrno_source IN ('hospital', 'auto'))
name            text NOT NULL
age             int CHECK (age BETWEEN 0 AND 150)
sex             text CHECK (sex IN ('M', 'F', 'Other'))
phone           text
primary_condition text
referring_source text CHECK (referring_source IN ('doctor_referral', 'word_of_mouth',
                  'online', 'self', 'other'))
referring_source_detail text
deleted_at      timestamptz (NULLABLE) — soft delete
updated_at      timestamptz SERVER_DEFAULT now()
UNIQUE (clinic_id, mrno)
```

#### `visits`
```sql
id              uuid PRIMARY KEY
clinic_id       uuid NOT NULL (FOREIGN KEY → clinics.id)
patient_id      uuid NOT NULL (FOREIGN KEY → patients.id)
therapist_id    uuid NOT NULL (FOREIGN KEY → therapists.id)
visit_date      date NOT NULL
condition       text
treatment_notes text
service_catalog_id uuid NOT NULL (FOREIGN KEY → service_catalog.id)
catalog_price_paise bigint NOT NULL CHECK >= 0
actual_bill_paise bigint DEFAULT 0
adjustment_paise bigint DEFAULT 0
adjustment_reason text
session_index   int CHECK (session_index >= 1)
package_total   int CHECK (package_total >= 1)
package_group_id uuid
pending_payment_note text (NULLABLE)
bm_split_pct    numeric(5,2) NOT NULL (snapshot)
tax_pct         numeric(5,2) NOT NULL (snapshot)
tds_basis       text CHECK (tds_basis IN ('gross_bill', 'bm_share'))
bm_share_paise  bigint NOT NULL (computed at billing)
post_tax_paise  bigint NOT NULL (computed at billing)
tds_paise       bigint NOT NULL (computed at billing)
hv_paise        bigint NOT NULL (computed at billing)
invoice_id      uuid (FOREIGN KEY → invoices.id, NULLABLE)
deleted         boolean DEFAULT false
updated_at      timestamptz SERVER_DEFAULT now()
updated_by      uuid (FOREIGN KEY → auth.users.id, NULLABLE)
created_by      uuid (FOREIGN KEY → auth.users.id, NULLABLE)
INDEXES: clinic_date, patient, clinic_updated
```

#### `invoices`
```sql
id              uuid PRIMARY KEY
clinic_id       uuid NOT NULL (FOREIGN KEY → clinics.id)
invoice_no      text NOT NULL
fy_label        text NOT NULL (e.g., "26-27")
seq             int NOT NULL
issued_at       timestamptz DEFAULT now()
patient_snapshot jsonb NOT NULL (patient details at issue time)
line_items      jsonb NOT NULL (array of line items)
total_paise     bigint NOT NULL CHECK >= 0
payment_mode    text CHECK (payment_mode IN ('Cash', 'Card', 'UPI', 'Insurance'))
therapist_id    uuid (FOREIGN KEY → therapists.id)
payment_status  text CHECK (payment_status IN ('billed', 'collected', 'receipted'))
created_by      uuid (FOREIGN KEY → auth.users.id, NULLABLE)
updated_by      uuid (FOREIGN KEY → auth.users.id, NULLABLE)
updated_at      timestamptz SERVER_DEFAULT now()
UNIQUE (clinic_id, fy_label, seq)
UNIQUE (clinic_id, invoice_no)
INDEXES: clinic_updated
```

#### `invoice_counters`
```sql
clinic_id       uuid NOT NULL (FOREIGN KEY → clinics.id)
fy_label        text NOT NULL
next_seq        int DEFAULT 1
PRIMARY KEY (clinic_id, fy_label)
```

### Clinical Notes Tables

#### `consultation_notes`
```sql
id              uuid PRIMARY KEY
clinic_id       uuid NOT NULL (FOREIGN KEY → clinics.id)
patient_id      uuid NOT NULL (FOREIGN KEY → patients.id)
therapist_id    uuid NOT NULL (FOREIGN KEY → therapists.id)
note_type       text CHECK (note_type IN ('initial', 'followup'))
chief_complaint text
history_payload jsonb NOT NULL (nested structure)
subjective_payload jsonb NOT NULL
objective_payload jsonb NOT NULL
functional_status_payload jsonb NOT NULL
treatment_payload jsonb NOT NULL
nrs_score       int (derived: current pain score for filtering)
psfs_mean       numeric(5,2) (derived: mean functional status)
red_flag_count  int (derived: count of red flags)
consultation_date date
created_at      timestamptz DEFAULT now()
updated_at      timestamptz SERVER_DEFAULT now()
created_by      uuid (FOREIGN KEY → auth.users.id)
updated_by      uuid (FOREIGN KEY → auth.users.id)
```

#### `patient_module_enrollments`
```sql
id              uuid PRIMARY KEY
clinic_id       uuid NOT NULL (FOREIGN KEY → clinics.id)
patient_id      uuid NOT NULL (FOREIGN KEY → patients.id)
module_name     text (e.g., "core_assessment")
enrolled_at     timestamptz DEFAULT now()
discharge_at    timestamptz (NULLABLE) — end of episode
updated_at      timestamptz SERVER_DEFAULT now()
```

### Additional Tables

#### `audit_trail`
```sql
id              uuid PRIMARY KEY
clinic_id       uuid NOT NULL (FOREIGN KEY → clinics.id)
entity_type     text (e.g., 'visit', 'invoice', 'patient')
entity_id       uuid NOT NULL
action          text CHECK (action IN ('create', 'update', 'delete'))
actor_id        uuid (FOREIGN KEY → auth.users.id)
changed_fields  jsonb (before/after diffs)
created_at      timestamptz DEFAULT now()
```

#### `ai_generation_log`
```sql
id              uuid PRIMARY KEY
clinic_id       uuid NOT NULL (FOREIGN KEY → clinics.id)
user_id         uuid NOT NULL (FOREIGN KEY → auth.users.id)
entity_type     text (e.g., 'treatment_note', 'hep')
entity_id       uuid
prompt          text
result          text
created_at      timestamptz DEFAULT now()
```

#### `visit_column_preferences`
```sql
id              uuid PRIMARY KEY
clinic_id       uuid NOT NULL (FOREIGN KEY → clinics.id)
user_id         uuid NOT NULL (FOREIGN KEY → auth.users.id)
visible_columns text[] (array of column names to show in ledger)
updated_at      timestamptz DEFAULT now()
```

#### `no_return_reason_catalog`
```sql
id              uuid PRIMARY KEY
clinic_id       uuid NOT NULL (FOREIGN KEY → clinics.id)
reason          text NOT NULL
active          boolean DEFAULT true
created_by      uuid (FOREIGN KEY → auth.users.id)
updated_by      uuid (FOREIGN KEY → auth.users.id)
updated_at      timestamptz SERVER_DEFAULT now()
UNIQUE (clinic_id, reason)
```

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
- **audit_trail table** logs all mutations (create/update/delete)
- **actor_id** tracks who made the change
- **changed_fields** captures before/after diffs
- **created_by / updated_by** on financial tables (visits, invoices, payments)

### 8. Soft Deletes for Safety
- **Patients**: `deleted_at` — soft delete, still resolves in notes
- **Visits**: `deleted` boolean — hard delete via RPC only
- **Therapists**: `active` boolean — deactivation, hard delete only if zero visits

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
4. Create auth users and grant clinic access via `supabase/setup_members.sql`
5. `cp .env.example .env` and fill in project URL + anon key
6. `npm install && npm run dev`

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

### Phase 4: Future (TBD)
- Region Modules (FaCE Scale, Facial Palsy)
- HEP exercise library & video linking
- Protocol library & phase management
- Treatment consent tracking
- Advanced outcome reports (MCID aggregation, multi-patient trends)
