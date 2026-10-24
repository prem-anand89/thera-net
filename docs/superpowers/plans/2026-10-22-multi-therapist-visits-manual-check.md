# Manual check: multi-service, multi-therapist visits

Run this in the real app. Do each section at **360 px wide** (browser dev tools, phone size) and again on **desktop**. Tick a box only when you saw the "You should see" result. Write down anything that differs.

Roles needed: **front desk**, **admin**, **billing therapist** (Dr A, the primary), **assisting therapist** (Dr B), plus a **solo clinic** (a clinic with one therapist, or `individual` type).

Test setup (once, as admin): catalog has "Consultation" ₹1,000 and an add-on service "Dry needling" ₹500 (give Dry needling a duration of 20 min), a package "Rehab package" (10 sessions) at ₹10,000, and a test patient. Settings -> therapist split is ON.

## A. Solo clinic is unchanged
- [ ] Log in to the solo clinic. Open New Visit, pick a patient, pick "Consultation", Save.
  - You should see: no "Assign assistant" action, no "Revenue share" line, the same Visit / Services / Payment cards as before, and the visit saves and shows in Today and the Ledger like any other.
- [ ] Open that visit's row actions.
  - You should see: no "Edit split" / "Split revenue".

## B. Consultation plus an assistant add-on, ₹1,300 bill with a ₹200 discount (as Dr A)
- [ ] New Visit, patient, therapist Dr A. Row 1: Consultation (₹1,000). "+ Add another service": Dry needling (₹500), then "+ Assign assistant" on that row and choose Dr B.
  - You should see: the chip "Dr B · assisting" on that row, Subtotal ₹1,500.
- [ ] Add a ₹200 discount with a reason.
  - You should see: Total ₹1,300, and the line "Revenue share · from services" reading Dr A ₹867 (67%) · Dr B ₹433 (33%).
- [ ] Save.
  - You should see: the "Visit logged" screen naming both services ("Consultation + Dry needling"). Open the saved visit's details: "Revenue share - Dr A ₹867 · Dr B ₹433".

## C. Package session plus a paid add-on
- [ ] New Visit for a patient with ONE open package.
  - You should see: a ₹0 package row "Session n of N · package (₹0)" added automatically.
- [ ] Add "Dry needling" with Dr B assisting, Save.
  - You should see: Total ₹500, and Dr B's share is the add-on only; the package money stays with Dr A (the package holder).

## D. Removing the package row
- [ ] New Visit for a patient with an open package, remove the package row (X).
  - You should see: the note "{patient} has an open package (session n of N). It isn't used on this visit." with "Add package session" - the reminder shows and does not block saving. Choosing "Add package session" puts the row back.

## E. Picking a service before the patient
- [ ] New Visit, pick "Consultation" first, then search and pick a patient.
  - You should see: the service row is kept. If the patient has exactly one open package, no package row is added next to a package row you already chose.
- [ ] Add a discount with a reason before picking the patient, then pick the patient.
  - You should see: the discount is kept.

## F. Changing patient
- [ ] With rows filled and a patient chosen, tap "Change patient" and pick someone else.
  - You should see: the rows and the discount start over (one empty row, or the new patient's single open package as a continuation row).
- [ ] From the Ledger, "Repeat last visit" on a visit.
  - You should see: the repeated services are filled in, and there is NO "Change patient" button.

## G. Hand-edited share, then add a service
- [ ] Open a saved shared visit (admin or Dr A), "Edit split", change Dr B's share to a different amount, Save.
  - You should see: the confirmation, and the row reads "Revenue share" with your amounts.
- [ ] Edit the visit, add another service, Save.
  - You should see: the share editor opens and the banner "Services changed. Update shares from services?" is shown.
- [ ] Save the shares without recalculating.
  - You should see: the banner clears (it does not come back when you reopen the editor).
- [ ] Reopen after a later service change and choose "Recalculate from services".
  - You should see: the shares go back to the service-based split.

## H. Invoiced visit
- [ ] Issue an invoice for a shared visit (as billing user). Then open the visit.
  - You should see: "This visit is on an invoice. Its services and bill can't be changed." and services are read-only.
- [ ] Open the revenue share editor on that visit, change a share, Save.
  - You should see: the save works (shares stay editable) and the patient's bill does not change.
- [ ] Try to issue an invoice for a visit while offline or just after editing its services, before it shows Synced.
  - You should see: the app refuses with a message instead of issuing.

## I. The invoice print
- [ ] Open the printed invoice of the shared visit.
  - You should see: one line per service, with the service name and price, and only the primary therapist (Dr A) named. Dr B does not appear.

## J. The assistant's views (log in as Dr B)
- [ ] Today (Workspace).
  - You should see: an "Assisted today" row with the patient, the services Dr B did, "with Dr A", "Your share ₹..." and "Not on your schedule. Logged on Dr A's visit." No bill, no payment pill, no Collect button, no edit/delete.
  - Dr B's Dues / Collected tiles do NOT include that visit.
- [ ] Ledger filtered to Dr B (and, as admin, filtered to Dr B).
  - You should see: the assisted visit below the visits; as admin the rows read "Dr B's share" and "Logged on Dr A's visit.". The Ledger totals line does not include it. The list label for a screen reader is neutral ("Visits assisted on") for admin.
- [ ] Patient profile history for that patient.
  - You should see: Dr B sees the assisted row (just their share) instead of Dr A's full row.
- [ ] Open the saved visit as Dr B anywhere else.
  - You should see: no edit controls.

## K. Monthly statement (as admin)
- [ ] Reports -> Monthly statement for the month of the test visits.
  - You should see: an "Assisted" column next to Visits with Dr B's count; the Total row counts each visit once, with the note "Total counts each visit once; therapists' patients treated can add up to more."; Dr B has a row even when their money was ₹0.

## L. Phone Save bar (360 px only)
- [ ] New Visit on the phone.
  - You should see: the phone bottom tab bar is hidden. The Save bar sits flush at the bottom edge in a single row with line 1 "₹1,300" (or "No service yet" when empty with Save disabled) and line 2 "2 services · UPI, collected now", plus Cancel and Save visit buttons. Tapping the summary scrolls to Payment. Scroll to the very bottom: the Payment fields are still reachable and there is no duplicate Cancel button under Payment.
- [ ] Cancel/Back behavior on phone.
  - You should see: pressing Cancel on an untouched form exits immediately. With a service chosen, Cancel or the top-left "←" back arrow prompts "Discard this visit? Unsaved changes will be lost.".

## M. Escape closes pickers
- [ ] Open the service picker, press Escape. Open the assistant picker, press Escape. Open the revenue share editor, press Escape.
  - You should see: each one closes without changing the rows.

## N. Front desk
- [ ] As front desk, open a saved visit (not yet invoiced), edit a note or a service, edit the revenue share.
  - You should see: all of these save.
- [ ] Look for a delete action on a visit.
  - You should see: front desk cannot delete (no Delete, or it is refused).
- [ ] As the front desk user (or admin), try the same on a visit logged by another therapist. Then as Dr B (assisting, not the creator) try to add a service to Dr A's visit.
  - You should see: front desk and admin can; Dr B cannot.

## O. Therapist split OFF
- [ ] Admin: Settings -> turn the therapist split OFF. New Visit with an assistant tagged on one service.
  - You should see: the assistant chip is still there, there is NO "Revenue share" line, and the visit saves.
- [ ] Saved visit and Monthly statement.
  - You should see: the assistant is still tagged on the service, still counted in the Assisted column, and the assisted row shows "revenue not shared". "Edit split" is not offered.
- [ ] Turn the split back ON afterwards.

## Not covered here
Anything that needs real UPI or WhatsApp. Note anything you could not check.
