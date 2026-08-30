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

- One clinic boolean, same pattern as `clinicalDocsEnabled` (name: `enablePatientComms`), **default `false`**.
- Off = no Requests nav, no visit “Ask for feedback”, no public booking form advertised in Settings. Public token routes should still 404/disabled if the clinic flag is off.
- Turning the module **off** after appointments/requests already exist does not delete data — it just hides the nav/public routes. Pending tokens/requests are frozen (inaccessible, not auto-cancelled) until re-enabled.
- Do **not** split into separately gated sub-modules in v1.

### Sending messages

- **Default (every clinic):** Copy link + **Share via WhatsApp** (`wa.me` / share sheet) using the **staff member’s own** WhatsApp. No Meta credentials.
- **Optional later:** WhatsApp Business Cloud API one-click send if credentials exist.
- Both can coexist; never make Business API required for v1.
- Honor a patient **do-not-message** flag on every send path once that field exists.
- **Opt-out mechanism (v1):** a manual staff-settable toggle on the patient profile. No automated "reply STOP" detection — sends go through `wa.me`/share, not a webhook-backed API, so there's no inbound channel to parse a reply from in v1.

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

**Offline reads:** data already synced to Dexie (confirmed appointments, feedback responses, etc.) renders offline like any other clinic data. Only the online-only *actions* in the table above (confirm, reschedule, send) are disabled/greyed while offline — viewing is not gated on a connection.

**Message delivery status:** real delivery/read tracking is only possible for clinics on the Phase 9 WhatsApp Business Cloud API path (Meta's webhooks report it). The default `wa.me`/copy-link path used everywhere else has no delivery signal to track — Thera.Net never sees whether staff actually hit send. Don't build a `message_status` field expecting live data outside the Business API path.

### Tokens vs public booking URL

- **Feedback:** 256-bit random token, URL-safe base64 (crypto-secure RNG — not `Math.random`), **one-time consume** on submit, expiry 21 days. One **pending request per visit**; resend rotates/replaces token, does not stack rows.
- **Rate limiting:** the public token-validation RPC must throttle by IP on invalid/failed-lookup attempts (e.g. a short-window cap on wrong-token guesses) — 256-bit entropy makes brute force infeasible at scale, but the endpoint shouldn't be free to hammer regardless.
- **Public booking:** stable clinic **slug** (`/book/$clinicSlug`), not a secret token. It will live on Google/website.

### Feedback UX (v1)

- Stars 1–5 + optional comment. No sub-ratings, no auto-complaint, no Kanban.
- Thank-you page: if 4–5★ and clinic has `googleReviewUrl`, show “Leave a Google review”. Staff also get **Ask for a Google review** on 4–5★ responses.
- **1–3★:** no Google button.

### Booking UX (v1, no slots)

- Public form: name, phone, optional therapist, **preferred day/time as text**.
- Submit → `appointment_requests` `pending`.
- **Confirm does NOT resolve patient identity and does NOT create a visit or a patient.** Confirming just creates an `appointments` row carrying the raw submitted name/phone/preferred_therapist_id/scheduled time — `patient_id` stays **null** at this point. There is no confirm-time typeahead/search-or-create step.
- Confirm sends a **WhatsApp confirmation to the patient**, and **if a therapist was chosen, that therapist also gets a confirmation/reminder** (not just an in-app Workspace note — an actual message, same send path as everything else).
- Patient identity is resolved exactly once, later, at arrival (see below) — reusing the existing New visit typeahead. This avoids a confirm-time "does this name/phone match an existing patient" judgment call staff would otherwise have to make from a raw public submission.

### Appointments vs visits vs Expected today

**Appointment = confirmed expected attendance.** It is not a billed visit, and it does not need a resolved patient identity until arrival.

```
request (pending)
  → declined
  → confirmed → appointment (patient_id still null)
appointment
  → rescheduled (same row; bump scheduled datetime; keep previous on the row or audit fields)
  → no-show
  → cancelled (clinic/patient cancelled before the slot)
  → arrived (patient_id resolved here)
```

**Arrived is an explicit status, reachable two ways — not inferred from `visitId` alone:**
1. **Via New visit from the appointment list**: staff open the appointment and hit "create visit" (same patient search-or-create typeahead as any walk-in New visit, **pre-filled with the appointment's submitted name/phone as the starting query** — candidates surface, but staff must still explicitly pick or create; never auto-selected). This resolves `patient_id`, creates the `visits` row, sets `appointment.visitId`, and flips status to `arrived` — one action, one step.
2. **Manual toggle**: staff can mark an appointment `arrived` on its own (patient is physically present/waiting) without creating the visit yet — the visit gets logged afterward, same as any walk-in today. `patient_id` stays null until whichever path resolves it.

- **Expected today, once `enablePatientComms` is on, is powered by `appointments` — full stop.** No dual system, no "extend the old list" option: `appointments` *is* the day list for comms-enabled clinics. Do **not** create a second “Appointments” strip on Workspace alongside it.
- **Do not auto-create a `visits` row on confirm.** Front desk logs the visit when the patient is seen (identity resolution happens then, not at confirm).
- **No-show** does not create a visit or a bill.
- **Decline** = request never became an appointment. **Cancel** = appointment existed, then called off. **No-show** = they didn’t come.

**Reschedule:** mutate **one** appointment row (`scheduledAt` + `rescheduleCount` + previous datetime). Online-only RPC. Share new time via WhatsApp.

### Where staff see things

| Question | Answer |
|----------|--------|
| Where is **all** feedback? | **Requests → Feedback** (admin only) |
| Daily “something arrived”? | Workspace **Needs attention** (pending request, new rating) + **See all** → Requests |
| This patient / this visit? | Patient profile block + visit-row action |
| Trends / Reports (`/insights`)? | **No triage list.** Later: optional **summary card** on Reports; charts live on Requests → Analytics |

### Navigation (do not add a sixth phone tab in v1)

Today’s primary nav (Workspace, Ledger, Patients, Reports, Settings) stays five items on the **phone bottom bar**.

- **Route exists from day one:** `/requests?tab=bookings|feedback` (later `|analytics`).
- **Desktop header:** when module on, show **Requests** for roles who can open it (front desk + admin).
- **Phone:** Requests is **not** a 6th tab. Entry: Workspace Needs attention → See all. (Promote to a tab only when analytics is a real daily destination.)
- **Do not** bury Requests under Ledger (`?tab=` on money).
- **Do not** put the feedback queue inside `/insights`.

### Roles

| | Admin | Front desk | Therapist |
|--|--------|------------|-----------|
| Settings (flag, slug, Google URL, templates, WA, automation) | Yes | No | No |
| Requests → **Bookings** (confirm, reschedule, no-show, decline/cancel) | Yes | **Primary** | Own day’s appointments on Workspace only; **no** full request queue in v1 |
| Requests → **Feedback** (list, comments, in progress/resolved, internal notes) | **Yes only** | **No** | **No** |
| Ask for feedback / copy / WhatsApp from a **visit** | Yes | Yes | **Own visits** |
| Google review send (4–5★) on visit/response | Yes | Yes | Optional; not required in v1 |
| Needs attention: new 1–3★ | Yes (full) | **No — front desk gets nothing about feedback ratings or comments (resolved)** | Own visit: “Patient rated this visit” **without comment** |
| Stale package / single-visit **Send reminder** | Yes | Yes | Only if those lists are already in their Workspace scope |

**Triage (read comments, change status, internal notes) is admin-only.** Front desk still sends links and Google nudges from the **visit**. Therapists do not moderate their own reviews. Later analytics may show a therapist **aggregate** NPS (same idea as therapist comparison), not individual complaint text.

If `front_desk` hits `/requests?tab=feedback`, hide the tab and land on Bookings.

### Copy (staff-facing)

Avoid “CareConnect”, “reputation module”, “CareConnect”.

| Internal | UI |
|----------|-----|
| Module | Settings chip: **Patient communications** |
| Bookings (tab) | **Bookings** |
| Feedback action | **Ask for feedback** |
| Page (nav item / route) | **Requests** — renamed from "Inbox" per user decision, since it holds both booking requests and feedback awaiting action |
| Google | **Ask for a Google review** |

---

## Information architecture

### Public (no Shell, no login)

| Route | Writes |
|-------|--------|
| `/book/$clinicSlug` | RPC → `appointment_requests` |
| `/f/$token` | RPC → consume token, write response |

Brand with clinic name/logo only. Mobile-first. Meet WCAG 2.1 AA basics (labels, contrast, tap-target size) — this is the one surface an unauthenticated, possibly older or less tech-comfortable patient interacts with directly. Skip i18n/localization hooks: the rest of the app has no localization infrastructure today, so scaffolding it for just this module would be inconsistent, not forward-thinking.

### Staff

```
Workspace
  Needs attention  → pending requests, new ratings (role-appropriate)
  Expected today   → confirmed appointments for today
  See all          → /requests

Visit row / New visit success
  Ask for feedback | Resend | View rating | Ask for Google review (4–5)

Patient profile
  Small communications block: last rating, open request, send reminder if segment matches

/requests?tab=bookings     front_desk + admin
/requests?tab=feedback     admin
/requests?tab=analytics    later, admin

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

- clinic, `patient_id` **nullable** (null from confirm until arrival — see "Appointments vs visits vs Expected today"), `patient_name`/`patient_phone` (raw submitted values, kept even after `patient_id` resolves, for display before resolution), therapist_id null, `scheduled_at`, status (`confirmed|rescheduled|no_show|cancelled|arrived`), `request_id` null, `visit_id` null, `reschedule_count`, `previous_scheduled_at` null  

**`appointments` is the single day-list concept — decided, not left open.** For clinics with `enablePatientComms` on, `appointments` fully replaces the old manual expected-visits list as Expected Today's data source; that legacy feature is retired for those clinics in the first booking migration, not kept alongside `appointments` as a second option. Clinics that never turn the module on keep their existing simple manual list unaffected — this decision only applies once a clinic opts into the module.

**`feedback_requests`**

- clinic, visit_id, patient_id, token, expires_at, status (`pending|responded|expired`), unique pending per visit  

**`feedback_responses`**

- request_id, rating 1–5, comment text null, created_at  

Triage fields (status `new|in_progress|resolved`, admin note) can live on the response or request — one place only.

**`message_log`** (shared audit trail — every send action across all four workflows writes here)

- clinic, kind (`feedback_request|booking_confirmation|therapist_notify|google_review|reminder_stale_package|reminder_single_visit`), recipient (patient_id or raw phone), channel (`wa_share|wa_business_api`), sent_by (staff user), sent_at

RLS: member-gated for staff tables. Public RPCs validate slug/token server-side.

---

## Implementation slices (do in this order)

Do **not** start with availability/slots.

| Slice | Ship | Notes |
|-------|------|--------|
| **0** | Flag + public `/f/$token` + RPC | Hardest security; clinic flag off → disabled |
| **1** | Visit **Ask for feedback** + share sheet | Habit; like `+ Note` |
| **2** | `/requests?tab=feedback` admin + Workspace “new rating” | Close the loop |
| **3** | Google review on 4–5★ + thank-you CTA | Cheap |
| **4** | Send reminder on existing stale package + single-visit rows | No new detection |
| **5** | `/book/$slug`, Requests page, confirm → appointment → Expected today | No slots |
| **6** | Decline / reschedule / no-show / cancel RPCs + UI | Can land with slice 5 if small |
| **7** | Weekly availability + slot picker | **Later, separate effort** |
| **8** | Requests Analytics + optional Reports summary card | After lists are trusted |
| **9** | Cron automation + optional WA Business API | After manual paths work |

Each slice: migration in `supabase/migrations/`, Dexie table if staff-synced, RLS/RPC, update **FEATURES_AND_SCHEMA.md** (and README if user-visible) in the **same PR**.

---

## Codebase pointers (do not fight existing patterns)

- Nav: `src/app/Shell.tsx` — `NAV` array; Reports hidden from therapists; Settings admin-only. Requests visibility: module on + (admin or front_desk).  
- Permissions: `src/app/usePermissions.ts` — add explicit flags (`canTriageFeedback` = admin, `canManageBookingRequests` = admin \| front_desk). RLS is source of truth.  
- Workspace queues: `PendingWorkKind` in `src/services/dashboardService.ts` — add kinds, don’t invent a second home widget.  
- Expected today: for comms-enabled clinics, this UI is re-sourced from `appointments`, retiring the legacy `clinic.enableExpectedToday` / `expectedVisitsService` path for those clinics — booking **feeds this UI** directly, not a second thing sitting beside it.  
- Visit actions: `src/components/VisitCard.tsx` — follow **Ask for feedback** / note-link pattern (table + mobile).  
- New visit offer: `NewVisitPage` already offers add-note after save — same beat for feedback.  
- Settings chips: `SetupPage` / settings sections — new **Patient communications** chip.  
- Public routes: like `/reset-password` and `*/print`, **no Shell chrome**.  
- Online-only precedent: `issue_invoice()`, `create_clinic_with_admin()`.  
- Stale packages: Workspace / dashboard `stale`; single-visit: `dashboardService` single-visit patients — **reuse queries**.
- Edge Functions: mirror the existing single-purpose pattern (`invite-therapist`), not a monolith — e.g. one function for anonymous public writes (token/slug validation), a separate one for outbound sends (WhatsApp Business API, when built in slice 9).

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

- (Nothing currently open — see resolved list below.)

Resolved, no longer open:
- ~~Dual `expected_visits` vs `appointments`~~ — **`appointments` is the single source, decided.** For comms-enabled clinics, `appointments` fully replaces the legacy manual expected-visits list as Expected Today's data source in the first booking migration; no "extend the old list" option remains on the table. Clinics that never enable the module are unaffected.
- ~~Exact token entropy/expiry~~ — **256-bit random, URL-safe base64, 21-day expiry, rate-limited by IP on the validation RPC.**
- ~~Whether front_desk sees a Needs-attention chip for 1–3★ without comment~~ — **No.** Front desk gets zero visibility into feedback ratings/comments, anywhere, full stop. They can still trigger "Ask for feedback" from a visit; they just never see what comes back.
- ~~`arrived` vs inferring arrival only from `visitId` set~~ — **`arrived` is an explicit status**, set either automatically (staff create the visit from the appointment list, which resolves patient identity via the New visit typeahead in the same step) or manually (patient is present, visit logged afterward). `patient_id` on `appointments` is null from confirm through to whichever of those two paths resolves it — confirm itself never touches patient identity.

---

## Success criteria (v1 without slots)

- Clinic can turn the module on in Settings.  
- Staff share a feedback link from a visit; patient submits without an account; admin sees it under Requests → Feedback and can resolve.  
- 4–5★ can be nudged to Google.  
- Stale / single-visit rows can send a templated WhatsApp share.  
- Public booking creates a pending request; front desk confirms to an appointment on Expected today; they can reschedule, mark no-show, or decline; logging a visit remains New visit.  
- Therapists never see the full complaint queue.  
- Phone nav still has five tabs.

When implementation starts, treat this file as the spec; update FEATURES_AND_SCHEMA in the same PR as the first shipped slice.
