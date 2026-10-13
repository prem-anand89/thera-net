#!/usr/bin/env bash
# Fast pre-commit check while working: typecheck + lint and tests for changed files only,
# run in parallel. Run `npm run typecheck && npm run lint && npm run test` (and build for
# shared components/routing/Tailwind) once before the final commit of a plan.
set -u
cd "$(dirname "$0")/.."

changed=$( { git diff --name-only HEAD; git ls-files --others --exclude-standard; } | sort -u | grep -E '^src/.*\.(ts|tsx)$' | while read -r f; do [ -f "$f" ] && echo "$f"; done )
if [ -z "$changed" ]; then
  echo "No changed src files; running typecheck only."
  npx tsc --noEmit
  exit $?
fi

tmp=$(mktemp -d)
npx tsc --noEmit >"$tmp/tsc.log" 2>&1 & p1=$!
# shellcheck disable=SC2086
npx eslint $changed >"$tmp/eslint.log" 2>&1 & p2=$!
# shellcheck disable=SC2086
npx vitest related $changed --run --passWithNoTests >"$tmp/vitest.log" 2>&1 & p3=$!

fail=0
for pair in "typecheck:$p1:tsc" "lint:$p2:eslint" "tests:$p3:vitest"; do
  IFS=: read -r name pid log <<<"$pair"
  if wait "$pid"; then echo "PASS  $name"; else echo "FAIL  $name"; tail -40 "$tmp/$log.log"; fail=1; fi
done
rm -rf "$tmp"
exit $fail
