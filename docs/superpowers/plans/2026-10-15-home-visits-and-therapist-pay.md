# Home visits, therapist pay, and payroll

Rewritten against `main` as of 15 Oct 2026. Replaces the earlier home-visit sketch that assumed appointments, the calendar, and overlap checks still had to be built. They are already built. This plan only adds place of service, a travel buffer, and a clean split between hospital settlement and therapist pay.

It also amends `docs/superpowers/specs/2026-10-12-hr-module-design.md` before that module is implemented. Do not start the HR migrations until section 6 below is folded into that spec.

## What already exists

- `appointments` with `scheduledAt`, `durationMinutes` (5–240), therapist, patient, status, `visitId`, `seriesId`, and `source` (`booking` or `walk_in`). Staff book from `BookSlotSheet`. Patients request from `BookingFormPage`.
- Calendar: `SchedulePage`, `TimeGrid`, `ResourceDayGrid`, `MultiResourceWeekGrid`, `AgendaList`, working hours, closed days.
- Overlap: `therapist_has_overlap` blocks `scheduled_at` plus that row’s own `duration_minutes`. Cancelled rows are ignored.
- A visit is still the billed record. Creating a visit from an arrived appointment copies the patient and therapist. The appointment does not store money.
- Hospital math is `computeVisitSplit`: clinic share (`bmSplitPct`), tax, partner remainder. Those figures are snapshotted on the visit. Monthly partner settlement is a separate report. It is not therapist payroll.
- Two therapists on one visit is `sharedTherapistId` + `sharedPct`. Reports move gross bill (`sharedPaise`) and post-tax net (`netPostTaxPaise`) from the primary to the assistant. Totals stay unchanged. `clinicSharePaise` on the monthly row is **not** moved by that split today.
- `InvoiceClinicalSnapshot.placeOfService` is a free choice on the bill (`clinic` | `home` | null). It is not read from the appointment or the visit.
- `clinicType === 'individual'` already exists and is the solo-clinic switch.
- HR (compensation, expenses, payroll, manager role) is a spec and a phase-1 plan only. No HR tables are in the database.

## Out of scope

Patient address, maps, turn-by-turn navigation, travel reimbursement as its own ledger, statutory TDS meters, GST turnover meters, automated incentive rules, clock-in geofencing, and a second booking system.

## 1. Place of service

Add `place_of_service text not null default 'clinic'` with a check of `clinic` or `home` on:

- `appointments`
- `visits`

Catalog items get an optional `default_place_of_service` with the same check, default `clinic`. Picking that service in `BookSlotSheet` or New visit selects `home`, and staff can override it on that booking or visit.

When a visit is created from an appointment, copy `placeOfService` onto the visit. When an invoice is issued, pre-fill `InvoiceClinicalSnapshot.placeOfService` from the visit (or from the visits on that invoice if they agree). If the visits disagree, leave the snapshot null and let the biller choose. Do not re-read the live appointment after the invoice is issued.

Show a `Home` badge on `TodayAppointments`, the schedule blocks (`ResourceDayGrid`, `TimeGrid`, `AgendaList`), and the visit card. Front desk uses it to see that the therapist is off-site. It does not by itself block clinic bookings; the travel buffer does.

Freeze `placeOfService` on a visit once the visit is invoiced, same as the other billing fields.

## 2. Travel buffer

Store `travel_buffer_minutes integer not null default 0` on `appointments`, check `0, 15, 30, 45`. Keep it separate from `duration_minutes`. The treatment length is what the visit and the bill mean. The buffer is only a scheduling block.

`therapist_has_overlap` must treat the blocked interval as `duration_minutes + travel_buffer_minutes`. Pass that sum from confirm, reschedule, and staff create. A 45-minute home visit with a 30-minute buffer occupies 75 minutes and must reject a clinic booking inside that window.

`BookSlotSheet`: when place is `home`, show the buffer choices. Default from a clinic setting `default_home_travel_buffer_minutes` (0 until the clinic sets one) so solo therapists are not picking it every time.

Do not create a second appointment for the buffer. Do not add the buffer to the billed amount.

## 3. Solo clinic chrome

When `clinicType === 'individual'`:

- `BookSlotSheet` pre-selects the only active therapist and hides the therapist dropdown.
- Hide multi-therapist colour legends, therapist filters, and shift-approval actions that only make sense with a roster.
- Do not hide day flow, UPI collection, invoices, or the home badge.

There is nothing to build for “a real appointment table”. Wire the badge and the buffer into the calendar that is already there.

## 4. Three money questions, kept apart

Do not put a therapist percentage into `bmSplitPct`.

**Who was paid by the patient**

- Hospital bills (partner clinic). Keep `computeVisitSplit` and partner settlement. Therapist pay, if any, comes out of the clinic’s post-tax share, not out of the hospital’s remainder.
- Clinic bills (no partner). Snapshot visits at 100% clinic share and 0 tax. Hide partner settlement. The same function still runs; the inputs change.
- Solo therapist bills themselves (`clinicType === 'individual'`, no partner). Same as clinic-bills. HR stays off unless they want a payslip. If they turn HR on, salary is 0 and the share is 100% of clinic share, so the payslip matches what they collected.

`clinicType`, `hasPartner`, and `billingMode` already decide which of these surfaces to show. Do not add a third split formula.

**How this therapist is paid**

This is the HR compensation row, not the hospital columns:

- `revenue_share` — a percent of a named base. Salary 0.
- `salary` — monthly `base_pay_paise`. Variable percent 0.
- `salary_plus_home` — monthly salary, plus a percent that applies only to home visits.

**What the percent multiplies**

Compensation stores `share_base`: `gross_bill` or `clinic_share`.

- Partner clinics default to `clinic_share` (post-tax clinic share). A therapist cannot be owed a percent of money the hospital kept.
- Non-partner clinics default to `gross_bill`.

The locked payroll line stores the base that was used, the basis points, and the resulting paise. Changing Settings later does not rewrite a locked run.

## 5. Sharing one visit, and a patient default

Keep `sharedPct` as the only visit-level share. One assistant, between 0 and 100, not the primary therapist. It never changes `actualBillPaise` or the invoice.

Before payroll reads monthly figures, the assistant’s share of the **pay base** must sit on the assistant’s row:

- Today the report moves `sharedPaise` (gross) and `netPostTaxPaise`, and does not move `clinicSharePaise`.
- Payroll must not use raw `clinicSharePaise` until that column is moved by the same `sharedPct`, or until the payroll prefill uses `netPostTaxPaise` when the base is clinic share. Fix the report first. Otherwise the primary is paid for work the visit report already gave to the assistant.

Patient-wise sharing is a default, not an HR table. Optional fields on the patient: assisting therapist and percent. New visit copies them into `sharedTherapistId` / `sharedPct`. Staff can override that visit. Editing the patient does not rewrite old visits. Packages stay per session, because the treating therapist can change mid-package.

## 6. Amendments to the HR phase-1 spec

Keep the phase-1 shape: `hr_enabled`, `manager` role, online-only tables, private receipt bucket, draft then locked payroll, admin-only finalize and unlock, manual adjustments, no Dexie, no automated incentives, no therapist expense claims.

Change the pay math before the first HR migration:

- `therapist_compensation` gains `share_base` (`gross_bill` | `clinic_share`), not only `share_bps`.
- `payroll_lines` snapshots `share_base`, `share_base_paise`, `share_bps`, and `share_paise`. `share_paise` is `round_half_up(share_base_paise * share_bps / 10000)`, never a percent of gross when the base is clinic share.
- Prefill `share_base_paise` from the monthly report **after** section 5’s attribution fix. The admin can still edit the rupee amount on the draft.
- P&L income stays clinic share minus expenses minus locked payroll. Gross bill is shown beside it, not used as income.
- Solo and partner behaviour follows section 4. Do not imply the payslip is statutory payroll. TDS stays a manual deduction line.

Home-visit percent is the next slice, not part of the first migration, and only after `place_of_service` is on visits:

- Compensation gains `home_share_bps` (0 means “use `share_bps` for home visits too”).
- Creating a run sends `clinic_base_paise` and `home_base_paise` per therapist, each already on the chosen base.
- The line snapshots both. Salary is still one monthly amount. In-clinic visits for a salaried therapist add no variable pay.
- Until that slice ships, a one-off home payment is a manual adjustment with a label, not a silent percent of the whole month.

Leave, attendance, reviews, and utilisation stay in later HR phases. They are not required for home-visit badges or for the pay base.

## 7. Order

1. Place of service on appointments and visits, catalog default, badges, invoice pre-fill. No money change.
2. Travel buffer column and overlap using duration plus buffer. Clinic default.
3. Solo chrome on `BookSlotSheet` and the schedule.
4. Report fix so the pay base used for an assistant follows `sharedPct`. Then patient-level default that only prefills the visit.
5. HR phase 1, including `share_base`, against the amended spec.
6. Home vs clinic basis points on compensation and on the payroll line.

Each step is its own change. Steps 1–3 do not wait for HR. Step 5 does not start until `share_base` is in the HR spec.

## Guard rails

- Appointments do not store `bmSplitPct`, therapist pay, or a bill.
- `bmSplitPct` is never reused as therapist take-home.
- Buffer minutes are not billable and are not a second visit.
- Locked payroll and invoiced visits are immutable. Unlocking payroll is the existing audited admin action, not a silent edit.
- Partner settlement and therapist payout stay on different screens.
- `sharedPct` never changes what the patient is charged.
- New columns default so old appointments, visits, and catalog rows stay `clinic` with no buffer.
- Overlap, confirm, and reschedule all use the same duration-plus-buffer rule. A client-only check is not enough.
- Compensation and payroll stay out of Dexie, backups, and the outbox, as the HR spec already requires.
- Home visit work does not add address, maps, or a travel-expense ledger.
