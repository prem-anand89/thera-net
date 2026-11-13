import { useMemo } from 'react';
import {
  type CatalogTemplateDraft,
  groupCatalogDrafts,
  isPricedDraft,
} from '@/domain/onboardingCatalogTemplates';
import { perSessionLabel } from '@/domain/catalogDisplay';
import { nameCheck } from '@/domain/nameCheck';
import { inputCls, RupeeInput } from '@/components/ui';
import { currencySymbol } from '@/domain/money';

type AddKind = 'single' | 'package';

const MIN_SESSIONS = 2;
const MAX_SESSIONS = 100;

export function ServiceCatalogTemplateEditor({
  drafts,
  onChange,
  showPrices = true,
  hint,
  rowNotes = true,
}: {
  drafts: CatalogTemplateDraft[];
  onChange: (next: CatalogTemplateDraft[]) => void;
  /** False hides the price boxes (names only). */
  showPrices?: boolean;
  /** Replaces the line under the list. */
  hint?: string;
  /** False drops the per-row "add a price" reminder (the caller's hint says it once). */
  rowNotes?: boolean;
}) {
  const groups = useMemo(
    () => [...groupCatalogDrafts(drafts).entries()],
    [drafts]
  );

  const pricedSavedItems = useMemo(
    () => drafts.filter(isPricedDraft).map((d) => ({ id: d.key, name: d.name, active: true })),
    [drafts]
  );

  function updateRow(key: string, patch: Partial<CatalogTemplateDraft>) {
    onChange(drafts.map((d) => (d.key === key ? { ...d, ...patch } : d)));
  }

  function addRow(kind: AddKind) {
    const defaultGroup = drafts[drafts.length - 1]?.group?.trim() || 'General';
    onChange([
      ...drafts,
      {
        key: crypto.randomUUID(),
        group: defaultGroup,
        name: '',
        sessionCount: kind === 'package' ? 5 : 1,
        basePricePaise: null,
        enabled: true,
      },
    ]);
  }

  return (
    <div className="space-y-2">
      <div className="overflow-hidden rounded-2xl border border-[var(--border)] bg-[var(--surface)] shadow-sm">
        <div className="flex items-center gap-1.5 border-b border-[var(--border)] bg-[var(--paper)] px-2.5 py-2 text-[11px] sm:gap-2 sm:px-3 font-semibold uppercase tracking-wider text-[var(--muted)]">
          <span className="w-4 shrink-0" aria-hidden="true" />
          <span className="flex-1">Service name</span>
          {showPrices && <span className="w-[5.25rem] shrink-0 text-right sm:w-28">Price ({currencySymbol()})</span>}
        </div>

        {groups.map(([group, rows], gIdx) => (
          <div key={group} className={gIdx === 0 ? '' : 'border-t border-[var(--border)]'}>
            <div className="bg-[var(--paper)]/70 px-3 py-1.5 text-[11.5px] font-semibold uppercase tracking-wider text-[var(--muted)]">
              {group}
            </div>
            <div className="divide-y divide-[var(--border)] border-t border-[var(--border)]">
              {rows.map((row) => (
                <TemplateRow
                  key={row.key}
                  row={row}
                  showPrices={showPrices}
                  rowNotes={rowNotes}
                  otherSavedItems={pricedSavedItems.filter((item) => item.id !== row.key)}
                  onUpdate={(patch) => updateRow(row.key, patch)}
                />
              ))}
            </div>
          </div>
        ))}

        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-dashed border-[var(--border)] bg-[var(--paper)]/50 px-3 py-2.5">
          <span className="text-sm font-semibold text-[var(--ink)]">+ Add a service:</span>
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              className="rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 py-1 text-xs font-medium text-[var(--ink)] hover:bg-[var(--paper)]"
              onClick={() => addRow('single')}
            >
              One visit
            </button>
            <button
              type="button"
              className="rounded-lg border border-[var(--teal)] bg-[var(--teal-light)] px-3 py-1 text-xs font-medium text-[var(--teal-strong)] hover:bg-[var(--teal)]/20"
              onClick={() => addRow('package')}
            >
              Package
            </button>
          </div>
        </div>
      </div>
      <p className="text-xs text-[var(--muted)]">
        {hint ?? <>You can change prices, groups and treatments anytime in Settings → Services &amp; treatments.</>}
      </p>
    </div>
  );
}

function TemplateRow({
  row,
  showPrices,
  rowNotes,
  otherSavedItems,
  onUpdate,
}: {
  row: CatalogTemplateDraft;
  showPrices: boolean;
  rowNotes: boolean;
  otherSavedItems: { id: string; name: string; active: boolean }[];
  onUpdate: (patch: Partial<CatalogTemplateDraft>) => void;
}) {
  const isPackage = row.sessionCount > 1;
  const perSession =
    isPackage && row.basePricePaise != null && row.basePricePaise > 0
      ? perSessionLabel({ basePricePaise: row.basePricePaise, sessionCount: row.sessionCount })
      : null;

  const willBeSaved = isPricedDraft(row);
  // A ticked row with no price or no name is left out at Finish: say so on the row, not silently. ₹0 is a real price.
  const missing = !row.enabled || !rowNotes
    ? null
    : row.basePricePaise == null
      ? `Add a price to include this (${currencySymbol()}0 if it's free).`
      : !row.name.trim()
        ? 'Add a name to include this.'
        : null;
  const check =
    willBeSaved && row.name.trim()
      ? nameCheck(row.name, otherSavedItems)
      : { kind: 'none' as const, match: null };
  const hasExactDuplicate = check.kind === 'exact';
  const hasSimilarDuplicate = check.kind === 'similar';

  return (
    <div className={`px-2.5 py-2.5 sm:px-3 ${row.enabled ? '' : 'opacity-50'}`}>
      <div className="flex items-center gap-1.5 sm:gap-2">
        <input
          type="checkbox"
          className="h-4 w-4 shrink-0 rounded accent-[var(--teal)]"
          checked={row.enabled}
          onChange={(e) => onUpdate({ enabled: e.target.checked })}
          aria-label="Include this service"
        />
        <input
          className={`${inputCls} min-w-0 flex-1 !px-2 py-1.5 sm:!px-3 ${hasExactDuplicate ? '!border-[var(--rust)]' : ''}`}
          value={row.name}
          onChange={(e) => onUpdate({ name: e.target.value })}
          placeholder="Service name on visits & invoices"
          aria-label="Service name"
        />
        {showPrices && (
        <div className="relative w-[5.25rem] shrink-0 sm:w-28">
          <span
            aria-hidden="true"
            className="pointer-events-none absolute left-1.5 top-1/2 -translate-y-1/2 text-xs text-[var(--muted)]"
          >
            {currencySymbol()}
          </span>
          <RupeeInput
            valuePaise={row.basePricePaise}
            onChange={(p) => onUpdate({ basePricePaise: p })}
            ariaLabel="Price in rupees"
            placeholder="–"
            className={`font-num ${inputCls} !py-1.5 !pl-4 !pr-1.5 text-right sm:!pl-5 sm:!pr-2 font-semibold tabular-nums text-[var(--ink)]`}
          />
        </div>
        )}
      </div>

      {missing && (
        <p className="mt-1 pl-6 text-xs text-[var(--amber-strong)]" data-testid="row-not-saved">
          {missing}
        </p>
      )}

      {hasExactDuplicate && check.match && (
        <p className="mt-1 pl-6 text-xs text-[var(--rust)]">
          Duplicate name: &quot;{check.match.name}&quot; is already in use.
        </p>
      )}

      {hasSimilarDuplicate && check.match && (
        <p className="mt-1 pl-6 text-xs text-[var(--muted)]">
          Similar to &quot;{check.match.name}&quot;.
        </p>
      )}

      {isPackage && (
        <div className="mt-2 flex flex-wrap items-center justify-between gap-2 pl-6">
          <div className="flex flex-wrap items-center gap-1.5 text-xs text-[var(--muted)]" role="group" aria-label="Number of sessions">
            <div className="flex items-center rounded-[10px] border border-[var(--border)] bg-[var(--surface)]">
              <button
                type="button"
                className="h-10 w-10 text-base font-semibold text-[var(--teal-strong)] disabled:opacity-40"
                aria-label="One fewer session"
                disabled={row.sessionCount <= MIN_SESSIONS}
                onClick={() => onUpdate({ sessionCount: Math.max(MIN_SESSIONS, row.sessionCount - 1) })}
              >
                −
              </button>
              <output aria-live="polite" className="min-w-7 text-center text-xs font-semibold tabular-nums text-[var(--ink)]">
                {row.sessionCount}
              </output>
              <button
                type="button"
                className="h-10 w-10 text-base font-semibold text-[var(--teal-strong)] disabled:opacity-40"
                aria-label="One more session"
                disabled={row.sessionCount >= MAX_SESSIONS}
                onClick={() => onUpdate({ sessionCount: Math.min(MAX_SESSIONS, row.sessionCount + 1) })}
              >
                +
              </button>
            </div>
            {[5, 10].map((n) => (
              <button
                key={n}
                type="button"
                aria-pressed={row.sessionCount === n}
                aria-label={`${n} sessions`}
                className={`min-h-10 min-w-10 rounded-full border px-2.5 text-xs ${
                  row.sessionCount === n
                    ? 'border-[var(--teal)] bg-[var(--teal-light)] font-semibold text-[var(--teal-strong)]'
                    : 'border-[var(--border)] bg-[var(--surface)] text-[var(--ink)]'
                }`}
                onClick={() => onUpdate({ sessionCount: n })}
              >
                {n}
              </button>
            ))}
          </div>
          <span className="shrink-0 rounded-full bg-[var(--teal-light)] px-2.5 py-1 text-[11px] font-semibold text-[var(--teal-strong)]">
            {perSession ? `${row.sessionCount} sessions · ${perSession}` : `${row.sessionCount} sessions`}
          </span>
        </div>
      )}
    </div>
  );
}
