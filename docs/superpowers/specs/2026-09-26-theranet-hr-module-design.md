# Theranet HR & Operations Module Design

## Overview
This document outlines the architecture and design for integrating clinic-level HR and Operations into Theranet. Following the "Split-Responsibility" approach, global professional identity (credentials, licenses) will be handled by `ahpnetwork`, while Theranet will focus strictly on clinic-level operations: Attendance, Leave Management, Payroll, and Performance Reviews. The design prioritizes simplicity and ease of use for clinicians.

## 1. Shift Scheduling & Attendance
**Goal:** Track therapist availability and daily attendance with minimal friction.

- **Data Model:**
  - `therapist_roster`: Weekly recurring schedule (e.g., Mon-Fri 9-5).
  - `therapist_schedule_overrides`: Exceptions to the roster (e.g., specific days off or extra shifts).
  - `attendance_logs`: Logs daily clock-ins/outs (`therapist_id`, `clock_in_time`, `clock_out_time`, `location_flag`).
- **User Interface:**
  - **Clock In/Out:** A prominent button on the Therapist's Workspace dashboard.
  - **Geofencing:** When clocking in, the browser requests location. If the therapist is >100m from the clinic's lat/long, the system allows the clock-in but flags the entry as "Out of bounds" for admin review.
  - **Admin View:** "Attendance" tab in the Team section showing today's status and historical timesheets. Admins can manually correct missed clock-outs.

## 2. Leave Management (PTO)
**Goal:** Allow therapists to request time off and give admins a simple approval workflow that automatically updates the roster.

- **Data Model:**
  - `leave_requests`: `therapist_id`, `start_date`, `end_date`, `type` (sick, vacation, unpaid), `status` (pending, approved, rejected), `notes`.
  - `leave_balances`: Tracks annual PTO allowance per therapist.
- **User Interface:**
  - **Request Form:** Simple form on the Therapist Workspace to request leave.
  - **Admin Inbox:** "Leave Requests" section under the Team tab for Admins to approve/deny.
  - **Roster Integration:** Approved leaves are automatically injected into `therapist_schedule_overrides` to block out availability.

## 3. Payroll & Compensation
**Goal:** Expand the existing visit-based Revenue Split into a full payroll generator that includes base pay and tracks clinic profitability per therapist.

- **Data Model:**
  - `compensation_config`: `therapist_id`, `base_pay_amount`, `pay_period` (monthly).
  - `payroll_runs`: Logs of finalized payrolls (snapshot of base pay + revenue split - unpaid leaves).
- **User Interface:**
  - **Configuration:** Admins set base pay in Settings -> Team -> Therapist Profile.
  - **Payroll Generator:** End-of-month action in the Reports/Team section. System calculates: `Base Salary` (pro-rated for unpaid leaves) + `Revenue Split` (from visits) = `Final Payout`.
  - **Profitability Metrics (New):** The payroll run also computes the clinic's margin per therapist: 
    - `Total Generated` (Gross billed amount by therapist)
    - `Total Paid Out` (Base Salary + Therapist's Revenue Split)
    - `Net Clinic Profit` (`Total Generated` - `Total Paid Out`)
    - `Profit Margin %` (`Net Clinic Profit` / `Total Generated`)
  - **Payslips:** System generates a downloadable PDF payslip. Therapists can download their own payslips from their profile.

## 4. Performance Reviews
**Goal:** Private check-ins between admins and therapists, backed by hard performance data.

- **Data Model:**
  - `performance_reviews`: `therapist_id`, `admin_id`, `review_date`, `period_start`, `period_end`, `rating` (e.g., 1-5 or custom scale), `feedback_notes`, `snapshot_revenue_generated`, `snapshot_clinic_profit`.
- **User Interface:**
  - **Data-Driven Admin Form:** When creating a review for a specific period (e.g., Q1), the form automatically pulls in the therapist's `Net Clinic Profit` and `Total Revenue Generated` for that time frame. This allows admins to evaluate the clinician directly against their financial impact on the clinic.
  - **Visibility:** Strictly limited to the Admin and the specific Therapist. Visible in a new "Reviews" tab on the Therapist's own profile page.

## 5. Expense Tracking & Reimbursements
**Goal:** Allow therapists to easily claim work-related expenses and get reimbursed through payroll.

- **Data Model:**
  - `expense_claims`: `therapist_id`, `amount`, `category` (e.g., Supplies, Travel), `date_incurred`, `receipt_url` (Supabase Storage), `status` (pending, approved, rejected, paid).
- **User Interface:**
  - **Therapist Flow:** A simple "Submit Expense" form in the Workspace where they upload a photo of the receipt and enter the amount.
  - **Admin Approval:** A queue in the Team tab where admins review and approve/reject claims.
  - **Payroll Integration:** Approved but unpaid expenses are automatically bundled as an "Additions" line item on the next generated Payslip.

## 6. Incentive Management
**Goal:** Motivate therapists with ad-hoc bonuses or performance-based incentives that seamlessly hit their payslip.

- **Data Model:**
  - `incentive_rules` (Optional future phase): Rules for automated bonuses (e.g., `target_type`: 'visit_count', `target_value`: 100, `bonus_amount`: 5000).
  - `payroll_adjustments`: `payroll_run_id`, `therapist_id`, `amount`, `type` (Bonus, Deduction, Commission), `description`.
- **User Interface:**
  - **Manual Bonuses (Phase 1):** When the Admin runs the end-of-month Payroll Generator, the UI includes an "Add Bonus/Incentive" button for each therapist. Admins can manually type in a bonus amount (e.g., "Hit target revenue: ₹5000") before finalizing the payslip.
  - **Automated Incentives (Phase 2):** During payroll generation, the system checks `incentive_rules`. If a therapist crossed a threshold (e.g., > 80 visits this month), it automatically injects the bonus line item into the payroll preview for admin approval.

## 7. Time Utilization & Productivity Dashboard
**Goal:** Give Admins and HODs a real-time view of how clinical time is utilized, accounting for walk-ins and actual work done (not just bookings).

- **Data Model:**
  - **Catalog Upgrade:** Add `duration_mins` to `billing_packages` (Settings -> Catalog).
  - **Visits Upgrade:** Add `clinical_duration_mins` to the `visits` table.
- **User Interface:**
  - **Visit Logging (Therapist):** When a visit is logged, the time automatically defaults to the catalog's service duration. The therapist can manually override this (e.g., "Time spent: 30 mins") if the session ran long or short.
  - **HOD Dashboard (Admin):** A visual daily/weekly heatmap in the Team section showing:
    - `Available Hours` (from Attendance/Clock-ins)
    - `Clinical Hours` (Sum of `visits.clinical_duration_mins`)
    - `Utilization Rate` (`Clinical Hours` / `Available Hours`)
  - **Impact:** This accurately tracks true productivity because every logged visit (including pure walk-ins) counts toward the therapist's utilization, giving the clinic head a precise picture of efficiency.
