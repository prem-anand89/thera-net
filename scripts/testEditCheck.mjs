// Detects commits that WEAKEN existing tests: removed or changed assertions, removed test
// cases, deleted test files, newly skipped tests, or a committed `.only`. Pure and
// dependency-free so it can be unit tested (see src/scripts/testEditCheck.test.ts).
//
// Why: an agent that changes behaviour and then edits the failing test to match has hidden
// the one signal that something broke. Adding tests is always free; changing or removing
// existing ones needs a stated reason: [test-change: <why>] in the commit message.

const TEST_FILE = /(\.test\.[cm]?[jt]sx?|\.spec\.[cm]?[jt]sx?)$/;
const ASSERT = /\b(expect|assert\w*)\s*\(|\.should\b/;
const CASE = /^(it|test|describe)(\.each)?\s*[(`]/;
// Anchored to the start of the statement so a string that merely mentions `it.only(` isn't a hit.
const SKIP = /^((it|test|describe)\.(skip|todo|fails)\b|(xit|xtest|xdescribe)\s*\()/;
const ONLY = /^((it|test|describe)\.only\b|(fit|fdescribe)\s*\()/;

export const REASON_TAG = /\[test-change:\s*(.{10,}?)\s*\]/i;

/** Parses a unified diff (-U0 is enough) into per-file removed/added lines. */
export function parseDiff(diffText) {
  const files = [];
  let current = null;
  for (const line of diffText.split('\n')) {
    if (line.startsWith('diff --git ')) {
      const m = /^diff --git a\/(.+?) b\/(.+)$/.exec(line);
      current = { path: m ? m[2] : line, removed: [], added: [], deleted: false };
      files.push(current);
    } else if (!current) {
      continue;
    } else if (line.startsWith('deleted file mode')) {
      current.deleted = true;
    } else if (line.startsWith('--- ') || line.startsWith('+++ ')) {
      continue;
    } else if (line.startsWith('-')) {
      current.removed.push(line.slice(1));
    } else if (line.startsWith('+')) {
      current.added.push(line.slice(1));
    }
  }
  return files;
}

/** @returns {{ findings: {file: string, kind: string, text: string}[], onlyViolations: {file: string, text: string}[] }} */
export function analyseTestDiff(diffText) {
  const findings = [];
  const onlyViolations = [];
  for (const file of parseDiff(diffText)) {
    if (!TEST_FILE.test(file.path)) continue;
    if (file.deleted) {
      findings.push({ file: file.path, kind: 'test file deleted', text: file.path });
      continue;
    }
    // A line that was merely moved or re-indented appears on both sides and is not a change.
    const addedCounts = new Map();
    for (const a of file.added) {
      const t = a.trim();
      addedCounts.set(t, (addedCounts.get(t) ?? 0) + 1);
    }
    for (const r of file.removed) {
      const t = r.trim();
      if (!ASSERT.test(t) && !CASE.test(t)) continue;
      const left = addedCounts.get(t) ?? 0;
      if (left > 0) {
        addedCounts.set(t, left - 1);
        continue;
      }
      findings.push({
        file: file.path,
        kind: CASE.test(t) ? 'test case removed or renamed' : 'assertion removed or changed',
        text: t,
      });
    }
    for (const a of file.added) {
      const t = a.trim();
      if (ONLY.test(t)) onlyViolations.push({ file: file.path, text: t });
      else if (SKIP.test(t)) findings.push({ file: file.path, kind: 'test skipped', text: t });
    }
  }
  return { findings, onlyViolations };
}

/** Decides pass/fail for one commit. `strict` = block (agent branches); otherwise only warn. */
export function judgeCommit({ diffText, message, strict }) {
  const { findings, onlyViolations } = analyseTestDiff(diffText);
  const reason = REASON_TAG.exec(message ?? '');
  const problems = [];
  for (const o of onlyViolations) problems.push(`${o.file}: committed .only (${o.text}) is never allowed`);
  if (findings.length > 0 && !reason) {
    for (const f of findings) problems.push(`${f.file}: ${f.kind}: ${f.text}`);
    problems.push('Existing tests were weakened. If this is intended, add [test-change: <why, 10+ characters>] to the commit message.');
  }
  const blocked = problems.length > 0 && (strict || onlyViolations.length > 0);
  return { ok: !blocked, warn: problems.length > 0 && !blocked, problems, reason: reason ? reason[1] : null };
}
