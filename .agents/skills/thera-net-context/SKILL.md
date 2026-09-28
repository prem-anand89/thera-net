---
name: thera-net-context
description: Use when starting any task in the TheraNet workspace — provides the architecture map, key file locations, database conventions, and the active implementation plan to avoid redundant research and repeated mistakes.
---

# TheraNet Project Context

## What This App Is
TheraNet is a mobile-first clinic management SaaS. Core features: patient billing/ledger, appointment booking (public + internal), WhatsApp patient communications (wa.me deep links), feedback collection, and therapist management. Built with React + TypeScript, TanStack Router, Dexie (IndexedDB sync), and Supabase (Postgres + PostgREST).

## Key File Map

| What you need | Where it lives |
|---|---|
| Navigation / Shell chrome | `src/app/Shell.tsx` — `NAV` array at line 40 |
| Router / all routes | `src/app/router.tsx` |
| Workspace (home page) | `src/features/workspace/WorkspacePage.tsx` |
| Public booking form | `src/features/publicBooking/BookingFormPage.tsx` |
| Public feedback form | `src/features/publicFeedback/FeedbackFormPage.tsx` |
| Booking requests inbox | `src/features/requests/RequestsPage.tsx` |
| Settings page | `src/features/settings/SettingsPage.tsx` |
| WhatsApp link logic | `src/lib/pdfShare.ts` → `openPatientWhatsAppChat()` |
| Feedback service | `src/services/feedbackService.ts` |
| Booking service | `src/services/bookingService.ts` |
| Supabase client | `src/lib/supabase.ts` → `getSupabase()` |
| Dexie local DB | `src/lib/db.ts` |
| Repositories (Dexie queries) | `src/repositories/local.ts` |
| CSS variables | `src/index.css` — all `--var` tokens defined here |
| UI component tokens | `src/components/ui.ts` — `btnPrimary`, `SectionCard`, `StatTile`, etc. |
| Domain types | `src/domain/types.ts` |

## Database — Key Tables (verified schema)

| Table | Key columns |
|---|---|
| `clinics` | `id, name, booking_slug, logo_path, enable_patient_comms, google_review_url, slot_duration_minutes (to be added)` |
| `appointment_requests` | `id, clinic_id, name, phone, email, preferred_date, preferred_time_text, preferred_therapist_id, notes, status, appointment_id` |
| `appointments` | `id, clinic_id, patient_id, patient_name, patient_phone, therapist_id, scheduled_at (timestamptz), status, request_id, visit_id` |
| `feedback_requests` | `id, clinic_id, visit_id, patient_id, therapist_id, token, status, expires_at` |
| `feedback_responses` | `id, request_id, clinic_id, rating (smallint 1-5), comment` |

## Critical Architecture Rules

1. **`appointment_requests` and `appointments` are read-only Dexie tables.** Never write via Dexie outbox — only via Supabase RPC, then call `syncEngine.schedule(0)`.
2. **WhatsApp = `wa.me` deep links only.** `src/services/whatsappBusinessService.ts` exists but its UI entry point in Settings returns `null` (deliberately hidden).
3. **Mobile nav = 5 items max.** Do not add a 6th tab to the mobile bottom bar.
4. **Colours = CSS variables only.** Never hardcode hex values.
5. **Buttons need `type` attribute.** Use `<Button>` from `src/components/Button.tsx`.
6. **Every DB change = two steps:** apply via MCP + write migration file to `supabase/migrations/`.

## Active Implementation Plan

The master plan lives at:
`/home/theranet/.gemini/antigravity-ide/brain/3f46a4e9-8636-4b0d-b1f5-ba504a50239d/implementation_plan.md`

Read it before starting any new feature. Current phase priorities:
1. **Phase 1** — Public Booking Page (slot picker, country code phone, logo, new `get_booking_clinic_info` RPC)
2. **Phase 2** — Therapist Notifications (Realtime bell + email + .ics)
3. **Phase 4** — Workspace schedule integration (MiniCalendarStrip + DailyAgendaTimeline)
4. **Phase 5** — Smart Confirm booking flow (BookSlotSheet bottom-sheet)
5. **Phase 6** — Feedback 5-star Google routing (update RPC threshold from `>= 4` to `= 5`)
6. **Phase 3** — DEFERRED until Meta Cloud API is set up

## Known Gotchas

- `generate_url_safe_token()` uses `extensions.gen_random_bytes()` — always use the `extensions.` prefix or it fails silently.
- `create_feedback_request_v2` exists as a schema-cache workaround. The canonical function is `create_feedback_request` but `v2` is what `feedbackService.ts` currently calls.
- The front_desk role has a `useEffect` in `WorkspacePage.tsx` (line ~201) that redirects them to `/ledger`. **This must be removed in Phase 4.**
- `submit_feedback_response` currently returns Google review URL for `rating >= 4`. Phase 6 changes this to `rating = 5` (5-star only).
