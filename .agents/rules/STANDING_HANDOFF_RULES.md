# Standing Handoff Rules & Fast Verification Cadence

> Mandatory directives for all agent pairing and task execution in TheraNet. Derived from master plan standing handoff specifications.

## 1. Core Workflow Rules
1. **Start of Task / Turn:** Run `git status --short` and `git log --oneline -5`. If unexpected edits exist in a file you need, stop and report; do not overwrite them.
2. **Git Hygiene on `main`:**
   - Small, logical commits with conventional commit messages (`feat(...)`, `fix(...)`, `docs(...)`, `test(...)`, `refactor(...)`).
   - Stage ONLY with explicit paths: `git add <file1> <file2>`.
   - **NEVER** use `git add -A` or `git add .`.
   - **NEVER** use `git stash`, `git reset --hard`, `git checkout -- <file>`, `git push`, `--force`, or `--no-verify`.
3. **Database Safety:**
   - **Never touch the live database.** Do NOT apply migrations or execute SQL against live Supabase during feature execution.
   - For any schema change or RPC, **only create the migration file** at `supabase/migrations/YYYYMMDDNNNNNN_name.sql`.
   - Client code must defensively handle new columns/tables being missing until applied (`value ?? default`).
   - Claude reviews and applies migrations to the live database.
4. **Accuracy & No Inventions:**
   - If a file, function, prop, or type name does not exist, stop and report immediately. Never invent alternative names.
   - Service functions return **camelCase** objects. Verify return types before writing mocks.
5. **Test-Driven Development (TDD):**
   - Write tests first, verify they fail for the right reason, implement code, and verify they pass.
6. **UI & Accessibility Standards:**
   - Every `<button>` must have an explicit `type` attribute (`type="button"` unless submitting).
   - Form fields must have `<label htmlFor>` matching `<input id>`, `aria-invalid`, `aria-describedby` pointing to error IDs, and `aria-label` for icon-only buttons.
   - Touch targets must be at least 44px (`min-h-11`).
   - Colors must strictly use CSS custom variables (`var(--ink)`, `var(--teal)`, `var(--surface)`, `var(--border)`, etc.). Never hardcode hex values.
7. **Documentation in the Same Commit:**
   - Update `FEATURES_AND_SCHEMA.md` (and `README.md` if significant) in the same change as feature or schema changes.
   - Notice: `FEATURES_AND_SCHEMA.md` contains duplicate sections. Always `grep -n` headings to update **all copies**.
8. **Plan File Protection:**
   - Never edit or delete plan files in `~/.claude/plans/`. Claude manages them.
9. **Evidence Before Assertions:**
   - Never state or report that code is verified without running the commands and pasting real output tails.

---

## 2. Verification Cadence (Speed Optimization)
1. **During a Task (Fast Loop):**
   - Run `npm run check:fast` (runs `tsc --noEmit`, ESLint on changed files, and `vitest related` on changed files in parallel).
   - **Do NOT** run the entire test suite (940+ tests) or `npm run build` per task.
2. **End of a Plan (Full Gate):**
   - Run `npm run typecheck`, `npm run lint`, and `npm run test` in parallel.
   - Run `npm run build` **only** if shared components, routing, or Tailwind config changed.
   - **Do NOT** re-run the full suite after a documentation-only commit.
3. **Plan Completion Report Format:**
   - Commits list (`hash + message`).
   - Files changed (`git diff --stat`).
   - Output tails of the verification commands.
   - Deviations & skipped items.
   - Open questions or unexpected findings.
   - Paths of unapplied migration files created.
