// TheraNet Library > Coverage (curators only): exercises per body region and type, with how many have pictures.
// Empty cells are tinted so the gaps to fill stand out. The table scrolls inside its own box on a phone.
import { useMemo } from 'react';
import { EXERCISE_PHASE_LABELS, EXERCISE_TYPES, type StarterLibraryItem } from '@/domain/hep';
import { coverageGrid, type CoverageCell } from '@/domain/hepCoverage';

function Cell({ cell, strong = false }: { cell: CoverageCell; strong?: boolean }) {
  if (cell.total === 0) return <td className="bg-[var(--rust)]/10 px-2 py-1.5 text-center text-xs text-[var(--muted)]" aria-label="none">–</td>;
  return (
    <td className="px-2 py-1.5 text-center">
      <span className={`block text-sm ${strong ? 'font-semibold' : 'font-medium'} text-[var(--ink)]`}>{cell.total}</span>
      <span className="block text-[11px] text-[var(--muted)]">{cell.withPictures} with pictures</span>
    </td>
  );
}

export function LibraryCoverage({ items }: { items: StarterLibraryItem[] }) {
  const grid = useMemo(() => coverageGrid(items), [items]);
  return (
    <div className="space-y-3">
      <p className="text-sm text-[var(--muted)]" role="status">
        {grid.total} {grid.total === 1 ? 'exercise' : 'exercises'} in the library · {grid.withPictures} with pictures. Shaded cells have no exercises yet.
      </p>
      <div className="overflow-x-auto rounded-lg border border-[var(--border)]">
        <table className="w-full min-w-[34rem] border-collapse text-left">
          <caption className="sr-only">Exercises in the TheraNet Library by body region and type</caption>
          <thead className="bg-[var(--paper)]">
            <tr>
              <th scope="col" className="sticky left-0 bg-[var(--paper)] px-2 py-1.5 text-xs font-semibold text-[var(--muted)]">Region</th>
              {EXERCISE_TYPES.map((t) => <th key={t} scope="col" className="px-2 py-1.5 text-center text-xs font-semibold text-[var(--muted)]">{EXERCISE_PHASE_LABELS[t]}</th>)}
              <th scope="col" className="px-2 py-1.5 text-center text-xs font-semibold text-[var(--muted)]">All</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[var(--border)]">
            {grid.rows.map((row) => (
              <tr key={row.region}>
                <th scope="row" className="sticky left-0 bg-[var(--surface)] px-2 py-1.5 text-sm font-medium text-[var(--ink)]">{row.region}</th>
                {EXERCISE_TYPES.map((t) => <Cell key={t} cell={row.cells[t]} />)}
                <Cell cell={row} strong />
              </tr>
            ))}
          </tbody>
          <tfoot className="border-t border-[var(--border)] bg-[var(--paper)]">
            <tr>
              <th scope="row" className="sticky left-0 bg-[var(--paper)] px-2 py-1.5 text-sm font-semibold text-[var(--ink)]">All regions</th>
              {EXERCISE_TYPES.map((t) => <Cell key={t} cell={grid.columns[t]} strong />)}
              <Cell cell={{ total: grid.total, withPictures: grid.withPictures }} strong />
            </tr>
          </tfoot>
        </table>
      </div>
    </div>
  );
}
