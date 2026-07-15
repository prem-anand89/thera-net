# Thera.Net — Patient Visit Ledger & Clinical Documentation

Offline-first visit ledger, revenue-split tracker, and invoice book for
physiotherapy clinics operating inside a partner hospital, extended with a
consent-compliant clinical documentation layer. Built for Beyond Mechanics @
Health Valley, structured multi-clinic from day one.

**Stack:** React + Vite + TypeScript · Supabase (Postgres/Auth/Realtime/Storage)
· Dexie (IndexedDB) local-first store with outbox sync · Tailwind CSS.

**Current scope:** the visit ledger (visits, invoices, reports, dashboard) and
clinical documentation (consultation notes, consent ledger) only. Assessment
modules (FaCE Scale, Facial Palsy, and others) are deliberately out of scope
for now and will be added once this base layer is finalized.

## What it does

### Visit Management & Ledger
- **Visit entry & patient lookup** — search by MRNO/name (create-if-missing, walk-in MRNO auto-generation), visit entry with catalog price autofill, price override with mandatory adjustment reason, package session tracking (1/3, 2/3 … with ₹0 continuations).
- **Today-first workspace** — default landing page showing today's visits with payment state at a glance (Paid / Collect ₹X / ₹0 session), open packages with stale flags, pending work (outstanding invoices, incomplete notes), and recent visits in a rolling 7/15/30 day window.
- **Archive & historical records** — full visit history with dense table, patient enrichment (last visit + count, treatment, condition, bill amount), therapist filter, date range search, bulk actions (invoice, repeat, split, delete).

### Revenue & Invoicing
- **Revenue split** — per visit, computed at billing time and stored with the rate snapshot: BM Share (75%), Post-Tax (90% of share), TDS (configurable basis: % of gross bill or % of BM share), HV share. Rounding: half-up to the rupee, once per visit — rollups reconcile by construction.
- **Invoices** — server-issued, gap-free sequential numbers per clinic per FY (`BM/26-27/0001`), immutable once issued (DB triggers), printable A4/A5 with clinic letterhead + optional partner-hospital branding.
- **Payment status & HV settlement** — simple paid/outstanding status per invoice with quick "Mark paid" action from Workspace pending feed. Monthly report shows HV settlement card for variance tracking.
- **Monthly report** — fiscal-year-aware (Apr–Mar), per-therapist Bill / BM Share / TDS / Post-Tax / HV / unique patients + total, CSV export.

### Data & Offline
- **Offline-first** — all entry works offline; changes queue in an outbox and sync when a connection returns. Invoice issuance is deliberately online-only (gap-free numbers need the server counter).
- **Historical import** (Setup → Import historical visits) — one-time import of pre-go-live visits from the clinic's Excel ledger: matches/creates patients by MRNO, parses freeform service names into catalog items and package sessions, and flags anything it can't confidently resolve for manual review before committing.

### Analytics & Dashboard
- **Dashboard** — rolling last-6-months view: Post-Tax BM revenue trend, therapist-vs-therapist comparison, open packages sorted by days since last visit (flagged stale past 14 days), outstanding invoices summary. Charts are hand-built SVG (no charting dependency), colored from validated categorical palette.

## Clinical documentation

- **Consultation notes** — a structured clinical note per patient
  (draft/completed/archived, authorized session count), intentionally
  decoupled from invoice/visit financial columns so a therapist can finish
  documentation after a visit is billed and frozen.
- **Consent ledger** — DPDP (2023)-grade, versioned, append-only grant/
  withdraw log for patients and therapists across three consent types
  (data privacy, treatment, professional engagement). Withdrawal is always
  a new row, never an edit to the original grant; templates are versioned
  so historical consents stay auditable after wording changes.
- **AI generation log** — any AI-generated clinical impression is logged
  verbatim (model name + raw output) before a human reviews and signs off
  on the note it informed. Deliberately online-only: never added to the
  offline sync set, so it can't be created while offline and never
  appears in the local activity feed.

## Architecture

```
src/domain/            pure business logic (money, splits, fiscal year) — no framework imports, unit-tested
src/repositories/      data-access interfaces + Dexie implementations (UI reads/writes local only)
src/sync/              outbox push / delta pull engine against Supabase
src/services/          visit/invoice/report/patient/dashboard orchestration — no React imports
src/features/          UI pages and components (React + TanStack Router)
  ├── workspace/       WorkspacePage (default landing: Today, Recent, Open Packages, Pending Work)
  ├── visits/          ArchivePage (historical records: Visits/Patients tabs with filters)
  ├── patients/        Patient profiles and list views
  ├── invoices/        Invoice management
  ├── insights/        Reports and analytics
  └── setup/           Clinic configuration
supabase/              SQL migrations (schema, RLS, RPCs), seed
```

**App Routes:**
- `/workspace` (default, `/` redirects here) — today's work, recent history, open packages, pending items
- `/archive` — historical visit records and patient search with enriched columns
- `/patients/$patientId` — individual patient profile
- `/invoices` — invoice management and payment tracking
- `/insights` — reports and revenue analytics
- `/setup` — clinic configuration, MRNO settings, billing mode, rate setup

Business logic never imports Supabase or Dexie — swapping the backend means
reimplementing the repository interfaces, nothing above them.

## Status

**Phase 1: Complete ✅** Merged to main and deployed.

### Phase 1 Deliverables (LIVE)

**WorkspacePage (New Default Landing)**
- `/` now redirects to `/workspace` as the primary entry point
- **Today section** — visits entered today with payment state chips (Paid / Collect ₹X / ₹0 session), organized as table rows
- **Recent section** — rolling 7/15/30 day windows with same column structure as Today, excludes today's visits for continuous timeline
- **Open Packages** — active treatment packages with stale indicators (14+ days since last visit)
- **Pending Work feed** — unresolved items (stale packages, outstanding invoices, incomplete notes) with "Mark paid" actions for quick invoice payment recording
- **Stat strip** — Today's visits count, collected today, new patients this month, packages this month

**Archive Page (`/archive`)**
- Renamed from Visits page, serves as historical records hub
- **Records toggle** — Visits tab (all-time visit history with dense table) and Patients tab (enriched patient list)
- **Visits tab columns** — Date, Patient ID, Name, Service, Package, Bill, Invoice Status, Therapist, actions
- **Patients tab columns** — Patient ID, Name (age/sex inline), Primary Condition, Last Visit + Count, Therapist, Treatment, Bill, Phone, Package/Outstanding badge, actions
- **Filters** — Therapist dropdown, date presets (This week, This month, Last month, All time), patient search (MRNO prefix + name substring)
- **Actions** — Invoice, Repeat, Split, Delete on individual rows

**Services Layer** (`dashboardService.ts`)
- `todayWorklist(clinicId)` — today's visits with derived payment states (paid/outstanding/uninvoiced/zero_session)
- `pendingWork(clinicId)` — aggregated unresolved items (stale packages, outstanding invoice totals, incomplete notes)
- `recentVisitsWindow(clinicId, days)` — rolling window query excluding today
- `openPackages(clinicId)` — active packages with days-since-last-visit calculation
- `weeklySummary(clinicId)` — weekly visit counts and collected revenue

**Auth & Account**
- Sign-up flow with email confirmation messaging on LoginPage
- User email displayed in header
- Clinic creation simplified for new users

**Database Fix**
- Migration `20260713000002_fix_clinic_creation_rls.sql` resolves clinic creation RLS error
- `add_creator_as_admin()` trigger now SECURITY DEFINER to bypass RLS during clinic founder onboarding
- Multi-tenant isolation verified: no patient data leaks between clinics

---

### Phase 2: Planning Complete

Three options documented in `PHASE_2_PLAN.md`:
- **Option A (Recommended):** Add visit history table to PatientProfilePage (low effort, high impact)
- **Option B:** Create dedicated PatientHistoryPage (medium effort, very high impact)
- **Option C:** Enhance Patients list columns in Archive (low effort, medium impact)

Awaiting user decision before Phase 2 implementation begins.

---

All original features remain: offline-first sync, revenue split tracking, invoice issuance, monthly reports, historical import, payment status, dashboard analytics, clinical documentation (consultation notes, consent ledger, AI generation log).

## One-time setup

1. Create a Supabase project (free tier is fine).
2. Apply the migrations, in filename order: paste each file in
   `supabase/migrations/` into the SQL editor (or `supabase db push` with the
   CLI), then run `supabase/seed.sql`. For an already-live project, only the
   migration file(s) not yet applied need to be run.
3. Create the two auth users (Authentication → Users → Add user), then run
   `supabase/setup_members.sql` with their real emails to grant clinic access.
4. `cp .env.example .env` and fill in the project URL + anon key
   (Project Settings → API).
5. `npm install && npm run dev`

## Development

| Command             | What                          |
| ------------------- | ----------------------------- |
| `npm run dev`       | dev server on :5173           |
| `npm test`          | unit tests (domain + services) |
| `npm run typecheck` | strict TS                     |
| `npm run lint`      | eslint                        |
| `npm run build`     | production build              |
| `npm run e2e`       | Playwright smoke              |

## Security & data notes

- Every table carries `clinic_id`; RLS restricts all access to clinic members.
  Patient data is health data — there is no anonymous read path.
- Issued invoices and their visits are frozen by DB triggers; corrections are
  a future amendment/credit-note feature, not edits.
- Rate/tax changes in Setup apply to new visits only; history keeps the rates
  it was billed under.
- Export monthly CSVs — this app should never be the only copy of financial
  records.
