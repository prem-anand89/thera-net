# Handoff: patient communications (booking + feedback)

**For:** implementation (Claude or any agent)  
**Status:** discovery locked; **no implementation started**. Do not invent product decisions that contradict this file — ask if something is missing.  
**Source:** CareConnect (`prem-anand89/feedback-management-tool`) is a **concept/UI reference only**. Rebuild natively in Thera.Net (React/TS/Tailwind, Supabase Postgres/RLS, Dexie outbox). Do not integrate Convex, Clerk, or CareConnect’s WhatsApp backend.

Related reading in this repo: `README.md` (nav, roles, Workspace), `FEATURES_AND_SCHEMA.md` (schema + patterns), `src/app/Shell.tsx` (five primary nav items), `src/app/usePermissions.ts`, Workspace **Needs attention** + **Expected today**.

---

## What this is

Four CareConnect *workflows* sharing plumbing (tokenized/public links, WhatsApp share, clinic toggle). In Thera.Net they are **one optional module**, not four products, and **not** a CareConnect clone in the nav.

| Workflow | v1 |
|----------|----|
| A. Patient booking requests | Yes — **no slot picker** |
| B. Feedback capture + triage | Yes — stars + comment; **no** happy/unhappy branching |
| C. Google review nudge | Yes — 4–5★ only |
| D. Re-engagement reminders | Yes — actions on **existing** stale-package and single-visit lists |

**Slot picker / weekly availability / conflict checking: later build. Do not start here.**

---

## Locked product decisions

### Module gate

- One clinic boolean, same pattern as `enableExpectedToday` / `clinicalDocsEnabled` (name suggestion: `enablePatientComms`).
- Off = no Inbox nav, no visit “Ask for feedback”, no public booking form advertised in Settings. Public token routes should still 404/disabled if the clinic flag is off.
- Do **not** split into separately gated sub-modules in v1.

### Sending messages

- **Default (every clinic):** Copy link + **Share via WhatsApp** (`wa.me` / share sheet) using the **staff member’s own** WhatsApp. No Meta credentials.
- **Optional later:** WhatsApp Business Cloud API one-click send if credentials exist.
- Both can coexist; never make Business API required for v1.
- Honor a patient **do-not-message** flag on every send path once that field exists.

### Automation

- Safe default: **manual only**.
- Per-workflow opt-in automation is a Settings toggle, not hardcoded.
- “N hours after visit” **requires a server job** (e.g. Supabase cron). The SPA must not be the scheduler. **v1 can ship manual-only** and leave cron for a later slice.

### Sync / writes

| Write | Mode | Why |
|-------|------|-----|
| Public booking submit, public feedback submit | **Online-only RPC** | Patient has no Dexie/outbox |
| Confirm / decline request; reschedule; no-show; cancel appointment | **Online-only RPC** | Concurrency / no double-book later |
| Create feedback request, triage status, templates, settings | **Dexie + outbox** | Same as rest of clinic CRUD |
| Reminder / Google-review / confirmation **send** | **Online-only** | Immediate side effect |

Public/anonymous writes need a **narrow SECURITY DEFINER RPC** (or token-scoped RLS), separate from `is_clinic_member`. Print-style: those routes render **without Shell** (no login, no bottom nav).

### Tokens vs public booking URL

- **Feedback:** unguessable random token, **one-time consume** on submit, expiry unused (suggest 21 days). One **pending request per visit**; resend rotates/replaces token, does not stack rows.
- **Public booking:** stable clinic **slug** (`/book/$clinicSlug`), not a secret token. It will live on Google/website.

### Feedback UX (v1)

- Stars 1–5 + optional comment. No sub-ratings, no auto-complaint, no Kanban.
- Thank-you page: if 4–5★ and clinic has `googleReviewUrl`, show “Leave a Google review”. Staff also get **Ask for a Google review** on 4–5★ responses.
- **1–3★:** no Google button.

### Booking UX (v1, no slots)

- Public form: name, phone, optional therapist, **preferred day/time as text**.
- Submit → `appointment_requests` `pending`.
- Staff confirm: **search existing patient or create** (same typeahead as New visit). **No silent match-by-phone.**
- Confirm creates an **appointment** (not a visit) and marks the request confirmed.
- Patient WhatsApp confirmation via share sheet; if a therapist was chosen, that therapist should be notified in-app (Workspace) — not a new notification product in v1.

### Appointments vs visits vs Expected today

**Appointment = confirmed expected attendance.** It is not a billed visit.

```
request (pending)
  → declined
  → confirmed → appointment
appointment
  → rescheduled (same row; bump scheduled datetime; keep previous on the row or audit fields)
  → no-show
  → cancelled (clinic/patient cancelled before the slot)
  → arrived → staff logs a visit via existing New visit; set appointment.visitId
```

- **Expected today** must show **confirmed appointments** for that date (this is the grown-up version of today’s optional Expected today list). Do **not** create a second “Appointments” strip on Workspace.
- **Do not auto-create a `visits` row on confirm.** Front desk logs the visit when the patient is seen.
- **No-show** does not create a visit or a bill.
- **Decline** = request never became an appointment. **Cancel** = appointment existed, then called off. **No-show** = they didn’t come.

**Reschedule:** mutate **one** appointment row (`scheduledAt` + `rescheduleCount` + previous datetime). Online-only RPC. Share new time via WhatsApp.

### Where staff see things

| Question | Answer |
|----------|--------|
| Where is **all** feedback? | **Inbox → Feedback** (admin only) |
| Daily “something arrived”? | Workspace **Needs attention** (pending request, new rating) + **See all** → Inbox |
| This patient / this visit? | Patient profile block + visit-row action |
| Trends / Reports (`/insights`)? | **No triage list.** Later: optional **summary card** on Reports; charts live on Inbox → Analytics |

### Navigation (do not add a sixth phone tab in v1)

Today’s primary nav (Workspace, Ledger, Patients, Reports, Settings) stays five items on the **phone bottom bar**.

- **Route exists from day one:** `/inbox?tab=requests|feedback` (later `|analytics`).
- **Desktop header:** when module on, show **Inbox** for roles who can open it (front desk + admin).
- **Phone:** Inbox is **not** a 6th tab. Entry: Workspace Needs attention → See all. (Promote to a tab only when analytics is a real daily destination.)
- **Do not** bury Inbox under Ledger (`?tab=` on money).
- **Do not** put the feedback queue inside `/insights`.

### Roles

| | Admin | Front desk | Therapist |
|--|--------|------------|-----------|
| Settings (flag, slug, Google URL, templates, WA, automation) | Yes | No | No |
| Inbox → **Requests** (confirm, reschedule, no-show, decline/cancel) | Yes | **Primary** | Own day’s appointments on Workspace only; **no** full request queue in v1 |
| Inbox → **Feedback** (list, comments, in progress/resolved, internal notes) | **Yes only** | **No** | **No** |
| Ask for feedback / copy / WhatsApp from a **visit** | Yes | Yes | **Own visits** |
| Google review send (4–5★) on visit/response | Yes | Yes | Optional; not required in v1 |
| Needs attention: new 1–3★ | Yes (full) | Optional: “New rating — admin” **without comment body** | Own visit: “Patient rated this visit” **without comment** |
| Stale package / single-visit **Send reminder** | Yes | Yes | Only if those lists are already in their Workspace scope |

**Triage (read comments, change status, internal notes) is admin-only.** Front desk still sends links and Google nudges from the **visit**. Therapists do not moderate their own reviews. Later analytics may show a therapist **aggregate** NPS (same idea as therapist comparison), not individual complaint text.

If `front_desk` hits `/inbox?tab=feedback`, hide the tab and land on Requests.

### Copy (staff-facing)

Avoid “CareConnect”, “reputation module”, “CareConnect”.

| Internal | UI |
|----------|-----|
| Module | Settings chip: **Patient communications** |
| Requests | **Booking requests** |
| Feedback action | **Ask for feedback** |
| Page | **Inbox** |
| Google | **Ask for a Google review** |

---

## Information architecture

### Public (no Shell, no login)

| Route | Writes |
|-------|--------|
| `/book/$clinicSlug` | RPC → `appointment_requests` |
| `/f/$token` | RPC → consume token, write response |

Brand with clinic name/logo only. Mobile-first.

### Staff

```
Workspace
  Needs attention  → pending requests, new ratings (role-appropriate)
  Expected today   → confirmed appointments for today
  See all          → /inbox

Visit row / New visit success
  Ask for feedback | Resend | View rating | Ask for Google review (4–5)

Patient profile
  Small communications block: last rating, open request, send reminder if segment matches

/inbox?tab=requests     front_desk + admin
/inbox?tab=feedback     admin
/inbox?tab=analytics    later, admin

Settings → Patient communications   admin
```

### Settings section (one chip, not scattered)

1. Master on/off  
2. Public booking slug + copy booking link (slot picker **off / hidden** until later)  
3. Google review URL  
4. Templates: feedback invite, Google review, stale package, single-visit (`{patientName}`, `{clinicName}`, `{link}`)  
5. WhatsApp: staff share only (v1); Business API fields later  
6. Automation: all off in v1  

---

## Suggested schema (v1 sketch — refine in migration)

Not an implementation. Align names with existing `snake_case` + RLS clinic isolation.

**Clinic**

- `enable_patient_comms` boolean default false  
- `google_review_url` text null  
- `booking_slug` unique text null  
- Template columns or a small `message_templates` table keyed by clinic + `kind`

**Patients**

- `do_not_message` boolean default false  

**`appointment_requests`**

- clinic, name, phone, preferred_therapist_id null, preferred_time_text, status (`pending|confirmed|declined`), `appointment_id` null, timestamps  

**`appointments`**

- clinic, patient_id, therapist_id null, `scheduled_at`, status (`confirmed|rescheduled|no_show|cancelled|arrived`), `request_id` null, `visit_id` null, `reschedule_count`, `previous_scheduled_at` null  

Do **not** introduce a parallel table that duplicates `expected_visits` for the same day list. Either **extend `expected_visits`** to be this appointment, or **replace Expected today data source** with `appointments` and migrate/drop the manual expected list. Pick one in the first booking migration — dual lists are not acceptable.

**`feedback_requests`**

- clinic, visit_id, patient_id, token, expires_at, status (`pending|responded|expired`), unique pending per visit  

**`feedback_responses`**

- request_id, rating 1–5, comment text null, created_at  

Triage fields (status `new|in_progress|resolved`, admin note) can live on the response or request — one place only.

RLS: member-gated for staff tables. Public RPCs validate slug/token server-side.

---

## Implementation slices (do in this order)

Do **not** start with availability/slots.

| Slice | Ship | Notes |
|-------|------|--------|
| **0** | Flag + public `/f/$token` + RPC | Hardest security; clinic flag off → disabled |
| **1** | Visit **Ask for feedback** + share sheet | Habit; like `+ Note` |
| **2** | `/inbox?tab=feedback` admin + Workspace “new rating” | Close the loop |
| **3** | Google review on 4–5★ + thank-you CTA | Cheap |
| **4** | Send reminder on existing stale package + single-visit rows | No new detection |
| **5** | `/book/$slug`, Requests inbox, confirm → appointment → Expected today | No slots |
| **6** | Decline / reschedule / no-show / cancel RPCs + UI | Can land with slice 5 if small |
| **7** | Weekly availability + slot picker | **Later, separate effort** |
| **8** | Inbox Analytics + optional Reports summary card | After lists are trusted |
| **9** | Cron automation + optional WA Business API | After manual paths work |

Each slice: migration in `supabase/migrations/`, Dexie table if staff-synced, RLS/RPC, update **FEATURES_AND_SCHEMA.md** (and README if user-visible) in the **same PR**.

---

## Codebase pointers (do not fight existing patterns)

- Nav: `src/app/Shell.tsx` — `NAV` array; Reports hidden from therapists; Settings admin-only. Inbox visibility: module on + (admin or front_desk).  
- Permissions: `src/app/usePermissions.ts` — add explicit flags (`canTriageFeedback` = admin, `canManageBookingRequests` = admin \| front_desk). RLS is source of truth.  
- Workspace queues: `PendingWorkKind` in `src/services/dashboardService.ts` — add kinds, don’t invent a second home widget.  
- Expected today: `clinic.enableExpectedToday` + `expectedVisitsService` — booking should **feed this UI**, not sit beside it unused.  
- Visit actions: `src/components/VisitCard.tsx` — follow **Ask for feedback** / note-link pattern (table + mobile).  
- New visit offer: `NewVisitPage` already offers add-note after save — same beat for feedback.  
- Settings chips: `SetupPage` / settings sections — new **Patient communications** chip.  
- Public routes: like `/reset-password` and `*/print`, **no Shell chrome**.  
- Online-only precedent: `issue_invoice()`, `create_clinic_with_admin()`.  
- Stale packages: Workspace / dashboard `stale`; single-visit: `dashboardService` single-visit patients — **reuse queries**.

---

## Explicitly out of scope (v1)

- CareConnect Convex/Clerk/WhatsApp Business as a dependency  
- Slot picker, weekly availability matrix, conflict engine  
- Kanban, embeddable widget, NPS dashboards (until slice 8)  
- Happy/unhappy branching / auto-complaints  
- Silent find-or-create patient by phone  
- Auto-creating visits from appointments  
- Sixth mobile bottom-nav item  
- Feedback list inside Reports  
- Therapist or front_desk **triage** of rating comments  
- Notification service / push / email inbox (Workspace counts only)

---

## Still ask the user if you hit these

Already locked above; only reopen if implementation forces a fork:

- Dual `expected_visits` vs `appointments` — **must pick one source for Expected today** in slice 5.  
- Exact token entropy/expiry.  
- Whether front_desk sees a Needs-attention chip for 1–3★ without comment (recommended: yes, no body).  
- `arrived` vs inferring arrival only from `visitId` set.

---

## Success criteria (v1 without slots)

- Clinic can turn the module on in Settings.  
- Staff share a feedback link from a visit; patient submits without an account; admin sees it under Inbox → Feedback and can resolve.  
- 4–5★ can be nudged to Google.  
- Stale / single-visit rows can send a templated WhatsApp share.  
- Public booking creates a pending request; front desk confirms to an appointment on Expected today; they can reschedule, mark no-show, or decline; logging a visit remains New visit.  
- Therapists never see the full complaint queue.  
- Phone nav still has five tabs.

When implementation starts, treat this file as the spec; update FEATURES_AND_SCHEMA in the same PR as the first shipped slice.
