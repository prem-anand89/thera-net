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

## Rule 2: Two-Step Migration Convention

Every database change needs **exactly two things**:
1. **Applied live** via Supabase MCP `execute_sql` or `apply_migration`
2. **Committed to git** in `supabase/migrations/YYYYMMDDNNNNNN_description.sql`

Skipping step 2 means the next agent (or rebuild) cannot reconstruct the current database state. This has caused real bugs in this repo.

---

## Rule 3: TheraNet Architecture Constraints

These are non-negotiable design decisions already established in this codebase:

- **No new npm dependencies without explicit approval.** If you need a phone input or date picker, build it with vanilla HTML/CSS/JS using existing patterns (see existing `chipCls`, `inputCls`, `labelCls` patterns in `BookingFormPage.tsx`).
- **No sixth mobile tab.** The mobile bottom nav is a locked 5-item row. New features go into "More" or an existing tab, never a new tab.
- **All writes are online-only for appointments/bookings.** `appointment_requests` and `appointments` are read-only-synced Dexie tables. Write ONLY via direct Supabase RPC calls, followed by `syncEngine.schedule(0)`.
- **WhatsApp = `wa.me` deep links only.** The Meta Cloud API integration is hidden from UI. Do not re-expose it.
- **Every `<button>` needs an explicit `type` attribute.** (`type="button"`, `type="submit"`, or `type="reset"`). Use `<Button>` wrapper from `src/components/Button.tsx` for new code.
- **CSS = CSS variables only.** All colours must use existing CSS custom properties (e.g. `var(--teal)`, `var(--ink)`, `var(--border)`, `var(--surface)`, `var(--paper)`, `var(--rust)`, `var(--muted)`). Never hardcode hex values.
