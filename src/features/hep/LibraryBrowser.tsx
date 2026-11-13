// The Library's browsing surface: a side list of regions (with their types underneath), a toolbar (search, equipment,
// type, List | Grid), the active-filter chips, and the results grouped by region then type. Used by the Library tab and
// by the exercise picker, so both look and filter the same way. It shows what the filters leave; the parent decides
// what a tap does (open the form, or tick the exercise).
import { useMemo, useState } from 'react';
import { ChipCount, chipSelect, chipSelectChevron, filterChip, inputCls, segOption, segTrack } from '@/components/ui';
import {
  EXERCISE_PHASES,
  EXERCISE_PHASE_LABELS,
  HEP_PELVIC_FLOOR_MEN,
  HEP_PELVIC_FLOOR_WOMEN,
  isSensitiveExercise,
  regionTree,
  type Exercise,
  type ExercisePhase,
} from '@/domain/hep';
import { doseSummary } from '@/domain/hepDose';
import {
  EMPTY_LIBRARY_FILTER,
  activeFilterChips,
  equipmentInUse,
  filterLibrary,
  groupLibrary,
  regionLabel,
  type LibraryFilter,
  type LibraryRegion,
} from '@/domain/hepLibrary';
import { useThumbUrls } from './useHepData';

const PAGE = 12;

export interface LibraryBrowserProps {
  clinicId: string;
  exercises: Exercise[];
  usedIds: ReadonlySet<string>;
  showArchived?: boolean;
  /** A tap on a row or tile. */
  onActivate: (ex: Exercise) => void;
  /** Picker mode: ticked exercises show a tick, and `disabledIds` (already in the program) cannot be ticked. */
  selected?: ReadonlySet<string>;
  disabledIds?: ReadonlySet<string>;
  /** Library mode: a star on every row. Absent in the picker. */
  onToggleFavorite?: (ex: Exercise) => void;
  /** What to show when the clinic has no exercises at all. */
  emptyState?: React.ReactNode;
}

function Thumb({ ex, url, size }: { ex: Exercise; url: string | undefined; size: number }) {
  const sensitive = isSensitiveExercise(ex);
  const box = { width: size, height: size };
  if (url && !sensitive) {
    return (
      <span className="relative inline-block shrink-0 overflow-hidden rounded-lg bg-[var(--paper)]" style={box}>
        <img src={url} alt="" loading="lazy" className="h-full w-full object-cover" />
        {ex.mediaType === 'gif' && <span className="absolute bottom-0.5 right-0.5 rounded bg-black/60 px-1 text-[10px] font-semibold text-white">GIF</span>}
      </span>
    );
  }
  // A text tile: for pelvic floor exercises (never a picture in a list) and for exercises with no picture yet.
  return (
    <span className="flex shrink-0 flex-col items-center justify-center rounded-lg bg-[var(--paper)] text-[var(--muted)]" style={box} aria-hidden="true">
      <span className="text-base leading-none">{sensitive ? '🔒' : '📄'}</span>
    </span>
  );
}

export function LibraryBrowser({ clinicId, exercises, usedIds, showArchived = false, onActivate, selected, disabledIds, onToggleFavorite, emptyState }: LibraryBrowserProps) {
  const [filter, setFilter] = useState<LibraryFilter>(EMPTY_LIBRARY_FILTER);
  const [view, setView] = useState<'list' | 'grid'>('list');
  const [shown, setShown] = useState(PAGE);
  const [hideEmpty, setHideEmpty] = useState(false);

  const live = useMemo(() => exercises.filter((e) => !e.deleted && (showArchived || e.active)), [exercises, showArchived]);
  const results = useMemo(() => filterLibrary(live, filter, { usedIds, includeArchived: showArchived }), [live, filter, usedIds, showArchived]);
  const tree = useMemo(() => regionTree(live, { includeArchived: showArchived }), [live, showArchived]);
  const equipmentNames = useMemo(() => equipmentInUse(live), [live]);
  const visible = useMemo(() => results.slice(0, shown), [results, shown]);
  const thumbs = useThumbUrls(clinicId, visible);
  const groups = useMemo(() => groupLibrary(visible, filter.region), [visible, filter.region]);

  const set = (patch: Partial<LibraryFilter>) => { setFilter((f) => ({ ...f, ...patch })); setShown(PAGE); };
  const favCount = live.filter((e) => e.isFavorite && e.active).length;
  const usedCount = live.filter((e) => usedIds.has(e.id)).length;
  const chips = activeFilterChips(filter);
  const inPelvic = filter.region === 'Pelvic floor' || filter.region === HEP_PELVIC_FLOOR_WOMEN || filter.region === HEP_PELVIC_FLOOR_MEN;

  const clearChip = (key: string) => {
    if (key === 'region') set({ region: 'All' });
    else if (key === 'phase') set({ phase: 'All' });
    else set({ equipment: filter.equipment.filter((e) => `equip:${e}` !== key) });
  };

  if (live.length === 0 && !showArchived) return <>{emptyState ?? <p className="py-6 text-center text-sm text-[var(--muted)]">No exercises yet.</p>}</>;

  const railRow = (label: string, n: number, region: LibraryRegion, phase: ExercisePhase | 'All' = 'All', sub = false, arrow = '') => {
    const on = filter.region === region && filter.phase === phase;
    const empty = n === 0 && !on;
    return (
      <button
        key={`${region}|${phase}`} type="button" disabled={empty} aria-pressed={on}
        onClick={() => set({ region, phase })}
        className={`flex min-h-8 w-full items-center justify-between rounded-md px-2 py-1 text-left text-sm ${sub ? 'pl-6 text-xs' : ''} ${on ? 'bg-[var(--teal-light)] font-semibold text-[var(--teal-strong)]' : 'text-[var(--ink)] hover:bg-[var(--paper)]'} ${empty ? 'opacity-40' : ''}`}
      >
        <span>{arrow && <span aria-hidden="true">{arrow} </span>}{label}</span><span className="font-num text-xs tabular-nums text-[var(--muted)]">{n}</span>
      </button>
    );
  };

  const rail = (
    <nav aria-label="Regions" className="space-y-0.5">
      {usedIds.size > 0 && railRow('Used this week', usedCount, 'Used')}
      {railRow('★ Favourites', favCount, 'Fav')}
      {railRow('All exercises', live.filter((e) => e.active || showArchived).length, 'All')}
      <div className="my-1.5 border-t border-[var(--border)]" />
      {tree.filter((n) => !hideEmpty || n.count > 0).map((n) => {
        const open = filter.region === n.region || (n.region === 'Pelvic floor' && inPelvic) || (filter.region !== 'All' && n.children?.some((c) => c.region === filter.region));
        return (
          <div key={n.region}>
            {railRow(n.region, n.count, n.region, 'All', false, n.count ? (open ? '▾' : '▸') : '')}
            {open && n.children?.map((c) => railRow(c.region.replace('Pelvic floor: ', ''), c.count, c.region, 'All', true))}
            {open && n.count > 0 && n.region !== 'Pelvic floor' && n.types.map((t) => railRow(EXERCISE_PHASE_LABELS[t.phase], t.count, n.region, t.phase, true))}
            {open && n.region === 'Pelvic floor' && filter.region !== 'Pelvic floor' && tree.find((x) => x.region === 'Pelvic floor')?.children?.find((c) => c.region === filter.region)?.types.map((t) => railRow(EXERCISE_PHASE_LABELS[t.phase], t.count, filter.region, t.phase, true))}
          </div>
        );
      })}
      <div className="my-1.5 border-t border-[var(--border)]" />
      <button type="button" className="px-2 py-1 text-xs text-[var(--muted)] hover:text-[var(--ink)]" onClick={() => setHideEmpty((h) => !h)}>
        {hideEmpty ? 'Show empty regions' : 'Hide empty regions'}
      </button>
    </nav>
  );

  const chipRow = (
    <div className="-mx-1 flex gap-1.5 overflow-x-auto px-1 pb-1 desktop:hidden" role="group" aria-label="Regions">
      {([['Fav', '★', favCount], ['All', 'All', live.length]] as const).map(([r, label, n]) => (
        <button key={r} type="button" aria-pressed={filter.region === r} className={`${filterChip(filter.region === r)} shrink-0`} onClick={() => set({ region: r, phase: 'All' })}>{label}<ChipCount n={n} /></button>
      ))}
      {tree.filter((n) => n.count > 0).map((n) => {
        const on = filter.region === n.region || (n.region === 'Pelvic floor' && inPelvic);
        return <button key={n.region} type="button" aria-pressed={on} className={`${filterChip(on)} shrink-0`} onClick={() => set({ region: n.region, phase: 'All' })}>{n.region}<ChipCount n={n.count} /></button>;
      })}
    </div>
  );

  const toolbar = (
    <div className="flex flex-wrap items-center gap-2">
      <input type="search" aria-label="Search exercises" placeholder="Search exercises" className={`${inputCls} min-w-40 flex-1`} value={filter.query} onChange={(e) => set({ query: e.target.value })} />
      <details className="relative">
        <summary className={`${chipSelect} flex cursor-pointer list-none items-center`} style={chipSelectChevron}>Equipment{filter.equipment.length ? ` (${filter.equipment.length})` : ''}</summary>
        <div className="absolute right-0 z-10 mt-1 max-h-64 w-64 space-y-1 overflow-y-auto rounded-xl border border-[var(--border)] bg-[var(--surface)] p-2 shadow-lg">
          {['None', ...equipmentNames].map((name) => (
            <label key={name} className="flex items-center gap-2 px-1 py-0.5 text-sm text-[var(--ink)]">
              <input type="checkbox" checked={filter.equipment.includes(name)} onChange={(e) => set({ equipment: e.target.checked ? [...filter.equipment, name] : filter.equipment.filter((x) => x !== name) })} />
              {name === 'None' ? 'No equipment' : name}
            </label>
          ))}
        </div>
      </details>
      <select aria-label="Type" className={chipSelect} style={chipSelectChevron} value={filter.phase} onChange={(e) => set({ phase: e.target.value as ExercisePhase | 'All' })}>
        <option value="All">Any type</option>
        {EXERCISE_PHASES.map((p) => <option key={p} value={p}>{EXERCISE_PHASE_LABELS[p]}</option>)}
      </select>
      <div className={segTrack} role="group" aria-label="View">
        <button type="button" aria-pressed={view === 'list'} className={segOption(view === 'list')} onClick={() => setView('list')}>≡ List</button>
        <button type="button" aria-pressed={view === 'grid'} className={segOption(view === 'grid')} onClick={() => setView('grid')}>▦ Grid</button>
      </div>
    </div>
  );

  const activeLine = (chips.length > 0 || filter.query) && (
    <div className="flex flex-wrap items-center gap-1.5" aria-label="Active filters">
      {chips.map((c) => <button key={c.key} type="button" className={filterChip(true)} onClick={() => clearChip(c.key)}>{c.label} ✕</button>)}
      <button type="button" className={filterChip(false)} onClick={() => { setFilter(EMPTY_LIBRARY_FILTER); setShown(PAGE); }}>Clear</button>
      <span className="text-xs text-[var(--muted)]" aria-live="polite">{results.length} {results.length === 1 ? 'exercise' : 'exercises'}</span>
    </div>
  );

  const pick = (ex: Exercise) => (disabledIds?.has(ex.id) ? undefined : onActivate(ex));
  const tick = (ex: Exercise) => selected?.has(ex.id);

  const row = (ex: Exercise) => (
    <li key={ex.id} className={`flex items-center gap-1 rounded-xl border bg-[var(--surface)] ${tick(ex) ? 'border-[var(--teal)] ring-1 ring-[var(--teal)]' : 'border-[var(--border)]'} ${disabledIds?.has(ex.id) ? 'opacity-50' : ''}`}>
      <button type="button" disabled={disabledIds?.has(ex.id)} aria-pressed={selected ? tick(ex) : undefined} onClick={() => pick(ex)} className="flex min-w-0 flex-1 items-center gap-3 p-2 text-left">
        {selected && <span aria-hidden="true" className={`flex h-5 w-5 shrink-0 items-center justify-center rounded border text-xs ${tick(ex) ? 'border-[var(--teal)] bg-[var(--teal)] text-white' : 'border-[var(--border)]'}`}>{tick(ex) ? '✓' : ''}</span>}
        <Thumb ex={ex} url={ex.thumbKey ? thumbs[ex.thumbKey] : undefined} size={52} />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-semibold text-[var(--ink)]">{ex.title}{!ex.active && <span className="ml-2 rounded bg-[var(--paper)] px-1.5 text-xs font-medium text-[var(--muted)]">Archived</span>}</span>
          <span className="block truncate text-xs text-[var(--muted)]">{doseSummary(ex)}</span>
          {disabledIds?.has(ex.id) && <span className="block text-xs text-[var(--muted)]">Already in the program</span>}
        </span>
      </button>
      {onToggleFavorite && (
        <button type="button" aria-label={ex.isFavorite ? `Remove ${ex.title} from favourites` : `Add ${ex.title} to favourites`} aria-pressed={ex.isFavorite} className="min-h-11 min-w-11 text-lg text-[var(--amber-strong)]" onClick={() => onToggleFavorite(ex)}>{ex.isFavorite ? '★' : '☆'}</button>
      )}
    </li>
  );

  const tile = (ex: Exercise) => {
    const url = ex.thumbKey ? thumbs[ex.thumbKey] : undefined;
    const withPicture = !!url && !isSensitiveExercise(ex);
    return (
      <li key={ex.id} className={disabledIds?.has(ex.id) ? 'opacity-50' : ''}>
        <button type="button" disabled={disabledIds?.has(ex.id)} aria-pressed={selected ? tick(ex) : undefined} onClick={() => pick(ex)} className={`block w-full min-w-0 rounded-xl text-left ${tick(ex) ? 'ring-2 ring-[var(--teal)]' : ''}`}>
          {withPicture ? <Thumb ex={ex} url={url} size={96} /> : (
            <span className="flex aspect-square w-full flex-col items-center justify-center rounded-xl bg-[var(--paper)] p-2 text-center"><span className="text-sm font-semibold text-[var(--ink)]">{ex.title}</span></span>
          )}
          {withPicture && <span className="mt-1 block truncate text-xs text-[var(--ink)]">{ex.title}</span>}
          <span className="block truncate text-xs text-[var(--muted)]">{doseSummary(ex)}</span>
        </button>
      </li>
    );
  };

  return (
    <div className="grid gap-4 desktop:grid-cols-[14rem_1fr]">
      <aside className="hidden desktop:block">{rail}</aside>
      <div className="min-w-0 space-y-3">
        {chipRow}
        {toolbar}
        {activeLine}
        {results.length === 0 ? (
          <div className="py-6 text-center text-sm text-[var(--muted)]">
            <p>No matches{filter.region !== 'All' ? ` in ${regionLabel(filter.region === 'Fav' ? 'Favourites' : filter.region)}` : ''}.</p>
            {filter.region !== 'All' && filterLibrary(live, { ...filter, region: 'All' }, { usedIds, includeArchived: showArchived }).length > 0 && (
              <button type="button" className={`${filterChip(false)} mt-2`} onClick={() => set({ region: 'All', phase: 'All' })}>
                {filterLibrary(live, { ...filter, region: 'All', phase: 'All' }, { usedIds, includeArchived: showArchived }).length} in other regions
              </button>
            )}
          </div>
        ) : (
          groups.map((g) => (
            <section key={g.region} aria-label={regionLabel(g.region)} className="space-y-2">
              <h3 className="font-display text-sm font-semibold text-[var(--ink)]">{regionLabel(g.region)}</h3>
              {g.types.map((t) => (
                <div key={t.phase} className="space-y-1.5">
                  <h4 className="text-xs font-semibold uppercase tracking-wide text-[var(--muted)]">{EXERCISE_PHASE_LABELS[t.phase]}</h4>
                  {view === 'grid'
                    ? <ul className="grid grid-cols-3 gap-2 tab:grid-cols-4 desktop:grid-cols-5">{t.exercises.map(tile)}</ul>
                    : <ul className="grid gap-1.5 desktop:grid-cols-2">{t.exercises.map(row)}</ul>}
                </div>
              ))}
            </section>
          ))
        )}
        {results.length > shown && (
          <button type="button" className="min-h-11 rounded-lg border border-[var(--border)] px-4 text-sm font-medium text-[var(--muted)] hover:bg-[var(--paper)]" onClick={() => setShown((n) => n + PAGE)}>
            Show {Math.min(PAGE, results.length - shown)} more
          </button>
        )}
      </div>
    </div>
  );
}
