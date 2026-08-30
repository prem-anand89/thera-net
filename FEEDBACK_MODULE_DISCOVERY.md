# Discovery: patient booking + feedback + reputation + re-engagement module for Thera.Net

## Context
The user owns a separate repo, `prem-anand89/feedback-management-tool` (internally "CareConnect") — a full patient-feedback/reputation/scheduling app (React+TanStack Router, Convex, Clerk, WhatsApp Business Cloud API, Resend). The goal is to take its *concepts and UI patterns only* and build a native module inside Thera.Net (React/TS/Tailwind + Supabase Postgres/RLS + Dexie offline outbox) — not integrate or run the two apps together. **This is still discovery/requirements-gathering — no code, no schema, nothing implemented.** This file is the input to a real implementation plan, not the plan itself.

## Decision: rebuild natively
CareConnect's Convex/Clerk/WhatsApp stack does not get integrated. Its domain concepts (tokenized public links, visit-triggered feedback, happy/unhappy rating branching, complaint auto-triage, review click-through, availability-based booking) and small UI patterns (badge variants, board view, star-rating widget) are references to reimplement in Thera.Net's own stack — not code or infra to reuse directly.

**On reusing CareConnect's tokenized links specifically:** the *frontend* — the `/f/$token` route's React form, the star-rating widget, the happy/unhappy branching UX — is plain React/Tailwind and can be ported/adapted directly into Thera.Net's frontend with little rework. What can't be reused as-is is the *backend*: CareConnect's token generation/validation is a Convex function reading a Convex document, and Thera.Net runs on Supabase/Postgres — there's no Convex runtime to plug into. So the practical answer is "reuse the UI, reimplement the token-validation logic as a Postgres RPC/RLS policy that does the equivalent job" (generate a random token, store it against a Postgres row, validate it server-side) — same user-facing behavior, different backend underneath it.

## The module, as scoped through discussion: four workflows sharing common plumbing

### A. Patient-initiated booking requests
1. Clinic shares a public link (website/Google profile). Patient opens it, no login required.
2. **Slot picker is itself a clinic-level toggle.** Clinics that have set up per-therapist weekly availability get a real calendar/slot picker (patient picks a genuine open slot; requires building availability + slot-conflict checking from scratch — nothing like this exists in Thera.Net today). Clinics that **haven't** configured therapist slots get the toggle switched off, and the public form falls back to a general request instead — name/phone/preferred day-or-time as free text/rough preference, no calendar. Both modes share the same `appointment_requests` table; the toggle only changes what the public form renders and whether a specific slot is attached to the request.
3. Submission creates an `appointment_requests` row (status `pending`), visible to staff in Thera.Net.
4. Staff reviews the request in-app. **Confirming does not auto-create or auto-match a patient/visit.** The patient-submitted name/phone may not exactly match an existing patient record, so staff get a manual choice at confirm time: link the request to an existing patient (search/select) or create a new patient — no silent find-or-create-by-phone the way CareConnect does it. Confirming creates a real `appointments` row against whichever patient staff picked/created.
5. Patient gets a **WhatsApp confirmation message**.
6. **If the patient selected a specific therapist**, that therapist also gets a reminder/notification about the upcoming appointment — not just the patient-facing confirmation (mirrors CareConnect's therapist-side appointment reminders).

This is the single largest piece of new infrastructure in the plan: no `appointments`/`appointment_requests` tables, no availability model, no slot-conflict logic exist in Thera.Net today. All need designing relationally with RLS — not lifted from CareConnect's Convex schema.

### B. Feedback capture & triage
1. Staff triggers a feedback request from any visit record (today's or an old/backfilled one) — a manual action, nothing automatic by default (see "Automation is a setting" below).
2. A `feedback_requests` row is created: random token, linked to visit/patient/clinic, status `pending`. The token is the entire "auth" for the patient side.
3. Staff sends the link to the patient (see "Sending links" below).
4. Patient opens the link, no login — a public page validates the token and shows a simple form: star rating (1–5) + optional comment. This is the one page in the app an unauthenticated person can write to (a new, narrow SECURITY DEFINER RPC or tightly token-scoped RLS policy, separate from every other `is_clinic_member`-gated table).
5. Patient submits → a `feedback_responses` row is written, request flips to `responded`. No happy/unhappy branching or auto-complaint logic in v1 — deferred, not designed out.
6. Staff gets an in-app notification (net-new — nothing like this exists in Thera.Net today).
7. Staff triages in a list view: rating, comment, which patient/visit, status progression (new → in progress → resolved). No Kanban board, no analytics dashboards, no embeddable widget in v1.

### C. Google review request
On any feedback response rated **4–5 stars**, staff sees a "Request Google review" button that sends the clinic's Google review link to the patient (same send path as everything else in this module). Not shown for 1–3 star responses. Requires a `googleReviewUrl` field on the clinic record (mirrors CareConnect's `clinics.googleReviewUrl`).

### D. Patient re-engagement reminders
A "Send reminder" action in two places:
- **Stale packages** — already an existing Thera.Net concept (packages flagged stale after 14 days since last visit on the Packages panel). No new detection logic needed.
- **Single-visit patients** — **already surfaced in the existing Trends/Reports section** (per user correction — not new detection logic either; reuse that existing view/query rather than building a new one).

Each segment gets its **own editable message template** (clinic-level setting, plain text with placeholders like patient name) — e.g. a "you still have sessions left" nudge for stale packages vs. a "how are you feeling, want to book a follow-up" nudge for single-visit patients.

## Cross-cutting decisions (apply to all four workflows)

**Sending links — WhatsApp share, not just Business API.** The default, always-available path is a "Copy link" / "Share via WhatsApp" action that hands the message off to the *staff member's own* WhatsApp (a `wa.me`-style deep link or native share sheet) — no Business API, no per-clinic Meta credentials required for this path. A clinic that *has* configured its own WhatsApp Business Cloud API credentials can additionally get one-click automated sending straight from the app. Both paths coexist; the manual share-link path is the baseline every clinic gets for free.

**Automation is a per-clinic/per-therapist setting, not a hardcoded choice.** Whether feedback requests, reminders, or confirmations fire automatically (e.g. auto-send N hours after a visit) or require a manual click is itself a toggle therapists/clinics control — don't hardcode "always manual." Manual-only is the safe default; automation is opt-in per workflow.

**Module gating.** One `clinics.enableFeedback`-style boolean (matching the existing `enableExpectedToday`/`clinicalDocsEnabled` pattern) turns the whole module on — the four workflows share enough plumbing (WhatsApp send, tokenized public links) that they don't make sense as separately-gated sub-modules, at least for v1.

**Settings location.** All of this module's configuration (WhatsApp credentials, Google review URL, reminder templates, availability toggle, automation toggles) lives in its own dedicated section/menu on the Settings page — not scattered across existing settings groups — since it's a large enough surface area to warrant its own home.

**Sync model split (resolved — recommendation, not left open):**
- **Public/patient-submitted writes (feedback response, booking request) — always online-only RPC.** The patient has no offline app to sync from later, so there's nothing to queue; the RPC is the only path and it either succeeds live or the patient sees an error and retries.
- **Staff-side booking confirmation and slot selection — online-only, not outbox-synced.** Confirming a request or claiming a slot needs an immediate, authoritative check against other pending requests/slots to avoid double-booking two patients into the same therapist slot from two different offline devices — the same reasoning that already makes `create_clinic_with_admin()`/`issue_invoice()` RPC-based instead of outbox-based in this codebase (correctness under concurrency beats offline convenience here).
- **Staff-side feedback triage (status changes, notes) and everyday CRUD (creating a feedback request, editing message templates, toggling settings) — normal Dexie/outbox sync**, like the rest of the app. Low conflict risk, no correctness requirement forcing synchronicity, and staff should be able to triage feedback offline like any other clinic data.
- **Reminders and review-request sends — online-only** (they're an outbound action with an immediate side effect — sending a message — so there's nothing meaningful to queue offline; either send it now or don't).

## Still to work out at implementation-plan time (deliberately deferred — "design as we go")
- Exact shape of the anonymous-write RLS/RPC surface for tokenized public links (token generation, expiry, one-time vs. reusable), reused for both the feedback form and the booking-request form.
- Therapist weekly-availability model + slot-conflict checking, and the exact shape of the on/off toggle that swaps the public form between slot-picker and general-request mode.
- `appointment_requests` / `appointments` schema, and how a confirmed request relates to the existing `visits` table (does confirming create a separate `appointments` row that later links to a `visits` row, or something simpler?).
- `feedback_requests` / `feedback_responses` schema (Postgres/RLS equivalents of CareConnect's tables, sized for v1 — no sub-ratings, no auto-complaint).
- Where WhatsApp Business credentials, the Google review URL, and the two reminder message templates live within the new dedicated settings section, and what placeholder syntax the editable templates support.
- Design of the "share via WhatsApp / copy link" UI component, since it's reused across booking confirmations, feedback requests, review requests, and reminders.
- Design of the per-workflow automation toggle (what "automatic" actually triggers on for each of the four workflows).
- The staff confirm-time UI for linking a booking request to an existing patient vs. creating a new one.

Per the user, exact UI/visual design for all of the above is handled iteratively during implementation, not specified upfront in this discovery doc.

## Status
Requirements-gathering complete across all four workflows and the cross-cutting decisions (sending mechanism, automation-as-a-setting, module gating, settings location, sync model). No implementation started, nothing to commit. Next step: turn the "still to work out" list into an actual implementation plan (schema, RLS/RPC design, availability/slot model, WhatsApp share component, settings UI) when the user is ready to move past discovery.
