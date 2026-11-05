import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Table typography rule (see `cellSub` in ui.tsx): the value a column is about is 14px, a second line under it is 12px.
 * This reads the source and fails when a table cell shows a primary date or amount (ink colour, or no colour) at 12px
 * or smaller, which is how the Patients "Last visit" and "Bill" columns once came to look unlike the Visits table.
 * Secondary lines (muted, or a status colour such as a red "due") are fine.
 */
function sourceFiles(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) sourceFiles(path, out);
    else if (path.endsWith('.tsx') && !path.endsWith('.test.tsx')) out.push(path);
  }
  return out;
}

const SMALL = /\btext-(xs|\[1\dpx\]|caption|hint)\b/;
const STATUS_OR_MUTED = /text-\[var\(--(muted|rust|moss|amber|teal|slate)[^)]*\)\]|\bmuted\b/;

describe('table cell typography', () => {
  it('no primary date or amount in a table cell is set at 12px or smaller', () => {
    const offenders: string[] = [];
    for (const file of sourceFiles('src')) {
      const source = readFileSync(file, 'utf8');
      for (const cell of source.matchAll(/<td\b([^>]*)>([\s\S]*?)<\/td>/g)) {
        const [, attrs, body] = cell;
        const line = source.slice(0, cell.index).split('\n').length;
        // The cell itself small, holding a date or amount that is not styled as secondary.
        const cellClass = /className="([^"]*)"/.exec(attrs)?.[1] ?? '';
        const showsFigure = /format(Amount|Date\w*)\(/.test(body);
        if (showsFigure && SMALL.test(cellClass) && !STATUS_OR_MUTED.test(cellClass)) offenders.push(`${file}:${line} (cell)`);
        // An element inside the cell that formats a date or amount, small, and not styled as secondary.
        for (const el of body.matchAll(/<(?:span|div)\b[^>]*className="([^"]*)"[^>]*>\s*\{?\s*format(?:Amount|Date\w*)\(/g)) {
          if (SMALL.test(el[1]) && !STATUS_OR_MUTED.test(el[1])) offenders.push(`${file}:${line} (${el[1].slice(0, 50)})`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });
});
