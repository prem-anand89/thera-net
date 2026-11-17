// The Library as a table: picture, Exercise (+ alternative names), Region, Type, Position, Equipment, Default dosage,
// Used, ★. Below ~620px of container the Region / Type / Position / Equipment / dosage columns drop out and their facts
// move under the name, so a row reads as two lines.
import { cellSub, td, th } from '@/components/ui';
import { canonicalRegion, listThumbKey, positionsOf, type Exercise } from '@/domain/hep';
import { doseSummary } from '@/domain/hepDose';
import { regionLabel } from '@/domain/hepLibrary';
import { Thumb, TypeTag, exerciseFacts } from './LibraryParts';

export type ColumnSort = 'az' | 'region' | 'type' | 'used';

export interface LibraryRowsProps {
  rows: Exercise[];
  thumbs: Record<string, string>;
  useCounts: Record<string, number>;
  selected?: ReadonlySet<string>;
  disabledIds?: ReadonlySet<string>;
  onActivate: (ex: Exercise) => void;
  onToggleFavorite?: (ex: Exercise) => void;
  /** Library select mode: a checkbox column; `onActivate` then toggles. */
  picks?: ReadonlySet<string>;
}

const WIDE = 'hidden @[820px]:table-cell';

export function LibraryTable({ rows, thumbs, useCounts, selected, disabledIds, onActivate, onToggleFavorite, picks, sort, onSort }: LibraryRowsProps & { sort: ColumnSort | null; onSort: (s: ColumnSort) => void }) {
  const head = (key: ColumnSort, label: string, cls = '') => (
    <th scope="col" className={`${th} ${cls}`}>
      <button type="button" className={`uppercase tracking-wide hover:text-[var(--ink)] ${sort === key ? 'text-[var(--ink)]' : ''}`} onClick={() => onSort(key)}>{label}{sort === key ? ' ↓' : ''}</button>
    </th>
  );
  return (
    <div className="overflow-x-auto rounded-xl border border-[var(--border)] bg-[var(--surface)]">
      <table className="w-full border-collapse">
        <thead className="border-b border-[var(--border)]">
          <tr>
            {picks && <th scope="col" className={th}><span className="sr-only">Select</span></th>}
            <th scope="col" className={th}><span className="sr-only">Picture</span></th>
            {head('az', 'Exercise')}
            {head('region', 'Region', WIDE)}
            {head('type', 'Type', WIDE)}
            <th scope="col" className={`${th} ${WIDE}`}>Position</th>
            <th scope="col" className={`${th} ${WIDE}`}>Equipment</th>
            <th scope="col" className={`${th} ${WIDE}`}>Default dosage</th>
            {head('used', 'Used', WIDE)}
            {onToggleFavorite && <th scope="col" className={th}><span className="sr-only">Favourite</span></th>}
          </tr>
        </thead>
        <tbody>
          {rows.map((ex) => {
            const off = disabledIds?.has(ex.id);
            const picked = picks?.has(ex.id);
            const on = selected?.has(ex.id) || picked;
            const uses = useCounts[ex.id] ?? 0;
            const equipment = ex.equipment.filter((e) => e && e !== 'None').join(', ');
            const tk = listThumbKey(ex);
            return (
              <tr key={ex.id} className={`border-b border-[var(--border)] last:border-0 ${on ? 'bg-[var(--teal-light)]' : ''} ${off ? 'opacity-50' : ''}`}>
                {picks && <td className="w-11 pl-2"><input type="checkbox" aria-label={`Select ${ex.title}`} checked={!!picked} onChange={() => onActivate(ex)} className="h-5 w-5" /></td>}
                <td className="w-16 py-2 pl-3"><Thumb ex={ex} url={tk ? thumbs[tk] : undefined} size={48} /></td>
                <td className={td}>
                  <button type="button" data-exercise={ex.id} disabled={off} aria-pressed={selected ? on : undefined} onClick={() => onActivate(ex)} className="block text-left font-semibold">
                    {ex.title}{!ex.active && <span className="ml-2 rounded bg-[var(--paper)] px-1.5 text-xs font-medium text-[var(--muted)]">Archived</span>}
                  </button>
                  {ex.otherNames.length > 0 && <div className={cellSub}>also {ex.otherNames.join(', ')}</div>}
                  {off && <div className={cellSub}>In program</div>}
                  <div className={`${cellSub} @[620px]:hidden`}>{exerciseFacts(ex)} · {doseSummary(ex)}</div>
                </td>
                <td className={`${td} ${WIDE}`}>{regionLabel(canonicalRegion(ex.bodyRegion))}</td>
                <td className={`${td} ${WIDE}`}><TypeTag phase={ex.phase} alsoPhases={ex.alsoPhases} /></td>
                <td className={`${td} ${WIDE}`}>{positionsOf(ex).join(', ') || '—'}</td>
                <td className={`${td} ${WIDE}`}>{equipment || '—'}</td>
                <td className={`${td} ${WIDE}`}>{doseSummary(ex)}</td>
                <td className={`${td} ${WIDE} font-num tabular-nums`}>{uses > 0 ? `${uses}×` : '—'}</td>
                {onToggleFavorite && (
                  <td className="px-1">
                    <button type="button" aria-label={ex.isFavorite ? `Remove ${ex.title} from favourites` : `Add ${ex.title} to favourites`} aria-pressed={ex.isFavorite} className="min-h-11 min-w-11 text-lg text-[var(--amber-strong)]" onClick={() => onToggleFavorite(ex)}>{ex.isFavorite ? '★' : '☆'}</button>
                  </td>
                )}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
