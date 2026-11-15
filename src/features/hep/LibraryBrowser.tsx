// The Library's browsing surface: filters (a left rail on a wide container, chip rows on a narrower one), search, sort,
// a Grid | Table switch, removable filter chips, and one flat result set. Used by the Library tab and the exercise picker.
// It shows what the filters leave; the parent decides what a tap does (open the form, or tick the exercise).
// The root is a container (`@container`), so grid / table / rows follow its width, also inside the picker sheet.
import { useMemo, useState } from 'react';
import { EXERCISE_TYPES, canonicalRegion, type Exercise } from '@/domain/hep';
import { chipSelect, chipSelectChevron, filterChip, inputCls, segOption, segTrack } from '@/components/ui';
import { doseSummary } from '@/domain/hepDose';
import {
  EMPTY_LIBRARY_FILTER,
  activeFilterChips,
  facetCounts,
  filterLibrary,
  regionLabel,
  sortLibrary,
  type LibraryFilter,
  type LibrarySort,
} from '@/domain/hepLibrary';
import { LibraryFilters } from './LibraryFilters';
import { Thumb, TypeTag, exerciseFacts } from './LibraryParts';
import { LibraryTable, type ColumnSort } from './LibraryTable';
import { useThumbUrls } from './useHepData';

const PAGE = 24;
const VIEW_KEY = 'hep-library-view';
type View = 'grid' | 'table';

function readView(): View {
  try { return localStorage.getItem(VIEW_KEY) === 'table' ? 'table' : 'grid'; } catch { return 'grid'; }
}

export interface LibraryBrowserProps {
  clinicId: string;
  exercises: Exercise[];
  usedIds: ReadonlySet<string>;
  /** How many times each exercise was prescribed ({} offline). Drives "Most used" and the Used column. */
  useCounts?: Record<string, number>;
  showArchived?: boolean;
  /** A tap on a card or row. */
  onActivate: (ex: Exercise) => void;
  /** Picker mode: ticked exercises show a tick, and `disabledIds` (already in the program) cannot be ticked. */
  selected?: ReadonlySet<string>;
  disabledIds?: ReadonlySet<string>;
  /** The picker shows the grid only. */
  fixedView?: 'grid';
  /** Library mode: a star on every card and row. Absent in the picker. */
  onToggleFavorite?: (ex: Exercise) => void;
  /** What to show when the clinic has no exercises at all. */
  emptyState?: React.ReactNode;
  /** Under "No matches" when something was typed (the picker offers "+ New exercise" here). */
  renderNoMatches?: (query: string) => React.ReactNode;
}

const NO_COUNTS: Record<string, number> = {};
const phaseRank = (p: string) => { const i = (EXERCISE_TYPES as readonly string[]).indexOf(p); return i === -1 ? EXERCISE_TYPES.length : i; };

export function LibraryBrowser({ clinicId, exercises, usedIds, useCounts = NO_COUNTS, showArchived = false, onActivate, selected, disabledIds, fixedView, onToggleFavorite, emptyState, renderNoMatches }: LibraryBrowserProps) {
  const [filter, setFilter] = useState<LibraryFilter>(EMPTY_LIBRARY_FILTER);
  const [view, setViewState] = useState<View>(fixedView ?? readView);
  const [sort, setSort] = useState<LibrarySort>('used');
  const [colSort, setColSort] = useState<ColumnSort | null>(null);
  const [shown, setShown] = useState(PAGE);

  const live = useMemo(() => exercises.filter((e) => !e.deleted && (showArchived || e.active)), [exercises, showArchived]);
  const opts = useMemo(() => ({ usedIds, includeArchived: showArchived }), [usedIds, showArchived]);
  const results = useMemo(() => {
    const base = sortLibrary(filterLibrary(live, filter, opts), sort, useCounts);
    if (colSort === 'region') return [...base].sort((a, b) => canonicalRegion(a.bodyRegion).localeCompare(canonicalRegion(b.bodyRegion)));
    if (colSort === 'type') return [...base].sort((a, b) => phaseRank(a.phase) - phaseRank(b.phase));
    return base;
  }, [live, filter, opts, sort, useCounts, colSort]);
  const counts = useMemo(() => facetCounts(live, filter, opts), [live, filter, opts]);
  const visible = useMemo(() => results.slice(0, shown), [results, shown]);
  const thumbs = useThumbUrls(clinicId, visible);

  const set = (patch: Partial<LibraryFilter>) => { setFilter((f) => ({ ...f, ...patch })); setShown(PAGE); };
  const chips = activeFilterChips(filter);
  const setView = (v: View) => { setViewState(v); try { localStorage.setItem(VIEW_KEY, v); } catch { /* not remembered */ } };
  const clearChip = (key: string) => {
    if (key === 'region') set({ region: 'All' });
    else if (key === 'phase') set({ phase: 'All' });
    else if (key === 'position') set({ position: 'All' });
    else set({ equipment: filter.equipment.filter((e) => `equip:${e}` !== key) });
  };
  const columnSort = (s: ColumnSort) => {
    setColSort(s);
    if (s === 'az' || s === 'used') setSort(s);
  };

  if (live.length === 0 && !showArchived) return <>{emptyState ?? <p className="py-6 text-center text-sm text-[var(--muted)]">No exercises yet.</p>}</>;

  const off = (ex: Exercise) => !!disabledIds?.has(ex.id);
  const tick = (ex: Exercise) => !!selected?.has(ex.id);

  const card = (ex: Exercise) => {
    const url = ex.thumbKey && !ex.hidePicturesInLists ? thumbs[ex.thumbKey] : undefined;
    return (
      <li key={ex.id} className={`relative rounded-xl border bg-[var(--surface)] ${tick(ex) ? 'border-[var(--teal)] ring-2 ring-[var(--teal)]' : 'border-[var(--border)]'} ${off(ex) ? 'opacity-50' : ''}`}>
        <button type="button" data-exercise={ex.id} disabled={off(ex)} aria-pressed={selected ? tick(ex) : undefined} onClick={() => onActivate(ex)} className="block w-full min-w-0 space-y-1 p-2 text-left">
          <Thumb ex={ex} url={url} ratio="aspect-[4/3]" />
          <span className="block line-clamp-2 min-h-[2.5rem] text-sm font-semibold leading-snug text-[var(--ink)]">
            {ex.title}{!ex.active && <span className="ml-2 rounded bg-[var(--paper)] px-1.5 text-xs font-medium text-[var(--muted)]">Archived</span>}
          </span>
          <span className="block text-xs text-[var(--ink)]"><TypeTag phase={ex.phase} /></span>
          <span className="block line-clamp-2 text-xs text-[var(--muted)]">{exerciseFacts(ex)}</span>
          <span className="block line-clamp-2 text-xs text-[var(--ink)]">{doseSummary(ex)}</span>
        </button>
        {off(ex) && <span className="absolute left-3 top-3 rounded bg-[var(--ink)] px-1.5 py-0.5 text-[11px] font-semibold text-white">In program</span>}
        {tick(ex) && <span aria-hidden="true" className="absolute left-3 top-3 flex h-5 w-5 items-center justify-center rounded bg-[var(--teal)] text-xs text-white">✓</span>}
        {onToggleFavorite && (
          <button type="button" aria-label={ex.isFavorite ? `Remove ${ex.title} from favourites` : `Add ${ex.title} to favourites`} aria-pressed={ex.isFavorite} className="absolute right-1 top-1 min-h-11 min-w-11 rounded-full text-lg text-[var(--amber-strong)]" onClick={() => onToggleFavorite(ex)}>{ex.isFavorite ? '★' : '☆'}</button>
        )}
      </li>
    );
  };

  const otherRegions = filter.region !== 'All' ? filterLibrary(live, { ...filter, region: 'All' }, opts).length : 0;

  return (
    <div className="@container">
      <div className="grid gap-3 @[760px]:grid-cols-[13rem_1fr] @[760px]:gap-4">
        <aside aria-label="Filters"><LibraryFilters filter={filter} counts={counts} showUsed={usedIds.size > 0} onChange={set} /></aside>
        <div className="min-w-0 space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <input type="search" aria-label="Search exercises" placeholder="Search exercises" className={`${inputCls} min-w-40 flex-1`} value={filter.query} onChange={(e) => set({ query: e.target.value })} />
            <select aria-label="Sort" className={chipSelect} style={chipSelectChevron} value={sort} onChange={(e) => { setSort(e.target.value as LibrarySort); setColSort(null); }}>
              <option value="used">Most used</option>
              <option value="az">A–Z</option>
              <option value="recent">Recently added</option>
            </select>
            {!fixedView && (
              <div className={segTrack} role="group" aria-label="View">
                <button type="button" aria-pressed={view === 'grid'} className={segOption(view === 'grid')} onClick={() => setView('grid')}>Grid</button>
                <button type="button" aria-pressed={view === 'table'} className={segOption(view === 'table')} onClick={() => setView('table')}>Table</button>
              </div>
            )}
          </div>
          {(chips.length > 0 || filter.query) && (
            <div className="flex flex-wrap items-center gap-1.5" aria-label="Active filters">
              {chips.map((c) => <button key={c.key} type="button" className={filterChip(true)} onClick={() => clearChip(c.key)}>{c.label} ✕</button>)}
              <button type="button" className={filterChip(false)} onClick={() => { setFilter(EMPTY_LIBRARY_FILTER); setShown(PAGE); }}>Clear all</button>
              <span className="text-xs text-[var(--muted)]" aria-live="polite">{results.length} {results.length === 1 ? 'exercise' : 'exercises'}</span>
            </div>
          )}
          {results.length === 0 ? (
            <div className="py-6 text-center text-sm text-[var(--muted)]">
              <p>No matches{filter.region !== 'All' ? ` in ${regionLabel(filter.region === 'Fav' ? 'Favourites' : filter.region)}` : ''}.</p>
              {otherRegions > 0 && <button type="button" className={`${filterChip(false)} mt-2`} onClick={() => set({ region: 'All' })}>{otherRegions} in other regions</button>}
              {filter.query.trim() && renderNoMatches?.(filter.query.trim())}
            </div>
          ) : view === 'table' && !fixedView ? (
            <LibraryTable rows={visible} thumbs={thumbs} useCounts={useCounts} selected={selected} disabledIds={disabledIds} onActivate={onActivate} onToggleFavorite={onToggleFavorite} sort={colSort} onSort={columnSort} />
          ) : (
            <ul className="grid grid-cols-2 gap-2 @[560px]:grid-cols-3 @[900px]:grid-cols-4">{visible.map(card)}</ul>
          )}
          {results.length > shown && (
            <button type="button" className="min-h-11 rounded-lg border border-[var(--border)] px-4 text-sm font-medium text-[var(--muted)] hover:bg-[var(--paper)]" onClick={() => setShown((n) => n + PAGE)}>
              Show {Math.min(PAGE, results.length - shown)} more
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
