# Working rules for Gemini (read before every task)

These rules are enforced by tooling where possible, but follow them anyway.

## Where you work
- You work on `main` in the main checkout, and commit locally. **Never push**: the push URL is disabled
  and the pre-push hook checks; do not use `--no-verify`, do not change remotes. Claude reviews every unpushed
  commit (`git log origin/main..main`) and is the only one who pushes, when the owner asks.
- One agent edits at a time. Start with `git status --short` and `git log --oneline -5`; if there are edits you
  did not make, stop and report. Finish with a CLEAN working tree (everything committed) so Claude can take over.
- Never touch the live database or deploy anything. Write the migration `.sql` file only; Claude applies it.
- Commit small, one task per commit, with `git add <explicit paths>` (never `-A`, never stash, never `reset --hard`).

## Tests
- Adding tests is always fine.
- **Never edit or remove an existing assertion or test to make it pass.** If behaviour changed on purpose, put
  `[test-change: <why, 10+ characters>]` in that commit's message; otherwise the commit is rejected.
  (This applies to every commit on main.)
- No `.only` (blocked), no `.skip`/`.todo` without a `[test-change: ...]` reason.

## Decisions
- A plan's "Decided with the user" block is locked. If your work would change one, STOP and ask. Do not change agreed behaviour and then adjust tests or docs to match.
- Do not invent file or function names. If one named in the task is missing, stop and report it.

## Layout work
- Check every screen you touch at phone (360px) and desktop (1280px). Fixed column widths must add up to less than the content width (about 1120px); a horizontal scrollbar on a table is a bug.

## Finishing a task
1. Commit everything (a dirty tree is "not ready").
2. Run `npm run gemini:report` (add `-- --build` for shared components, routing or Tailwind). It covers every unpushed commit.
3. Paste the contents of `GEMINI_REPORT.md` in your final message, fill in the screenshots / deviations / questions section, and do NOT claim "verified" unless the verdict says ALL GREEN.

## Optional parallel mode
If Gemini and Claude must work at the same time, `scripts/gemini-worktree.sh` gives Gemini its own worktree on `gemini/work`
(push disabled); Claude merges it after review. See `CLAUDE.md`.
