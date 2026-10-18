#!/usr/bin/env node
// Guard against weakened tests. Used by .githooks/commit-msg (staged changes + the message)
// and by scripts/gemini-report.sh (every commit in a range).
//
//   node scripts/check-test-edits.mjs --message-file <file> [--strict]
//   node scripts/check-test-edits.mjs --range main..HEAD [--strict]
//
// Without --strict a problem is only printed (exit 0); with it, a problem fails (exit 1).
// A committed `.only` fails either way.
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { judgeCommit } from './testEditCheck.mjs';

const git = (args) => execFileSync('git', args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
const args = process.argv.slice(2);
const strict = args.includes('--strict');
const valueOf = (flag) => (args.includes(flag) ? args[args.indexOf(flag) + 1] : null);

const testPaths = ['*.test.ts', '*.test.tsx', '*.test.js', '*.test.mjs', '*.spec.ts', '*.spec.tsx'];
let failed = false;

function report(label, result) {
  if (result.problems.length === 0) return;
  console.error(`\n${result.ok ? 'WARNING' : 'BLOCKED'}: ${label}`);
  for (const p of result.problems) console.error(`  - ${p}`);
  if (!result.ok) failed = true;
}

const messageFile = valueOf('--message-file');
const range = valueOf('--range');

if (messageFile) {
  const message = readFileSync(messageFile, 'utf8');
  const diffText = git(['diff', '--cached', '-U0', '--no-color', '--', ...testPaths]);
  report('staged test changes', judgeCommit({ diffText, message, strict }));
} else if (range) {
  const commits = git(['rev-list', '--reverse', range]).split('\n').filter(Boolean);
  for (const sha of commits) {
    const message = git(['log', '-1', '--format=%B', sha]);
    const diffText = git(['show', '-U0', '--no-color', '--format=', sha, '--', ...testPaths]);
    const subject = message.split('\n')[0];
    report(`${sha.slice(0, 7)} ${subject}`, judgeCommit({ diffText, message, strict }));
  }
  if (!failed) console.log(`Test-edit check: ${commits.length} commit(s) in ${range}, no weakened tests.`);
} else {
  console.error('usage: check-test-edits.mjs --message-file <file> | --range <a..b> [--strict]');
  process.exit(2);
}
process.exit(failed ? 1 : 0);
