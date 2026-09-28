# TheraNet Agent Rules

> These rules apply to ALL agents (Gemini, Claude, etc.) working in this workspace. They are derived from recurring failure patterns observed in this codebase. Violating any rule here is not a quality shortcut — it is creating a bug.

## Rule 1: Evidence Before Assertions (The Iron Rule)

Before stating ANY fact about the database, an RPC, a component's behavior, or a config value, you MUST physically verify it.

**Mandatory checks before claiming:**
- "The RPC returns X" → Run `SELECT prosrc FROM pg_proc WHERE proname = '...'` via the Supabase MCP tool
- "The table has a column Y" → Run `SELECT column_name FROM information_schema.columns WHERE table_name = '...'`
- "The component does Z" → `view_file` the actual component first

**Never rely on:**
- Your memory of a previous session
- What you *expect* the code to do based on the function name
- The implementation plan document (it may be outdated)

The implementation plan is a goal, not a fact. The live database and source files are facts.

---

## Rule 2: Always Update Documentation

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

## Rule 3: Two-Step Migration Convention

Every database change needs **exactly two things**:
1. **Applied live** via Supabase MCP `execute_sql` or `apply_migration`
2. **Committed to git** in `supabase/migrations/YYYYMMDDNNNNNN_description.sql`

Skipping step 2 means the next agent (or rebuild) cannot reconstruct the current database state. This has caused real bugs in this repo.

---

## Rule 4: Diagnose Before Fixing

Do not create workaround solutions (new RPC versions, bypass flags, fallback branches) without first diagnosing the root cause.

**The correct order:**
1. Read the error message carefully
2. Inspect the actual code/RPC that is failing
3. Find the root cause
4. Fix the root cause

**Do not:**
- Create `_v2` versions of RPCs as the first response to a `404`
- Add bypass flags as the first response to browser behaviour issues
- Add `catch` blocks that swallow errors without first understanding what throws them

---

## Rule 5: TheraNet Architecture Constraints

These are non-negotiable design decisions already established in this codebase:

- **No new npm dependencies without explicit approval.** If you need a phone input or date picker, build it with vanilla HTML/CSS/JS using existing patterns (see existing `chipCls`, `inputCls`, `labelCls` patterns in `BookingFormPage.tsx`).
- **No sixth mobile tab.** The mobile bottom nav is a locked 5-item row. New features go into "More" or an existing tab, never a new tab.
- **All writes are online-only for appointments/bookings.** `appointment_requests` and `appointments` are read-only-synced Dexie tables. Write ONLY via direct Supabase RPC calls, followed by `syncEngine.schedule(0)`.
- **WhatsApp = `wa.me` deep links only.** The Meta Cloud API integration is hidden from UI. Do not re-expose it.
- **Every `<button>` needs an explicit `type` attribute.** (`type="button"`, `type="submit"`, or `type="reset"`). Use `<Button>` wrapper from `src/components/Button.tsx` for new code.
- **CSS = CSS variables only.** All colours must use existing CSS custom properties (e.g. `var(--teal)`, `var(--ink)`, `var(--border)`, `var(--surface)`, `var(--paper)`, `var(--rust)`, `var(--muted)`). Never hardcode hex values.

---

## Rule 6: Verify Before Claiming Success

Do not say "this should now work" or "the bug is fixed" without:
1. Running `npm run typecheck && npm run lint` (at minimum)
2. Stating exactly what you verified and how
3. Acknowledging any parts you could NOT verify (e.g., requires browser testing)

If the fix requires browser testing, say exactly: "Please test X by doing Y and look for Z in the console."
