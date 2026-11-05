# Awaiting Appointments Implementation Plan (v2)

**Date:** 2026-11-05 · **Status:** Rewritten after a code review; the comms-switch split (Task 1) is approved. Not started: the owner is holding the order of work. Task 1 is for Opus.

**Goal:** When a patient calls or walks in and there is no slot, staff log them in 10 seconds on Workspace, see who is waiting, and book them when something opens. No more paper or WhatsApp notes.

**Reuses (already built):** the `appointment_requests` table; `AddToWaitlistSheet` and `add_waitlist_entry`; Requests to confirm on Workspace (`RequestsInbox` in `TodayAppointments`); confirming through `BookSlotSheet` (`confirmingRequest` in `WorkspacePage`); the WhatsApp strip after a booking; `domain/waitlistMatch.ts`.

## Decisions

| Decision | Ruling |
|---|---|
| Who sees and adds | **Admin and front desk only** (owner, 2026-11-05). The database already enforces this, so no RLS change. A solo owner is an admin, so is covered. |
| One list | No second section. Requests to confirm becomes **Awaiting** and holds both public requests and staff entries. `isWaitlist` stays only as a small label. |
| The word | **Awaiting** on every screen. Not "waitlist" or "requests". Database names stay. |
| Connection | Adding, booking and dismissing are online-only RPCs (read-only sync, as today). Offline, the sheet says so plainly. |
| Patient link | No new column. Match on the phone number when booking, as `BookSlotSheet` does for requests. |
| Dropped from v1 | `patients.general_availability` (nothing uses it); undo on dismiss (decline is one-way, so ask first instead). |

## The comms switch (Task 1)

`clinics.enable_patient_comms` shows in Settings only as **"Ask patients for feedback"** (General → After a visit), but it also controls much more: the online booking page, the Workspace Appointments card and Book button, Book on the Patients list, Requests, and follow-up and package messages. Result: 13 of 16 clinics have it off, so they have no Appointments card and their booking link doesn't work, and a clinic that turns off feedback loses online booking. The Settings card still shows that link.

**Approved by the owner (2026-11-05):** the app's core stops depending on it.
- The Appointments card, Book buttons and Awaiting show for every clinic.
- WhatsApp messages stay available: they are `wa.me` links the staff tap. `patients.do_not_message` still applies.
- New `clinics.online_booking_enabled`, with a switch on the Online booking page card. Backfill from `enable_patient_comms`, so no clinic's public page changes on the day. The public RPCs check the new column.
- `enable_patient_comms` then means feedback only, matching its label. The column keeps its name (renaming touches too much for no user gain).

## Tasks

### Task 1: Split the comms switch (Opus; one migration)
- **Migration:** add `online_booking_enabled boolean not null default false`, backfill, and change the public booking RPCs that check `enable_patient_comms` (`submit_appointment_request`, the public availability and clinic-info RPCs; list them from the live database first) to check the new column. Feedback token routes keep the old one. The owner applies it before the client deploys.
- **Client:** `onlineBookingEnabled` on `Clinic`; a switch on the Online booking page card, and hide the link while it is off. Go through every `enablePatientComms` use (about 35; `domain/patientComms.ts`, `WorkspacePage`, `PatientsPage`, `LedgerPage`, `SingleVisitPatientsCard`, `VisitLoggedCard`, `SchedulePage`): feedback ones stay; the rest stop checking it.
- **Tests:** a clinic with feedback off still sees the card and Book; public page follows only the new switch; feedback follows only the old one; SQL check that the backfill changed no clinic's public page. **Docs:** both schema copies, section 9.

### Task 2: Add from the Appointments card (Sonnet)
- A quiet "+ Awaiting" next to "Open schedule →" on the Appointments card, for admin and front desk, opening `AddToWaitlistSheet` with today's date. Retitle the sheet "Add to awaiting". Use `SheetDialog`.
- Patient picker on the name box (existing patient fills name and phone; new caller types them). Phone stays required, as the RPC demands; a walk-in with no phone can't be added, and the sheet says so.
- **Tests:** visible to admin and front desk, not a therapist; saves; offline message.

### Task 3: One Awaiting list (Sonnet)
- In `TodayAppointments`, rename the section **Awaiting (N)**. Each row: name, therapist if chosen, preferred day and time of day, note. Actions: **Book** (existing flow), **WhatsApp**, **Dismiss** behind a confirm.
- **WhatsApp wording must not promise a slot:** "Hi Suresh, this is Beyond Mechanics. We've noted your request for an appointment and will call you as soon as a time is free." The "confirmed" message stays where it is, on the strip after booking. No emoji in buttons.
- **Past dates:** an entry whose preferred date has passed sinks to the bottom marked "Was for 3 Nov", still bookable, and never vanishes by itself. Dismiss clears it.
- Therapists' own day view is unchanged.
- **Tests:** public and staff entries in one list, oldest first; past-date order and label; the message has no "confirmed"; dismiss asks first.

### Task 4: Suggest when a slot opens (Sonnet)
- On cancelling or rescheduling an appointment, if `waitlistMatch` finds Awaiting entries for that day and time, show one line: "2 people are awaiting this time" with **Book**. Check what Schedule already surfaces first and reuse it; add only what is missing on Workspace.
- **Tests:** match shows, no match shows nothing.

## Model

| Task | Model | Why |
|---|---|---|
| 1 | **Opus** | Migration, public RPCs and about 35 call sites; a mistake takes a public page down or exposes one |
| 2, 3, 4 | **Sonnet** | Reuse of existing pieces |
| Final review | **Opus** | |

**Loading rule (from PR #107, FEATURES_AND_SCHEMA §0c), for Tasks 2 to 4:** the Awaiting list and the Workspace counts read server data (requests, waitlist), so show `LoadingRows` while the data is `undefined`, never "nothing waiting" or a zero count, and hold any message that depends on a second source (such as the plan or the switch) until both have loaded.

Order: 1, 2, 3, 4. One commit each. Tasks 2 to 4 assume Task 1; if the owner skips it, they reach only clinics with the switch on.
