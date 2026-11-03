import { useMemo } from 'react';
import {
  type CatalogTemplateDraft,
  groupCatalogDrafts,
} from '@/domain/onboardingCatalogTemplates';
import { perSessionLabel } from '@/domain/catalogDisplay';
import { nameCheck } from '@/domain/nameCheck';
import { inputCls, RupeeInput } from '@/components/ui';

type AddKind = 'single' | 'package';

export function ServiceCatalogTemplateEditor({
  drafts,
  onChange,
}: {
  drafts: CatalogTemplateDraft[];
  onChange: (next: CatalogTemplateDraft[]) => void;
}) {
  const groups = useMemo(
    () => [...groupCatalogDrafts(drafts).entries()].sort(([a], [b]) => a.localeCompare(b)),
    [drafts]
  );

  const namedItems = useMemo(
    () => drafts.map((d) => ({ id: d.key, name: d.name, active: d.enabled })),
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
        {groups.map(([group, rows], gIdx) => (
          <div key={group} className={gIdx === 0 ? '' : 'border-t border-[var(--border)]'}>
            <div className="bg-[var(--paper)] px-3 py-2 text-[11.5px] font-semibold uppercase tracking-wider text-[var(--muted)]">
              {group}
            </div>
            <div className="divide-y divide-[var(--border)]">
              {rows.map((row) => (
                <TemplateRow
                  key={row.key}
                  row={row}
                  otherItems={namedItems.filter((item) => item.id !== row.key && item.active)}
                  onUpdate={(patch) => updateRow(row.key, patch)}
                />
              ))}
            </div>
          </div>
        ))}

        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-dashed border-[var(--border)] bg-[var(--paper)]/50 px-3 py-2.5">
          <button
            type="button"
            className="text-sm font-semibold text-[var(--teal-strong)] hover:underline"
            onClick={() => addRow('single')}
          >
            + Add a service
          </button>
          <div className="flex items-center gap-1.5 text-xs text-[var(--muted)]">
            <span>or add a:</span>
            <button
              type="button"
              className="rounded border border-[var(--border)] bg-[var(--surface)] px-2 py-0.5 text-xs font-medium text-[var(--ink)] hover:bg-[var(--paper)]"
              onClick={() => addRow('single')}
            >
              One visit
            </button>
            <button
              type="button"
              className="rounded border border-[var(--teal)] bg-[var(--teal-light)] px-2 py-0.5 text-xs font-medium text-[var(--teal-strong)] hover:bg-[var(--teal)]/20"
              onClick={() => addRow('package')}
            >
              Package
            </button>
          </div>
        </div>
      </div>
      <p className="text-xs text-[var(--muted)]">
        You can change prices, groups and treatments anytime in Settings → Services &amp; treatments.
      </p>
    </div>
  );
}

function TemplateRow({
  row,
  otherItems,
  onUpdate,
}: {
  row: CatalogTemplateDraft;
  otherItems: { id: string; name: string; active: boolean }[];
  onUpdate: (patch: Partial<CatalogTemplateDraft>) => void;
}) {
  const isPackage = row.sessionCount > 1;
  const perSession =
    isPackage && row.basePricePaise != null && row.basePricePaise > 0
      ? perSessionLabel({ basePricePaise: row.basePricePaise, sessionCount: row.sessionCount })
      : null;

  const check = row.name.trim()
    ? nameCheck(row.name, otherItems)
    : { kind: 'none' as const, match: null };
  const hasExactDuplicate = check.kind === 'exact';

  return (
    <div className={`p-3 ${row.enabled ? '' : 'opacity-50'}`}>
      <div className="flex flex-wrap items-center gap-2">
        <input
          type="checkbox"
          className="h-4 w-4 rounded accent-[var(--teal)]"
          checked={row.enabled}
          onChange={(e) => onUpdate({ enabled: e.target.checked })}
          aria-label="Include this service"
        />
        <input
          className={`${inputCls} min-w-[140px] flex-1 py-1.5 text-sm ${hasExactDuplicate ? '!border-[var(--rust)]' : ''}`}
          value={row.name}
          onChange={(e) => onUpdate({ name: e.target.value })}
          placeholder="Service name on visits & invoices"
          aria-label="Service name"
        />
        {isPackage && (
          <span className="shrink-0 rounded-full bg-[var(--teal-light)] px-2 py-0.5 text-[11px] font-semibold text-[var(--teal-strong)]">
            {perSession ? `${row.sessionCount} sessions · ${perSession}` : `${row.sessionCount} sessions`}
          </span>
        )}
      </div>

      {hasExactDuplicate && check.match && (
        <p className="mt-1 pl-6 text-xs text-[var(--rust)]">
          Duplicate name: &quot;{check.match.name}&quot; is already in use.
        </p>
      )}

      <div className="mt-2 flex flex-wrap items-end justify-between gap-3 pl-6">
        {isPackage ? (
          <label className="flex items-center gap-1.5 text-xs text-[var(--muted)]">
            Sessions
            <input
              type="number"
              min={1}
              className="w-16 rounded-lg border border-[var(--border)] bg-[var(--surface)] px-2 py-1 text-sm text-[var(--ink)]"
              value={String(row.sessionCount)}
              onChange={(e) => onUpdate({ sessionCount: Math.max(1, Number(e.target.value) || 1) })}
            />
          </label>
        ) : (
          <span />
        )}
        <RupeeInput
          valuePaise={row.basePricePaise}
          onChange={(p) => onUpdate({ basePricePaise: p })}
          className="w-32 rounded-lg border border-[var(--border)] bg-[var(--surface)] px-2 py-1 text-right text-base font-semibold text-[var(--ink)]"
        />
      </div>
    </div>
  );
}
