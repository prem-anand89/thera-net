# Build brief — Workspace, Patient Profile, Archive

## Context

Companion to `build-brief-new-visit-billing.md` (New Visit + billing model — not duplicated here) and the access-matrix decisions in `project-status-index.md` (role + device tiering). This brief covers everything decided since, for Workspace, Patient Profile, and Archive. Ready for direct execution.

A major finding while reviewing Patient Profile: most of the "Needs attention" and "Recently seen" concepts already exist server-side in `src/services/dashboardService.ts` — `pendingWork()` and `recentVisits()` — including the exact 14-day stale-package threshold already assumed below. Most of this brief is UI exposure and reorganization, not new backend, except where explicitly marked **NEW**.

---

## 1. Shared Visit Card component

Used in three places: Workspace "Seen today," Archive, and Patient Profile's visit history. Build once, reuse three times.

**Visual style: flat list rows with a hairline divider between rows, not boxed/bordered cards.** Reconsidered from an earlier draft that used a padded card per row — a list reads denser and scans faster, especially on Archive where row count is highest.

**Fields:**
- **Date** — compact label at the row's leading edge. **Conditional**: omit on Workspace's "Seen today" (every row is implicitly today, a date label would be redundant); show on Archive and Patient Profile, where rows span multiple dates.
- Avatar + patient name — **omit avatar+name on Patient Profile** (redundant, already on that patient's page); include on Workspace and Archive.
- Condition · Service/package · therapist · treatment note — combined onto one secondary line, muted. **Wraps to a second line if long — does not truncate with ellipsis.** (Reconsidered from an initial truncation approach; wrapping was chosen to avoid losing information, accepting variable row height as the tradeoff.)
- Bill amount + payment status chip, right-aligned.
- **Invoice status** — a small secondary element near the payment chip, distinct from the payment chip itself. Payment status (paid/pending) and invoice status (issued/not issued) are independent facts per the billing-model work — don't conflate them into one chip.
- **Sync/edit indicators** — small icons near the date, shown only when applicable (a sync error, or edited by someone other than the original author). Auto-hidden otherwise, consistent with the auto-hide-at-zero/not-applicable convention used throughout this project. These exist in the current build (`VisitsPage.tsx` ⚠/✎ icons) and should not be silently dropped — sync robustness is a recurring, hard-won concern for this codebase.
- Therapist — folded into the secondary line above, not a separate element.
- **Delete** — moved behind a kebab menu (⋮) or tap-and-hold, not a permanently visible icon/link, to keep the row clean.

**Explicitly excluded from this shared component**: hospital-split columns (Own Share, Post Tax). These stay exclusive to the Reports/Monthly Ledger surface (`reportService.monthly()`), consistent with the Archive/Reports separation decided in §4 — Archive and this shared card stay operational, not accounting documents.

This replaces the existing dense multi-column tables in `VisitsPage.tsx` (Archive) and the visit history table in `PatientProfilePage.tsx`.

---

## 2. Workspace — full structure

### Heading rename
`"Today"` → **`"Seen today"`**. Fixes a naming collision with the new "Expected today" section — one is retrospective, one is prospective, and both used to share the word "Today."

### Stat pills (3, not 4)
**Expected** · **Seen today** · **Collected today** — scoped to "mine" for therapist tier, clinic-wide for admin tier. No package-progress pill here; package progress belongs on the card, not the stat row (this was tried and explicitly reverted).

Note: this is the *mobile Today-page* pill set. The existing admin-tier iPad/desktop dashboard keeps its separate 4-tile set (Today's visits / Collected today / New patients this month / Packages this month) unchanged — these are two different surfaces, not one being replaced by the other.

### Two collapsed bars, below the stat pills — built as one reusable pair, not two bespoke bars
Only today-scoped content (Expected today, Seen today) stays inline by default. Everything else collapses behind a **SummaryBar** that opens a **Panel**:

- **SummaryBar**: props = tone (color), label, optional count, tap handler → opens a Panel
- **Panel**: bottom sheet, title, close (X or tap-outside), content slot

Two configured instances of the same pair:
- **`⚠ N need attention ›`** — rust tone, opens Needs-attention panel content (below)
- **`Recently seen ›`** — neutral tone, opens Recently-seen panel content (below)

This is a deliberate declutter — the "Needs attention" and "Recently seen" *sections* used to render inline and were removed from the default scroll for exactly that reason. Build SummaryBar/Panel as shared components from the start rather than two one-off implementations; any future collapsed-summary need (e.g. if Expected-today's booking integration later needs its own summary) should reuse the same pair.

**Desktop/iPad exception**: on admin tier at desktop width, Needs-attention can render inline as a 3-column card row instead of collapsing — the collapse-behind-a-tap treatment exists to solve a phone-space problem, and desktop doesn't have that problem.

### Needs-attention panel — 3 categories
Sourced directly from `dashboardService.pendingWork()` — no new backend needed. Reuses the existing `STALE_PACKAGE_DAYS = 14` constant.

| Category | Color | Always shown | Extra fields | Headline badge |
|---|---|---|---|---|
| Pending payment | Rust | Name, bill amount | Service/package, condition, therapist | "Pending · Xd" |
| Stale package | Amber | Name, package name | Sessions remaining, therapist | "Xd since last visit" (not "sessions ending soon" — staleness, not completion, is the trigger) |
| Incomplete note | Slate (quieter than rust/amber — a documentation gap isn't a financial/retention risk) | Name, visit date | Therapist | "Note not finished" |

### Expected today section — **NEW**, lightweight only
Explicitly not a scheduling/booking system — but explicitly the seed of one. A real booking module is planned as a separate future integration, so structure this to be extended rather than replaced: keep `time_note` as a generic string field (not a rigid slot format) so a future booking system can populate it with a real timestamp without a schema migration. Don't build toward the booking system now — just don't paint it into a corner.

New minimal table: patient (existing patient_id, or free-text name for someone not yet registered), a rough time note (free text, not a real time slot), date, status (`expected` / `arrived` / `no-show`). No calendar, no per-therapist availability, no conflict detection, no patient self-booking, no reminders.

**Setup toggle**: Expected today is opt-in, off by default, same pattern as "Track therapist splits." A clinic that doesn't use informal scheduling shouldn't see an empty section every day.

- Card fields: name, time note (always) + therapist, condition (last known), phone number (extras)
- Tapping a card opens New Visit pre-filled with that patient/name — this is the entry's entire lifecycle; it converts into a real visit the same way any New Visit does.

### Seen today section (inline, routine)
Uses the Shared Visit Card.

### Recently-seen panel (moved off the main scroll, into the collapsed bar above)
List fields: name, last-visit date (always) + condition, last service/package, outstanding balance (extras; **auto-hidden when balance is ₹0** — don't render a ₹0 pill).

Sourced from `dashboardService.recentVisits(clinicId, limit=8)` — already built to this spec.

---

## 3. Patient Profile

1. **Add patient-edit capability — currently missing entirely, both UI and data layer.** Confirmed: no `update` method exists on the patient repository interface (`src/repositories/types.ts`), and no edit affordance exists in `PatientProfilePage.tsx`. This needs a repo-layer mutation added, not just a UI button. Edit action: pencil icon next to the name in the header, opens the same field set as new-patient creation (Name/Age/Sex/Phone always visible, Condition/Referring-source under "more details"). Without this, the "add details later" promise from the new-patient sub-form (see New Visit brief) has nowhere to be fulfilled.
2. **Fix the "New visit" button** (`PatientProfilePage.tsx` line 155) — currently `<Link to="/visits/new">` with no patient context, drops the user on a blank search screen. Pass the patient ID.
3. **Outstanding balance badge in the header** — same auto-hide-at-₹0 rule as Recently-seen.
4. **Reorder on mobile only**: Care plan section above Visit history (desktop/iPad keeps the existing side-by-side grid at `lg:` breakpoint, unchanged).
5. **Visit history table → Shared Visit Card** (see §1), name/avatar omitted.
6. **Heading rename**: `"Recent activity"` → **`"Documentation activity"`** — it only ever shows consultation-note events, not visits or invoices, and the generic name implied broader coverage than it has. Cheaper fix than actually broadening its scope, and Visit History already covers visits separately.
7. **Bulk invoice issuance — lives here, not Archive.** `invoiceService` already supports bundling multiple visit IDs into one invoice (`p_visit_ids: visits.map(...)`), no service-layer change needed. Add checkbox multi-select to the Visit History cards. Because every visit on this page already belongs to the one patient being viewed, the cross-patient constraint that would be needed on Archive is structurally impossible to violate here — no prevention logic required, just multi-select → "Issue invoice for selected."

---

## 4. Archive

1. **Default grouping: This week / Last week / This month / Last month / All.** ("All," not "Older" — functions as clearing the date filter entirely to show the full searchable/paginated list, not a fifth date-bounded bucket.) This intentionally enables week-over-week and month-over-month comparison by scrolling between adjacent groups, without building a separate comparison feature into Recently-seen (that was considered and rejected — see rationale below).
2. **Each group header shows a totals summary** — visit count and bill sum, e.g. "This week · 6 visits · ₹9,000." Restores the existing `VisitsPage.tsx` "Totals (N visits)" footer, repositioned to the group header instead of a table footer since groups replace the old flat table.
3. **Add a "Custom" option alongside the preset tabs** — reveals two date inputs (from/to), same native date-input style as New Visit. Selecting Custom deselects whichever preset tab was active.
4. **Shared Visit Card** (see §1), same as Workspace/Patient Profile.
5. **No bulk invoice issuance on Archive.** Considered and deliberately removed from scope here — it lives only on Patient Profile (§3.7), where the single-patient constraint is structural rather than something the UI has to defensively enforce across multiple patients. Keeps Archive simpler.
6. **Cross-link to Reports, don't merge with it.** Considered and rejected: generating monthly PDF reports directly from Archive. Reports (`reportService.monthly()`, `MonthlyLedgerPrintPage.tsx`) is a fiscal-year-scoped financial document with hospital-share/TDS/therapist-share math and CSV/print-to-PDF already built — a different job from Archive's raw operational browsing. Instead: on Archive's "This month"/"Last month" group headers, add a "View monthly report →" link to the corresponding Reports page for that period.

**Rejected idea, for the record**: adding a "This week/Last week" toggle directly to the Recently-seen strip, with a fuller patient list, to get the same comparison. Rejected because Recently-seen exists specifically to be a lightweight glance strip — the reason "Recent" was removed from Workspace in the first place was that a full browsable table duplicated Archive and bloated the daily view. Putting week/month comparison there would reintroduce exactly that problem. The comparison capability belongs on Archive, the screen built for deliberate browsing.

---

## 5. What's reused vs. genuinely new

**Reused, no backend change:**
- `dashboardService.pendingWork()` — Needs-attention panel
- `dashboardService.recentVisits()` — Recently-seen panel
- `STALE_PACKAGE_DAYS = 14` constant
- `invoiceService`'s existing multi-visit-ID invoice support — Patient Profile bulk action

**New:**
- `expected_visits` lightweight table + UI (Expected today), gated by a new Setup toggle, off by default — **flagging this default as an assumption, not explicitly confirmed; override if you want it on by default instead**
- Patient repository update mutation + edit UI (Patient Profile)
- Patient Profile bulk-select UI for multi-visit invoicing (no cross-patient constraint needed — structurally single-patient)
- Archive date-range grouping tabs, including "All" as filter-clear rather than a bucket
- Shared Visit Card component (built once, used three places)
- SummaryBar + Panel component pair (built once, used twice: Needs-attention, Recently-seen)

---

## 6. Verification

1. Workspace default view (phone) shows only stat pills, the two collapsed bars, Expected today, and Seen today — no Needs-attention or Recently-seen content renders inline.
2. Tapping either collapsed bar opens a dismissible overlay with the correct content; dismissing returns to the default view unchanged.
3. A visit with `clinicalStatus === 'pending'` appears in Needs-attention as "Incomplete note," sourced from the existing `pendingWork()` call.
4. A package with sessions remaining and no visit in 14+ days appears as "Stale package," not as a completion/upsell signal.
5. Editing a patient's phone number from Patient Profile persists and reflects immediately in the header.
6. Patient Profile → New visit → correct patient pre-selected (not a blank search).
7. A patient with ₹0 outstanding shows no balance badge anywhere (Patient Profile, Recently-seen). A patient with a nonzero balance shows it in both places.
8. Patient Profile: an invoice issued from a multi-visit selection contains all selected visits as line items under one invoice number.
9. Archive has no bulk-select or invoice-issuance affordance anywhere.
10. Archive's "All" filter clears date grouping and shows the full list; it is not a fifth date bucket.
11. Care plan renders above Visit history on a phone-width viewport; the existing side-by-side grid is unchanged at desktop width.
12. With the Expected-today Setup toggle off (default), no Expected-today section or count renders anywhere on Workspace.
