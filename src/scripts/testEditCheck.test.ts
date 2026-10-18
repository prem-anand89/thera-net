import { describe, expect, it } from 'vitest';
import { analyseTestDiff, judgeCommit } from '../../scripts/testEditCheck.mjs';

const diff = (path: string, removed: string[], added: string[], extra = '') =>
  [
    `diff --git a/${path} b/${path}`,
    extra,
    `--- a/${path}`,
    `+++ b/${path}`,
    '@@ -1,3 +1,3 @@',
    ...removed.map((l) => `-${l}`),
    ...added.map((l) => `+${l}`),
  ]
    .filter(Boolean)
    .join('\n');

describe('analyseTestDiff', () => {
  it('lets new tests and new assertions through', () => {
    const d = diff('src/a.test.ts', [], ["  it('adds a thing', () => {", '    expect(add(1, 2)).toBe(3);', '  });']);
    expect(analyseTestDiff(d).findings).toEqual([]);
  });

  it('flags a changed assertion (the "edit the test to match" move)', () => {
    const d = diff('src/a.test.ts', ["    expect(screen.getByText('All done for today')).toBeInTheDocument();"], ["    expect(screen.getByText(/Done today/)).toBeInTheDocument();"]);
    const { findings } = analyseTestDiff(d);
    expect(findings).toHaveLength(1);
    expect(findings[0].kind).toBe('assertion removed or changed');
  });

  it('flags a removed or renamed test case', () => {
    const d = diff('src/a.test.tsx', ["  it('never says 0 seen', () => {"], ["  it('shows the fold', () => {"]);
    expect(analyseTestDiff(d).findings.map((f) => f.kind)).toContain('test case removed or renamed');
  });

  it('ignores lines that were only moved or re-indented', () => {
    const d = diff('src/a.test.ts', ['    expect(a).toBe(1);'], ['        expect(a).toBe(1);']);
    expect(analyseTestDiff(d).findings).toEqual([]);
  });

  it('flags a deleted test file and a newly skipped test, and never a committed .only', () => {
    const del = diff('src/a.test.ts', ["expect(a).toBe(1);"], [], 'deleted file mode 100644');
    expect(analyseTestDiff(del).findings[0].kind).toBe('test file deleted');
    const skip = diff('src/a.test.ts', [], ["it.skip('later', () => {});"]);
    expect(analyseTestDiff(skip).findings[0].kind).toBe('test skipped');
    const only = diff('src/a.test.ts', [], ["it.only('focus', () => {});"]);
    expect(analyseTestDiff(only).onlyViolations).toHaveLength(1);
  });

  it('does not mistake a string that mentions it.only( for a real one', () => {
    const d = diff('src/a.test.ts', [], ["const sample = \"it.only('x', () => {})\";"]);
    expect(analyseTestDiff(d)).toEqual({ findings: [], onlyViolations: [] });
  });

  it('only looks at test files', () => {
    const d = diff('src/a.ts', ['expect(a).toBe(1);'], ['expect(a).toBe(2);']);
    expect(analyseTestDiff(d).findings).toEqual([]);
  });
});

describe('judgeCommit', () => {
  const weakened = diff('src/a.test.ts', ['expect(a).toBe(1);'], ['expect(a).toBe(2);']);

  it('blocks a weakened test on a strict (agent) branch without a reason', () => {
    const r = judgeCommit({ diffText: weakened, message: 'fix stuff', strict: true });
    expect(r.ok).toBe(false);
    expect(r.problems.join('\n')).toMatch(/test-change/);
  });

  it('allows it with a stated reason of at least 10 characters, and not with a lazy one', () => {
    expect(judgeCommit({ diffText: weakened, message: 'x\n\n[test-change: behaviour changed as agreed in plan 3]', strict: true }).ok).toBe(true);
    expect(judgeCommit({ diffText: weakened, message: '[test-change: ok]', strict: true }).ok).toBe(false);
  });

  it('only warns outside agent branches', () => {
    const r = judgeCommit({ diffText: weakened, message: 'fix', strict: false });
    expect(r.ok).toBe(true);
    expect(r.warn).toBe(true);
  });

  it('blocks a committed .only everywhere', () => {
    const only = diff('src/a.test.ts', [], ["it.only('x', () => {});"]);
    expect(judgeCommit({ diffText: only, message: 'x', strict: false }).ok).toBe(false);
  });

  it('is silent for a commit that adds tests', () => {
    const add = diff('src/a.test.ts', [], ["it('new', () => { expect(1).toBe(1); });"]);
    const r = judgeCommit({ diffText: add, message: 'x', strict: true });
    expect(r).toMatchObject({ ok: true, warn: false, problems: [] });
  });
});
