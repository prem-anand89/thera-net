# Patient follow-up reviews — design

**Status:** draft for the owner's review. No code written.

## Problem

A therapist often tells a patient "come back for a review in 2 days / 3 days / a week / on Friday". It lives in the
therapist's head. Nobody is reminded, the patient forgets, and the review never happens (or happens late).

## Intent (confirmed with the owner)

- A follow-up is a **target date**, not a held slot. The slot is booked only once the patient and therapist agree a time.
- Reminders go to the **therapist and front desk**.
- Telling the patient stays a **manual one-tap WhatsApp** (free, works on every plan).
- It must be settable **after the fact**: front desk may log the visit, and the therapist sets the follow-up later.

## Design

### Storage: on the patient (one active follow-up per patient)

New nullable columns on `patients` (already synced, backed up and tombstoned; every clinic member can write it today,
`patients_all` policy):

| column | meaning |
|---|---|
| `follow_up_on` date | the target date |
| `follow_up_note` text | optional, e.g. "reassess knee" (max 200) |
| `follow_up_therapist_id` uuid | who should see them (defaults to the therapist of the latest visit) |
| `follow_up_set_on` date | the day it was set (used to know when it was fulfilled) |

Why the patient and not the visit: the follow-up must be settable later by someone other than whoever logged the visit;
a patient has only one that matters (so no duplicates to de-dupe); it is never tied to an invoice, so the billing
freeze triggers do not apply.

Dismissing = clearing the four columns.

### Fulfilled automatically (derived, never stored)

A follow-up is **done** when the patient has either
- a non-deleted visit with `visit_date > follow_up_set_on`, or
- an appointment with `status in ('confirmed','rescheduled','arrived')` dated `> follow_up_set_on`.

A cancelled or no-show appointment does **not** clear it, so a missed review comes back on the list by itself.
Strictly later than the day it was set, so the visit that prompted it (and any other visit that same day) never clears it.
Pure function `followUpState(patient, visits, appointments, today)` → `'none' | 'planned' | 'due_soon' | 'due' | 'overdue' | 'done'` (tested).

### Setting it — one shared `FollowUpPicker`

Chips: *2 days · 3 days · 1 week · Pick a date · Clear*, plus an optional note. Written through a `patientService.setFollowUp`
(never touches billing). Offered in five places:
1. The "Visit logged" screen (right after saving).
2. A "Set follow-up" item in the ⋮ menu of any visit row (Workspace, Ledger, patient history).
3. The patient profile header: "Follow-up: Fri 30 Oct · Change".
4. The clinical note editor.
5. The Edit visit dialog.

### Seeing it: one Workspace card, "Follow up", with tabs

Workspace already has a **Packages** card (chips Open / Needs attention). The two optional lists share one card to save
vertical space, as two tabs, each showing its own count so nothing hides behind the toggle:

**Follow up:  [ Reviews (n) ]  [ Packages (n) ]**

- The default tab is *Reviews* when anything is due today or overdue, else *Packages*; the choice is remembered per device
  (same pattern as the Appointments | Visits tab).
- A clinic with no follow-ups set sees no tab strip: the card is just Packages, exactly as today.
- Visible to admin / front desk (everyone's) and to a therapist (their own `follow_up_therapist_id`; "Mine only" as on Packages).

**Reviews tab** has three chips:
- **Due** (default): due today, overdue by up to 7 days, or due in the next 3 days. Row: patient, due date, note, therapist, with
  **Message patient** (one-tap WhatsApp: "Hi X, {therapist} would like to see you for a review around {date}. What time suits you?"),
  **Book** (opens `BookSlotSheet` with patient, therapist and date; booking clears it) and **Dismiss**.
- **Missed**: a follow-up more than 7 days past due that was never fulfilled. Reminders (agenda email) stop at 7 days, but the
  patient stays here for 30 days after the due date, and the row's message becomes "Hi X, we'd planned a review with {therapist}.
  Are you still planning to come in? Reply with a day that suits you." Dismiss removes it; after 30 days it drops off the list
  (it still shows on the patient profile).
- **No-shows**: patients whose appointment in the last 14 days was marked no-show and who have no later appointment or visit.
  Same Message / Book / Dismiss. (Derived, nothing stored.)

Relationship to the existing lists: Workspace is the **this-fortnight, act now** list. Reports → *Single-visit patients* stays the
longer-term retention view (patients who never came back, with reasons). A missed review can later appear there as a badge.

- **Patient profile** shows the follow-up and its state.
- (Later, not v1) a faint marker on the Schedule's mini-calendar on the due date.

### End-to-end workflow

1. **Set.** After the session (saved screen, visit row, profile, or note) someone picks *2 days / 3 days / 1 week / a date* and an optional note.
   The patient's `follow_up_on` is stored; nothing is sent.
2. **Therapist is reminded.** The evening before, the therapist's agenda email lists "Follow-ups due" (due tomorrow or overdue up to 7 days).
   Front desk sees the same patients on Workspace → Follow up → Reviews → Due.
3. **Patient is reminded.** Anyone taps **Message patient**: WhatsApp opens with the patient's number and a pre-filled message asking what time suits.
   (A tick marks it "messaged today" on this device so two people don't both send it.)
4. **Patient replies with a time.** Front desk taps **Book**: the booking sheet opens with the patient, therapist and due date filled in; staff pick the agreed time and confirm.
5. **Booking is confirmed to the patient.** The existing "Message patient" strip appears after booking (WhatsApp: "your appointment ... is confirmed for ..."), and the therapist can be messaged too.
6. **It clears itself.** An appointment dated after the day the follow-up was set removes it from Due. If that appointment is later cancelled or marked no-show, it returns (and a no-show also shows under *No-shows*).
7. **If nothing happens.** After 7 days past the due date it moves to **Missed**: reminders stop, and the row offers "are you still planning to come in?". Staff can nudge, book, or Dismiss; after 30 days it drops off the list.
8. **If the patient says no / not needed.** Dismiss clears it. If they want a different date, *Change date* re-sets it (and the reminders restart from the new date).

### Reminding the therapist

`send-agenda` (evening email, default 8 PM, about **tomorrow**; the owner confirmed the evening email is enough, no push in v1) gains a "Follow-ups" section for each therapist:
patients whose `follow_up_therapist_id` is that therapist and whose follow-up is **due on or before tomorrow, up to 7 days overdue**,
and not done. Two required changes in the function:
1. The early exit `if (mine.length === 0) continue;` becomes "no appointments **and** no follow-ups".
2. Fulfilled / cleared follow-ups are excluded with the same rule as the app (kept in one SQL expression, with a test).

Front desk has no agenda email today; they use the Workspace card. A morning push can be added later.

### Out of scope (v1)

Held / tentative slots; automatic WhatsApp (Business API tier can reuse the same message later); several follow-ups per
patient; recurring reviews; a calendar marker; a push notification.

## Risks / checks

- New columns must be in the patient row mapping, the backup/export, and the sync tests (a test already guards tombstone coverage).
- `agenda_log` claims one email per therapist per day; adding follow-ups must not send a second email.
- Overdue window (7 days) and "due soon" window (3 days) are constants in one place.
- Edit permission: any clinic member can edit patients; no new RLS needed.

## Build order (each step shippable)

1. Migration + `patientService.setFollowUp` + `followUpState` (pure, tested).
2. `FollowUpPicker` + profile header + visit-row menu + saved screen.
3. Workspace "Follow-ups due" card with Message / Book / Dismiss.
4. Note editor + Edit visit entry points.
5. `send-agenda` section (edge function; owner deploys).

## Decisions made

- Reminders stop 7 days after the due date; the follow-up then becomes *Missed* (kept 30 days, can be nudged later).
- Evening agenda email is enough; no morning push in v1.
- Follow-ups and Packages share one Workspace card with tabs.
