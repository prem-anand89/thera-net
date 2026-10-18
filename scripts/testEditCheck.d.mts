export const REASON_TAG: RegExp;
export interface TestDiffFinding { file: string; kind: string; text: string }
export function parseDiff(diffText: string): { path: string; removed: string[]; added: string[]; deleted: boolean }[];
export function analyseTestDiff(diffText: string): {
  findings: TestDiffFinding[];
  onlyViolations: { file: string; text: string }[];
};
export function judgeCommit(input: { diffText: string; message: string; strict: boolean }): {
  ok: boolean;
  warn: boolean;
  problems: string[];
  reason: string | null;
};
