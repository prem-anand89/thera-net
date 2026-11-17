// The Library's filters, drawn once: on a wide container they stack as a left rail, on a narrower one the same buttons
// wrap as chip rows (region, type, position). Equipment is a menu with counts in both layouts. Counts follow the other filters.
import { useEffect, useRef } from 'react';
import { ChipCount, chipSelect, chipSelectChevron, filterChip } from '@/components/ui';
import { EXERCISE_PHASE_LABELS, EXERCISE_TYPES, HEP_POSITIONS } from '@/domain/hep';
import { regionLabel, type FacetCounts, type LibraryFilter } from '@/domain/hepLibrary';
import { toneVar } from './LibraryParts';

interface Props {
  filter: LibraryFilter;
  counts: FacetCounts;
  showUsed: boolean;
  onChange: (patch: Partial<LibraryFilter>) => void;
}

const RAIL_ROW = 'min-h-8 @[760px]:w-full @[760px]:justify-between @[760px]:rounded-md @[760px]:border-0 @[760px]:bg-transparent @[760px]:px-2 @[760px]:text-sm';

export function LibraryFilters({ filter, counts, showUsed, onChange }: Props) {
  const menu = useRef<HTMLDetailsElement>(null);
  useEffect(() => {
    const close = (e: PointerEvent) => { if (menu.current?.open && !menu.current.contains(e.target as Node)) menu.current.open = false; };
    document.addEventListener('pointerdown', close);
    return () => document.removeEventListener('pointerdown', close);
  }, []);

  const chip = (key: string, label: React.ReactNode, n: number, on: boolean, onClick: () => void, dot?: string) => (
    <button key={key} type="button" aria-pressed={on} disabled={n === 0 && !on} onClick={onClick}
      className={`${filterChip(on)} ${RAIL_ROW} ${on ? '@[760px]:bg-[var(--teal-light)]' : '@[760px]:hover:bg-[var(--paper)]'} shrink-0 disabled:opacity-40`}>
      <span className="inline-flex items-center gap-1.5">
        {dot && <span aria-hidden="true" className="inline-block h-2 w-2 rounded-full" style={{ background: dot }} />}
        {label}
      </span>
      <ChipCount n={n} />
    </button>
  );
  const heading = (t: string) => <p aria-hidden="true" className="hidden px-2 pt-2 text-[11px] font-semibold uppercase tracking-wide text-[var(--muted)] @[760px]:block">{t}</p>;
  const row = 'hide-scrollbar flex gap-1.5 overflow-x-auto pb-1 @[760px]:flex-col @[760px]:gap-0.5 @[760px]:overflow-visible @[760px]:pb-0';

  return (
    <div className="min-w-0 space-y-1.5 @[760px]:space-y-1">
      <div role="group" aria-label="Body region" className={row}>
        {heading('Body region')}
        {showUsed && chip('Used', 'Used this week', counts.used, filter.region === 'Used', () => onChange({ region: filter.region === 'Used' ? 'All' : 'Used' }))}
        {chip('Fav', '★ Favourites', counts.fav, filter.region === 'Fav', () => onChange({ region: filter.region === 'Fav' ? 'All' : 'Fav' }))}
        {counts.regions.map((r) => chip(r.region, regionLabel(r.region), r.n, filter.region === r.region, () => onChange({ region: filter.region === r.region ? 'All' : r.region })))}
      </div>
      <div role="group" aria-label="Type" className={row}>
        {heading('Type')}
        {EXERCISE_TYPES.map((t) => {
          const n = counts.types.find((x) => x.phase === t)?.n ?? 0;
          return chip(t, EXERCISE_PHASE_LABELS[t], n, filter.phase === t, () => onChange({ phase: filter.phase === t ? 'All' : t }), toneVar(t));
        })}
        {(counts.types.find((x) => x.phase === 'other')?.n ?? 0) + (counts.types.find((x) => x.phase === 'warm_up')?.n ?? 0) + (counts.types.find((x) => x.phase === 'cool_down')?.n ?? 0) > 0 &&
          (['warm_up', 'cool_down', 'other'] as const).map((t) => {
            const n = counts.types.find((x) => x.phase === t)?.n ?? 0;
            return n > 0 || filter.phase === t ? chip(t, EXERCISE_PHASE_LABELS[t], n, filter.phase === t, () => onChange({ phase: filter.phase === t ? 'All' : t }), toneVar(t)) : null;
          })}
      </div>
      <div role="group" aria-label="Position" className={row}>
        {heading('Position')}
        {HEP_POSITIONS.map((p) => {
          const n = counts.positions.find((x) => x.position === p)?.n ?? 0;
          return chip(p, p, n, filter.position === p, () => onChange({ position: filter.position === p ? 'All' : p }));
        })}
      </div>
      <details ref={menu} className="relative" onKeyDown={(e) => { if (e.key === 'Escape' && menu.current) menu.current.open = false; }}>
        <summary className={`${chipSelect} flex cursor-pointer list-none items-center`} style={chipSelectChevron}>Equipment{filter.equipment.length ? ` (${filter.equipment.length})` : ''}</summary>
        <div className="absolute left-0 z-10 mt-1 max-h-64 w-64 space-y-1 overflow-y-auto rounded-xl border border-[var(--border)] bg-[var(--surface)] p-2 shadow-lg">
          {counts.equipment.map(({ name, n }) => (
            <label key={name} className="flex items-center gap-2 px-1 py-0.5 text-sm text-[var(--ink)]">
              <input type="checkbox" checked={filter.equipment.includes(name)} onChange={(e) => onChange({ equipment: e.target.checked ? [...filter.equipment, name] : filter.equipment.filter((x) => x !== name) })} />
              <span className="flex-1">{name === 'None' ? 'No equipment' : name}</span>
              <span className="font-num text-xs tabular-nums text-[var(--muted)]">{n}</span>
            </label>
          ))}
        </div>
      </details>
    </div>
  );
}
