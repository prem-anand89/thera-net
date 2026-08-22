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
