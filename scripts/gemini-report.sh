#!/usr/bin/env bash
# Writes GEMINI_REPORT.md with REAL output: commits, files, typecheck, lint, the full test
# suite, the weakened-test check and (with --build) the production build. Gemini finishes a
# task by running this and pasting the report; "verified" means this file says ALL GREEN.
# It covers every commit that is not on GitHub yet (origin/main..HEAD).
#   npm run gemini:report            # typecheck + lint + tests
#   npm run gemini:report -- --build # plus npm run build
set -u
cd "$(git rev-parse --show-toplevel)"
BASE="${GEMINI_BASE:-origin/main}"  # = every commit not pushed yet (use GEMINI_BASE=main in the optional worktree)
OUT="GEMINI_REPORT.md"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
build=0; [ "${1:-}" = "--build" ] && build=1

results=""
run() { # name command...
  local name="$1"; shift
  local start; start=$(date +%s)
  "$@" >"$TMP/$name.log" 2>&1; local code=$?
  results="$results$name:$code:$(( $(date +%s) - start ))s
"
  eval "code_$name=$code"
}

echo "Running typecheck, lint, tests$([ $build = 1 ] && echo ', build')..."
run typecheck npm run typecheck
run lint npm run lint
run tests npm run test
[ $build = 1 ] && run build npm run build

node scripts/check-test-edits.mjs --range "$BASE..HEAD" --strict >"$TMP/testedits.log" 2>&1; code_testedits=$?
dirty="$(git status --porcelain | grep -v 'GEMINI_REPORT.md' || true)"

{
  echo "# Gemini report"
  echo
  echo "- Generated: $(date -Is)"
  echo "- Branch: $(git rev-parse --abbrev-ref HEAD) @ $(git rev-parse --short HEAD) (base: $BASE)"
  echo
  echo "## Commits ($BASE..HEAD)"
  echo '```'; git log --format='%h %s' "$BASE..HEAD"; echo '```'
  echo
  echo "## Files changed"
  echo '```'; git diff --stat "$BASE...HEAD" | tail -40; echo '```'
  echo
  echo "## Uncommitted changes"
  echo '```'; [ -n "$dirty" ] && echo "$dirty" || echo "(none)"; echo '```'
  echo
  echo "## Checks (real output)"
  echo '| check | exit | time |'; echo '|---|---|---|'
  echo "$results" | while IFS=: read -r n c t; do [ -n "$n" ] && echo "| $n | $c | $t |"; done
  echo "| weakened-test check | $code_testedits | - |"
  echo
  echo "### typecheck"; echo '```'; tail -15 "$TMP/typecheck.log"; echo '```'
  echo "### lint"; echo '```'; tail -15 "$TMP/lint.log"; echo '```'
  echo "### tests"; echo '```'; grep -E "Test Files|Tests |FAIL|✗|×" "$TMP/tests.log" | head -40; echo '```'
  if [ $build = 1 ]; then echo "### build"; echo '```'; tail -12 "$TMP/build.log"; echo '```'; fi
  echo "### weakened-test check"; echo '```'; cat "$TMP/testedits.log"; echo '```'
  echo
  echo "## Gemini fills this in (the verdict above is computed, this part is not)"
  echo "- Screenshots (phone 360px AND desktop) of every screen touched, file paths: ..."
  echo "- Deviations from the plan, and why: ..."
  echo "- Open questions: ..."
  echo "- I did NOT push, did NOT touch the live database, did NOT edit or remove existing assertions without a [test-change: ...] reason: (confirm)"
  echo
  ok=1
  for c in "$code_typecheck" "$code_lint" "$code_tests" "$code_testedits"; do [ "$c" = 0 ] || ok=0; done
  [ $build = 1 ] && [ "${code_build:-1}" != 0 ] && ok=0
  [ -z "$dirty" ] || ok=0
  if [ $ok = 1 ]; then echo "## VERDICT: ALL GREEN"; else echo "## VERDICT: NOT READY (a check failed or changes are uncommitted)"; fi
} >"$OUT"

tail -1 "$OUT"
echo "Report written to $OUT"
grep -q "ALL GREEN" "$OUT"
