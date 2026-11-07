# Working in this repo

Two docs exist so this app can be understood or rebuilt without re-deriving
everything from the code:

- **README.md** — product overview, feature summary, dev setup.
- **FEATURES_AND_SCHEMA.md** — the exhaustive reference: every feature,
  the full database schema, and the key design patterns (revenue-split
  snapshotting, gap-free invoice numbering, RLS model, date-display
  conventions, etc.). This is the one to treat as authoritative when
  rebuilding or onboarding into the codebase cold.

## Keep them current — in the same PR, not a follow-up

Both docs drift the moment a change lands without touching them. Whenever a
change does any of the following, update the relevant section(s) of
**FEATURES_AND_SCHEMA.md** (and README.md if the change is significant
enough to belong in the product overview) as part of that same PR:

- Adds, removes, or materially changes a **feature or business rule** (a
  new Settings toggle, a changed payment/permission rule, a renamed
  document label, a new filter or view).
- Touches the **database schema** — a new/altered/dropped table or column,
  a new RPC, a changed RLS policy.
- Introduces a new **design pattern** worth another session/agent knowing
  about before touching related code (e.g., a new "always compute this
  once, in this one place" rule).

If a change is UI polish with no behavioral/schema implication (spacing,
color, a breakpoint fix), the docs usually don't need touching — use
judgment, but default to updating them when in doubt.

## Migration convention

Every schema change needs **two** things, not one:
1. Applied live via the Supabase MCP tools (or `supabase db push` if working
   locally).
2. A matching file in `supabase/migrations/` (`YYYYMMDDNNNNNN_description.sql`)
   committed to git.

Skipping the second one is schema drift — the live database and the
migration history disagree, and the next person (or the next rebuild) can't
tell what state the schema is actually in. This has been a recurring bug
class in this repo; don't reintroduce it.

The history table must agree too (checked and repaired on 2026-11-08, 174 entries matching the 174 files). The Supabase
`apply_migration` tool records the migration under the **time it was applied**, not the file's version, and the SQL
editor records nothing. So after applying, make `supabase_migrations.schema_migrations` hold the **file's** version and
name (update the version, or insert the row), or a later `supabase db push` will try to run it again. To check: list the
live migrations and compare them with `ls supabase/migrations`.

## Keep the app ready for other countries (no new India-only assumption)

The app is India-only today, but must not get harder to take abroad. In new code:
- **Money:** show amounts with `formatAmount(paise)` and a hand-typed or labelled symbol with `currencySymbol()`, both from `@/domain/money`. Never type `₹` or call `formatINR` (an ESLint error stops both; only `domain/money.ts`, UPI files and tests are exempt). Never rename a `*_paise` column.
- **Phone numbers:** build and compare them through the clinic's country code (`clinicCountryCode`, `splitPhone`), not by assuming +91 or 10 digits.
- **Time:** use the clinic's zone (`clinicTimezone`), not `Asia/Kolkata`.
- **Tax:** do not hard-code GST or TDS wording where a regime could differ (`clinicTaxRegime`, `isGstIndia`).
- **New India-only surface** (UPI, GST/TDS, Indian digit grouping, a rupee-only label): add it to the "India-only surfaces" list in `FEATURES_AND_SCHEMA.md` (section 0e) in the same change.

## Button type attribute — required for HTML compliance

Every `<button>` element **must** have an explicit `type` attribute:
- `type="button"` — generic button, no form action
- `type="submit"` — submits the containing form
- `type="reset"` — resets form fields

Without an explicit type, buttons default to `type="submit"`, causing
unexpected form submission when clicked. This is caught by:
- ESLint rule `custom/button-has-type` (warns on missing types)
- Pre-commit hook via lint-staged (auto-fixes with ESLint)
- TypeScript if using the `Button` wrapper component
  (`src/components/Button.tsx`)

**Recommended:** Use `<Button type="button">` for new code rather than raw
`<button>` tags. The wrapper enforces type at the TypeScript level.

## Verification before committing

Run before every commit that touches `src/`:
```
npm run typecheck && npm run lint && npm run test
```
(`npm run test` is already non-watch — `vitest run` in `package.json` —
so no extra `-- --run` flag is needed.) `npm run build` too for anything
touching shared components, routing, or Tailwind config (breakpoints,
theme tokens). CI (`.github/workflows/ci.yml`) runs these same four
checks as separate steps rather than one chained command, so a failure
shows exactly which one broke.

The pre-commit hook automatically lints and fixes files before commit, so
button type issues will be caught before they reach the PR.
