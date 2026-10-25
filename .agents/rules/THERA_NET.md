---
trigger: always_on
---

# TheraNet Specific Agent Rules

> These rules apply to ALL agents (Gemini, Claude, etc.) working in the TheraNet workspace. They are derived from recurring failure patterns observed in this codebase. Violating any rule here is not a quality shortcut — it is creating a bug.

## Rule 1: Always Update Documentation

This project has two canonical docs: `FEATURES_AND_SCHEMA.md` and `README.md`. Per `CLAUDE.md`, they must be updated in the **same change** as any:
- New database column or table
- New or modified RPC
- New feature or changed business rule
- New design pattern

**Before closing any task that touches the database or adds a feature, you MUST:**
1. Update the relevant section of `FEATURES_AND_SCHEMA.md`
2. Commit the migration file to `supabase/migrations/` (see Migration Rule below)

If you do not do this, you have introduced schema drift — a known recurring bug class in this repo.

---

## Rule 2: Database Migration Convention

Every database change needs to be **committed to git** in `supabase/migrations/YYYYMMDDNNNNNN_description.sql`.
- During agent feature execution, **never apply migrations or execute SQL against live Supabase directly**; write the migration file and report its path. Claude reviews and applies migrations to live Supabase.
- Application code must be written defensively to tolerate new columns/tables being missing until applied (`value ?? default`).

---

## Rule 3: TheraNet Architecture Constraints

These are non-negotiable design decisions already established in this codebase:

- **No new npm dependencies without explicit approval.** If you need a phone input or date picker, build it with vanilla HTML/CSS/JS using existing patterns (see existing `chipCls`, `inputCls`, `labelCls` patterns in `BookingFormPage.tsx`).
- **No sixth mobile tab.** The mobile bottom nav is a locked 5-item row. New features go into "More" or an existing tab, never a new tab.
- **All writes are online-only for appointments/bookings.** `appointment_requests` and `appointments` are read-only-synced Dexie tables. Write ONLY via direct Supabase RPC calls, followed by `syncEngine.schedule(0)`.
- **WhatsApp = `wa.me` deep links only.** The Meta Cloud API integration is hidden from UI. Do not re-expose it.
- **Never use "MRN" or "MRNO" in user-facing text.** The app discarded that terminology: say "Patient ID" or just show `{patient.mrno}`. The one exception is the import flow, where "MRNO" is the literal column header in the spreadsheet users upload (`ImportVisitsPage.tsx`, `xlsxReader.ts`) — leave that as is. Wherever else you find it while working nearby (e.g. the `SingleVisitPatientsCard` search placeholder, the Help dialog), replace it.
- **In an edit or form dialog, a destructive action (Delete) must never sit beside the primary Save/Submit button in the footer.** Place it as a quiet action (e.g. a red text link) at the bottom of the body, with a confirmation that says what will be removed. (A confirmation dialog whose whole purpose is the delete may, of course, have Delete as its main button.)
- **Errors must be visible inside modals/dialogs.** Render errors inside the dialog using `<ErrorNote>` above the footer; never pass errors to parent state that can be swallowed (`const [, setError]` discards them). When you touch a dialog that still takes a `setError` prop from its parent, move the message inside it.
- **Check `FEATURES_AND_SCHEMA.md` before UI designs.** Always cross-reference canonical docs and existing components (`ServiceRows`, `BillAdjustmentFields`, `PhoneField`) rather than inventing generic inputs or assumptions.
- **Every `<button>` needs an explicit `type` attribute.** (`type="button"`, `type="submit"`, or `type="reset"`). Use `<Button>` wrapper from `src/components/Button.tsx` for new code.
- **CSS = CSS variables only.** All colours must use existing CSS custom properties (e.g. `var(--teal)`, `var(--ink)`, `var(--border)`, `var(--surface)`, `var(--paper)`, `var(--rust)`, `var(--muted)`). Never hardcode hex values. (`text-white` on a `var(--teal)` button is the established pattern and is fine.)
- **Vocabulary is fixed.** On a service row: "Done by" (who did it, gets its money) and "Share" (a colleague who helped gets a % of it). Never "helper", "assistant" or "co-therapist" as UI labels. A split that someone edited reads "Set manually" (not "Set by hand"). Patients have a "Patient ID".
- **Money and attribution maths live in one place.** Revenue shares go through `autoCredits` / `rebalanceCredits` in `src/domain/visitLines.ts`; package and therapist-to-therapist attribution through `src/domain/payBase.ts`. Never compute a therapist's share in a component or a service.
- **Check who else uses a shared component or style before changing it.** `MultiToggle`, `ui.tsx` classes, `SegmentedToggle`, `ServiceRows`, `BillAdjustmentFields` are used on several screens (New Visit and Edit visit at least). `grep` the usages first, and change a screen's look with a prop or a local class, not by editing the shared one, unless the owner asked for it everywhere.
- **Resetting a form resets its unsaved-changes guard.** Anything that puts a form back to blank (e.g. "Another visit" after saving) must also clear `touchedRef` in `NewVisitPage`, or the guard compares with the form the page opened with and shows false "Discard?" prompts. A screen must not look edited when the user has not touched it.
- **A new migration's number must be later than the newest file in `supabase/migrations/`.** Check with `ls supabase/migrations | tail -3` before naming it.
