#!/usr/bin/env bash
# OPTIONAL. By default Gemini works on main in the main checkout (see CLAUDE.md). Use this only
# when Gemini and Claude must work IN PARALLEL: Gemini gets its own worktree on gemini/work, so it
# can never touch the main checkout or push, and Claude reviews `main..gemini/work` before anything lands.
#
#   scripts/gemini-worktree.sh setup    create ../thera-net-gemini (push disabled, deps installed)
#   scripts/gemini-worktree.sh status   where gemini/work is relative to main
#   scripts/gemini-worktree.sh review   commits, files and the test-edit check for main..gemini/work
#   scripts/gemini-worktree.sh merge    (Claude, after review) rebase onto main and fast-forward main. Never pushes.
#   scripts/gemini-worktree.sh sync     point gemini/work back at main once everything is merged
set -euo pipefail

ROOT="$(cd "$(git rev-parse --git-common-dir)/.." && pwd)"
WT="$(dirname "$ROOT")/thera-net-gemini"
BR="gemini/work"
cd "$ROOT"

exists() { git worktree list --porcelain | grep -q "^worktree $WT\$"; }

case "${1:-}" in
  setup)
    if exists; then echo "Worktree already exists at $WT"; exit 0; fi
    git worktree add -B "$BR" "$WT" main
    git config extensions.worktreeConfig true
    # Belt and braces: the pre-push hook also refuses gemini/* and this path.
    git -C "$WT" config --worktree remote.origin.pushurl "DISABLED-gemini-cannot-push"
    [ -f "$ROOT/.env" ] && cp "$ROOT/.env" "$WT/.env"
    (cd "$WT" && npm ci)
    echo
    echo "Ready: open $WT in the Gemini IDE (branch $BR). Push is disabled there."
    ;;
  status)
    exists || { echo "No worktree. Run: scripts/gemini-worktree.sh setup"; exit 1; }
    echo "Worktree: $WT"
    echo "Branch:   $(git -C "$WT" rev-parse --abbrev-ref HEAD)"
    echo "Ahead of main:  $(git rev-list --count main.."$BR") commit(s)"
    echo "Behind main:    $(git rev-list --count "$BR"..main) commit(s)"
    if [ -n "$(git -C "$WT" status --porcelain)" ]; then echo "Uncommitted changes in the worktree:"; git -C "$WT" status --short; else echo "Worktree clean."; fi
    ;;
  review)
    exists || { echo "No worktree."; exit 1; }
    echo "== commits"; git log --format='%h %s' main.."$BR"
    echo; echo "== files"; git diff --stat main..."$BR" | tail -40
    echo; echo "== weakened-test check"
    node scripts/check-test-edits.mjs --range main.."$BR" --strict || true
    ;;
  merge)
    exists || { echo "No worktree."; exit 1; }
    [ -z "$(git -C "$WT" status --porcelain)" ] || { echo "Worktree has uncommitted changes; ask Gemini to commit or discard them."; exit 1; }
    [ -z "$(git status --porcelain --untracked-files=no)" ] || { echo "Main checkout has uncommitted changes; commit or stash first."; exit 1; }
    git -C "$WT" rebase main
    git merge --ff-only "$BR"
    echo "Merged $BR into main (local only, not pushed)."
    ;;
  sync)
    exists || { echo "No worktree."; exit 1; }
    [ -z "$(git -C "$WT" status --porcelain)" ] || { echo "Worktree has uncommitted changes; not syncing."; exit 1; }
    if [ -n "$(git rev-list main.."$BR")" ]; then echo "gemini/work has commits not in main. Merge or discard them first."; exit 1; fi
    git -C "$WT" checkout -B "$BR" main
    echo "gemini/work is now at main."
    ;;
  *)
    sed -n '2,10p' "$0"; exit 2 ;;
esac
