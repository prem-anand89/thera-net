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
**Goal:** Expand the existing visit-based Revenue Split into a full payroll generator that includes base pay.

- **Data Model:**
  - `compensation_config`: `therapist_id`, `base_pay_amount`, `pay_period` (monthly).
  - `payroll_runs`: Logs of finalized payrolls (snapshot of base pay + revenue split - unpaid leaves).
- **User Interface:**
  - **Configuration:** Admins set base pay in Settings -> Team -> Therapist Profile.
  - **Payroll Generator:** End-of-month action in the Reports/Team section. System calculates: `Base Salary` (pro-rated for unpaid leaves) + `Revenue Split` (from visits) = `Final Payout`.
  - **Payslips:** System generates a downloadable PDF payslip. Therapists can download their own payslips from their profile.

## 4. Performance Reviews
**Goal:** Simple, private check-ins between admins and therapists.

- **Data Model:**
  - `performance_reviews`: `therapist_id`, `admin_id`, `review_date`, `rating` (e.g., 1-5 or custom scale), `feedback_notes`.
- **User Interface:**
  - **Admin Form:** Inside Team -> Therapist Profile, admins can create a new review.
  - **Visibility:** Strictly limited to the Admin and the specific Therapist. Visible in a new "Reviews" tab on the Therapist's own profile page.
