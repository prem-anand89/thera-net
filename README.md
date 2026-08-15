# Thera.Net — Patient Visit Ledger & Revenue Tracking

Offline-first visit ledger, revenue-split tracker, and invoice book for
physiotherapy clinics operating inside a partner hospital. Structured for
multi-clinic operations from day one, with configurable revenue-split models
(simple or hospital partnership).

**Stack:** React + Vite + TypeScript · Supabase (Postgres/Auth/Realtime/Storage)
· Dexie (IndexedDB) local-first store with outbox sync · Tailwind CSS.

**Current scope:** the visit ledger (visits, invoices, reports, dashboard),
revenue tracking, multi-clinic isolation, and Core Assessment (clinical
consultation notes with comprehensive pain profiling, functional status tracking,
and objective neurological examination). Additional assessment modules (FaCE Scale,
Facial Palsy, and others) can be added as Region Modules within the Core Assessment
framework.

## What it does

### Visit Management & Ledger
- **Visit entry & patient lookup** — search by MRNO/name (create-if-missing, walk-in MRNO auto-generation), visit entry with catalog price autofill, price override with mandatory adjustment reason, package session tracking (1/3, 2/3 … with ₹0 continuations).
- **Today-first workspace** — default landing page showing today's visits with payment state at a glance (Paid / Collect ₹X / ₹0 session), open packages with stale flags, pending work (outstanding invoices, incomplete notes), and recent visits in a rolling 7/15/30 day window.
- **Ledger** — full visit history with dense table, patient enrichment (last visit + count, treatment, condition, bill amount), therapist filter, date range search, bulk actions (invoice, repeat, split, delete). Visits/Invoices/Reports sub-tabs are URL-addressable (`/ledger?tab=invoices`); the Invoices sub-tab only appears for clinics with billing access.

### Clinical Assessment & Notes
- **Core Assessment (Initial/Follow-up)** — comprehensive consultation notes with automatic episode-of-care tracking via patient enrollments. Follow-up notes collapse read-only carry-forward sections (medical history, screening) while narrowing objective examination to new findings.
- **Chief Complaint & History** — anatomical region selection (9 regions: Cervical/Thoracic/Lumbar Spine, Shoulder, Elbow, Wrist/Hand, Hip, Knee, Ankle/Foot), onset/mechanism/episode pattern timeline, occupation/activity context, trauma & surgical history with structured dates, and secondary complaints array.
- **Pain Profiling** — NRS current/best/worst (3-point scale tracking), pain pattern (constant/intermittent/night-only/morning stiffness), sleep disturbance, aggravating/easing factors. Previous pain history section for tracking historical episodes.
- **Functional Status (PSFS)** — up to 5 activities with baseline (locked on first save, carryable to follow-ups) and current function scores, MCID crossing counter.
- **Body Chart** — interactive tap-to-mark front/back/left-lateral outline with 4 mark types (pain/numbness/stiffness/referred), responsive canvas layout.
- **Objective Examination** — region-driven ROM movements (quick spine preset table for cervical/thoracic/lumbar with flexion/extension/lateral flexion/rotation), manual muscle testing with nerve-root tags (derived read-only myotome display), 4-state neurological screening (dermatomes/myotomes, T1/L2/L3/S2 extended levels), red/yellow flag tri-state screening banner with collapsible detail.
- **Treatment & HEP** — load management block (weight-bearing %, PWB %, brace, ROM limits), structured interventions with session duration quick-pick, HEP exercise rows with sets/reps/frequency, plan & goals with target timeframe (short/long-term).
- **Outcome Tracking** — direction-aware outcome cards per instrument (NRS: ▼ Improving for lower scores, PSFS: ▲ Improving for higher scores) comparing against most recent prior note in same episode.

### Revenue & Invoicing
- **Revenue split** — per visit, computed at billing time and stored with the rate snapshot: BM Share (75%), Post-Tax (90% of share), TDS (configurable basis: % of gross bill or % of BM share), HV share. Rounding: half-up to the rupee, once per visit — rollups reconcile by construction.
- **Invoices** — server-issued, gap-free sequential numbers per clinic per FY (`BM/26-27/0001`), immutable once issued (DB triggers), printable A4/A5 with clinic letterhead + optional partner-hospital branding.
- **Payment status & HV settlement** — a three-fact payment model (Billed / Collected / Receipted) distinguishes cash collected without a receipt from an issued-but-unpaid invoice, so neither reads as the other; quick "Mark paid" action from Workspace pending feed. Monthly report shows HV settlement card for variance tracking.
- **Billing access control** — clinics can restrict who is allowed to issue invoices ("everyone" vs. "billing staff only"), enforced server-side inside `issue_invoice()`, not just hidden in the UI.
- **Monthly report** — fiscal-year-aware (Apr–Mar), per-therapist Bill / BM Share / TDS / Post-Tax / HV / unique patients + total, CSV export.

### Data & Offline
- **Offline-first** — all entry works offline; changes queue in an outbox and sync when a connection returns. Invoice issuance is deliberately online-only (gap-free numbers need the server counter).
- **Historical import** (Setup → Import historical visits) — one-time import of pre-go-live visits from the clinic's Excel ledger: matches/creates patients by MRNO, parses freeform service names into catalog items and package sessions, and flags anything it can't confidently resolve for manual review before committing.

### Analytics & Dashboard
- **Dashboard** — rolling last-6-months view: Post-Tax BM revenue trend, open packages sorted by days since last visit (flagged stale past 14 days), outstanding invoices summary. Charts are hand-built SVG (no charting dependency), colored from validated categorical palette.
- **Therapist comparison** — opt-in chart (off by default; an admin enables it in Settings → Features) showing revenue and visit-count side-by-side per therapist. Visible to therapists too, not just admins — the deliberate exception to "financial aggregates are admin-only."

## Architecture

```
src/domain/            pure business logic (money, splits, fiscal year, clinical assessments) — no framework imports, unit-tested
src/repositories/      data-access interfaces + Dexie implementations (UI reads/writes local only)
src/sync/              outbox push / delta pull engine against Supabase
src/services/          visit/invoice/report/patient/dashboard/consultation-note orchestration — no React imports
src/features/          UI pages and components (React + TanStack Router)
  ├── workspace/       WorkspacePage (default landing: Today, Recent, Open Packages, Pending Work)
  ├── visits/          VisitsPage, served at /ledger (Visits/Invoices/Reports sub-tabs, URL-addressable)
  ├── patients/        PatientProfilePage with clinical notes, visit history
  ├── insights/        Reports and analytics, served at /insights (nav label is "Reports")
  ├── setup/           SetupPage, served at /settings (clinic configuration; nav label is "Settings")
  └── patients/notes/  NoteEditorPage (Core Assessment: Initial/Follow-up consultation notes)
src/components/        Shared UI components (BodyChart, ScaleWidget, TreatmentNote, ColumnsPicker, etc.)
supabase/              SQL migrations (schema, RLS, RPCs, realtime publications), seed
```

**App Routes:**
- `/workspace` (default, `/` redirects here) — today's work, recent history, open packages, pending items
- `/ledger` — historical visit records, invoices, and reports as URL-addressable sub-tabs (`?tab=visits|invoices|reports`); the Invoices tab is hidden without billing access
- `/patients/$patientId` — individual patient profile with clinical notes history
- `/patients/$patientId/notes/$noteId` — Core Assessment note editor (Initial/Follow-up consultation notes)
- `/insights` — reports and revenue analytics (nav label: "Reports")
- `/settings` — clinic configuration, MRNO settings, billing mode, rate setup, feature toggles (nav label: "Settings")
- `/archive`, `/setup`, `/invoices`, `/reports` — legacy paths, kept as redirects to the routes above for old bookmarks

Business logic never imports Supabase or Dexie — swapping the backend means
reimplementing the repository interfaces, nothing above them.

## Roles & permissions

Three roles per clinic membership, enforced server-side via Postgres RLS
(not just hidden in the UI):

- **admin** — full read/write on everything in the clinic: roster, service
  catalog, all therapists' visits, billing settings, feature toggles.
- **therapist** — clinic-wide reads, but writes (edit/delete) are scoped to
  their own visits and notes only. Cannot touch the roster or service
  catalog pricing.
- **front_desk** — reads and visit/invoice entry, no clinical-notes access,
  no roster/catalog writes. Excluded from clinical dashboards (e.g. the
  therapist comparison chart) since they have no clinical work to compare.

`useWorkspaceScope()` / `usePermissions()` centralize these checks
client-side for UI framing; the RLS policies and `SECURITY DEFINER` RPCs
in `supabase/migrations/` are the actual enforcement boundary.

Two clinic-level toggles (Settings → Features/Billing) layer on top of the
role model: **billing access** (`billingEnabled` + who's allowed to issue
invoices — everyone or billing staff only) and **therapist comparison**
(off by default; widens the dashboard's revenue/visit charts to
therapists, not just admins).

## Status

**Phase 1 (Ledger & Revenue): Complete ✅** Merged to main and deployed.
**Phase 2 (Core Assessment): Complete ✅** Merged to main and deployed.
**Phase 3 (Role model, billing access & nav overhaul): Complete ✅** See below.

### Phase 1 Deliverables (LIVE)

**WorkspacePage (New Default Landing)**
- `/` now redirects to `/workspace` as the primary entry point
- **Today section** — visits entered today with payment state chips (Paid / Collect ₹X / ₹0 session), organized as table rows
- **Recent section** — rolling 7/15/30 day windows with same column structure as Today, excludes today's visits for continuous timeline
- **Open Packages** — active treatment packages with stale indicators (14+ days since last visit)
- **Pending Work feed** — unresolved items (stale packages, outstanding invoices, incomplete notes) with "Mark paid" actions for quick invoice payment recording
- **Stat strip** — Today's visits count, collected today, new patients this month, packages this month

**Archive Page (`/archive`, since renamed to Ledger at `/ledger` — see Phase 3)**
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

### Phase 2 Deliverables (LIVE)

**Core Assessment (NoteEditorPage)**
- Complete clinical consultation note builder with Initial/Follow-up modes
- Episode-of-care tracking via `patient_module_enrollments` (Supabase RLS + Dexie sync)
- Multi-section accordion layout: Chief Complaint, History, Subjective (Pain Profile + Body Chart), Functional Status (PSFS), Objective (Neuro/ROM/MMT), Treatment & HEP, Screening Banner
- Derived scalar columns (`nrsScore`, `psfsMean`, `redFlagCount`) extracted at save time for filtering/reporting
- Follow-up mode auto-collapses read-only carry-forward, editable only for clinical follow-up sections
- Body chart with responsive tap-to-mark canvas and 4 mark types
- NRS tracking (current/best/worst), PSFS per-activity baseline & current
- Secondary complaints array for multi-region presentations
- Previous pain history section for historical episode tracking
- Outcome cards with direction-aware trends (per-instrument polarity)
- Unit test coverage for domain logic (`computeBmi`, `computeWaistToHeightRatio`, `outcomeTrend`, `computeDerivedFields`)

**Patient Profile Integration**
- New "Clinical notes" section on patient profile drilling into note editor
- Contraindication banner for clinical safety flags

**New Visit Form Enhancements**
- Always-visible patient form fields with auto-prefill from search
- Support for pre-filling with `patientId` or `prefillName` search params
- Seamless patient selection → form population → visit creation flow

---

### Phase 3 Deliverables (LIVE)

15 PRs across two build plans (`docs/BUILD-PLAN-compiled-changes.md`,
`docs/BUILD-PLAN-role-model-and-billing.md`):

- **Server-side role enforcement** — a third role (`front_desk`) and RLS
  policies that actually scope writes (previously any clinic member could
  write any other therapist's visits/roster/pricing; see Roles &
  permissions above).
- **Nav restructure** — `/archive` → `/ledger`, `/setup` → `/settings`,
  "Insights" → "Reports" in the nav (path stays `/insights`); Ledger's
  Visits/Invoices/Reports sub-tabs became URL-addressable.
- **Payment-state correctness** — the three-fact Billed/Collected/
  Receipted model, replacing an `invoiceId`-only check that had
  independently drifted wrong in five places across the codebase.
- **Billing access control** — clinics can gate who's allowed to issue
  invoices, enforced inside the `issue_invoice()` RPC.
- **Therapist comparison chart** — opt-in dashboard chart visible to
  therapists, not just admins.
- **Responsive breakpoint fix** — a dedicated `tab:` (744px) Tailwind
  token so iPad Mini gets the tablet layout instead of the phone layout.
- Plus a New Visit rebuild, notes-completion prompting, Ledger hygiene,
  and Patients extracted to its own route. Full detail and shipped
  corrections are in the two build-plan docs.

---

### Phase 4: Future (TBD)

Candidates for future phases:
- Region Modules (FaCE Scale, Facial Palsy assessment plugins within Core Assessment framework)
- HEP exercise library & video linking
- Protocol library & phase management
- Treatment consent tracking (blocked: no data infrastructure exists)
- Advanced outcome reports (MCID aggregation, multi-patient trends)

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
