import { useMemo, useState } from 'react';
import {
  type CatalogTemplateDraft,
  groupCatalogDrafts,
  renameCatalogDraftGroup,
} from '@/domain/onboardingCatalogTemplates';
import { effectivePricePerSession } from '@/domain/types';
import { formatINR } from '@/domain/money';
import { Field, inputCls, btnSecondary, ErrorNote, RupeeInput } from '@/components/ui';

type AddKind = 'single' | 'package';

export function ServiceCatalogTemplateEditor({
  drafts,
  onChange,
}: {
  drafts: CatalogTemplateDraft[];
  onChange: (next: CatalogTemplateDraft[]) => void;
}) {
  const groups = useMemo(() => [...groupCatalogDrafts(drafts).entries()].sort(([a], [b]) => a.localeCompare(b)), [drafts]);
  const [newGroupName, setNewGroupName] = useState('');
  const [newGroupError, setNewGroupError] = useState<string | null>(null);

  function updateRow(key: string, patch: Partial<CatalogTemplateDraft>) {
    onChange(drafts.map((d) => (d.key === key ? { ...d, ...patch } : d)));
  }

  function addRow(group: string, kind: AddKind) {
    onChange([
      ...drafts,
      {
        key: crypto.randomUUID(),
        group,
        name: '',
        sessionCount: kind === 'package' ? 5 : 1,
        basePricePaise: null,
        enabled: true,
      },
    ]);
  }

  function addGroup() {
    const name = newGroupName.trim();
    if (!name) {
      setNewGroupError('Enter a group name');
      return;
    }
    if (drafts.some((d) => d.group.toLowerCase() === name.toLowerCase())) {
      setNewGroupError('That group already exists');
      return;
    }
    setNewGroupError(null);
    onChange([
      ...drafts,
      {
        key: crypto.randomUUID(),
        group: name,
        name: '',
        sessionCount: 1,
        basePricePaise: null,
        enabled: true,
      },
    ]);
    setNewGroupName('');
  }

  return (
    <div className="space-y-4">
      {groups.map(([group, rows]) => (
        <ServiceTemplateGroupPanel
          key={group}
          group={group}
          rows={rows}
          onRename={(to) => onChange(renameCatalogDraftGroup(drafts, group, to))}
          onUpdateRow={updateRow}
          onAdd={(kind) => addRow(group, kind)}
        />
      ))}

      <div className="rounded-xl border border-dashed border-[var(--border)] bg-[var(--paper)] p-4">
        <p className="text-sm font-semibold text-[var(--ink)]">Add a service group</p>
        <p className="mt-1 mb-3 text-xs text-[var(--muted)]">
          Creates an empty group — add services with the buttons inside the group.
        </p>
        <div className="flex flex-col gap-2 sm:flex-row">
          <input
            className={inputCls}
            placeholder="e.g. Assessment"
            value={newGroupName}
            onChange={(e) => {
              setNewGroupName(e.target.value);
              setNewGroupError(null);
            }}
          />
          <button type="button" className={`${btnSecondary} shrink-0 sm:w-auto`} onClick={() => addGroup()}>
            + Group
          </button>
        </div>
        <ErrorNote message={newGroupError} />
      </div>
    </div>
  );
}

function ServiceTemplateGroupPanel({
  group,
  rows,
  onRename,
  onUpdateRow,
  onAdd,
}: {
  group: string;
  rows: CatalogTemplateDraft[];
  onRename: (to: string) => void;
  onUpdateRow: (key: string, patch: Partial<CatalogTemplateDraft>) => void;
  onAdd: (kind: AddKind) => void;
}) {
  const [editingName, setEditingName] = useState(false);
  const [nameDraft, setNameDraft] = useState(group);

  return (
    <div className="overflow-hidden rounded-xl border border-[var(--border)] bg-[var(--surface)] shadow-sm">
      <div className="flex flex-col gap-2 border-b border-[var(--border)] bg-[var(--paper)] px-3 py-2.5 sm:flex-row sm:items-center">
        <div className="min-w-0 flex-1">
          {editingName ? (
            <div className="flex flex-wrap items-center gap-2">
              <input
                className={`${inputCls} max-w-xs text-sm font-semibold`}
                value={nameDraft}
                onChange={(e) => setNameDraft(e.target.value)}
                aria-label="Service group name"
              />
              <button
                type="button"
                className="text-xs font-semibold text-[var(--teal)]"
                onClick={() => {
                  onRename(nameDraft);
                  setEditingName(false);
                }}
              >
                Save
              </button>
              <button
                type="button"
                className="text-xs text-[var(--muted)]"
                onClick={() => {
                  setNameDraft(group);
                  setEditingName(false);
                }}
              >
                Cancel
              </button>
            </div>
          ) : (
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="text-sm font-semibold text-[var(--ink)]">{group}</h3>
              <span className="text-[11px] text-[var(--muted)]">{rows.length} items</span>
              <button
                type="button"
                className="text-xs font-semibold text-[var(--teal)] hover:underline"
                onClick={() => {
                  setNameDraft(group);
                  setEditingName(true);
                }}
              >
                Edit group name
              </button>
            </div>
          )}
        </div>
        <div className="flex flex-wrap gap-1.5">
          <button
            type="button"
            className="rounded-lg border border-[var(--border)] bg-[var(--surface)] px-2.5 py-1 text-[11px] font-semibold"
            onClick={() => onAdd('single')}
          >
            + Single session
          </button>
          <button
            type="button"
            className="rounded-lg border border-[var(--teal)] bg-[var(--teal-light)] px-2.5 py-1 text-[11px] font-semibold text-[var(--teal-strong)]"
            onClick={() => onAdd('package')}
          >
            + Package
          </button>
        </div>
      </div>
      <div className="divide-y divide-[var(--border)]">
        {rows.map((row) => (
          <TemplateRow key={row.key} row={row} onUpdate={(patch) => onUpdateRow(row.key, patch)} />
        ))}
      </div>
    </div>
  );
}

function TemplateRow({
  row,
  onUpdate,
}: {
  row: CatalogTemplateDraft;
  onUpdate: (patch: Partial<CatalogTemplateDraft>) => void;
}) {
  const isPackage = row.sessionCount > 1;
  const perSession =
    row.basePricePaise != null && row.basePricePaise > 0
      ? formatINR(effectivePricePerSession({ basePricePaise: row.basePricePaise, sessionCount: row.sessionCount }))
      : null;

  return (
    <div className={`space-y-2 p-3 ${row.enabled ? '' : 'opacity-50'}`}>
      <div className="flex flex-wrap items-start gap-2">
        <label className="flex items-center gap-2 text-xs text-[var(--muted)]">
          <input
            type="checkbox"
            checked={row.enabled}
            onChange={(e) => onUpdate({ enabled: e.target.checked })}
          />
          Include
        </label>
        <span
          className="rounded-full px-2 py-0.5 text-[10px] font-semibold"
          style={
            isPackage
              ? { background: 'var(--teal-light)', color: 'var(--teal-strong)' }
              : { background: 'var(--paper)', border: '1px solid var(--border)', color: 'var(--muted)' }
          }
        >
          {isPackage ? `Package · ${row.sessionCount} sessions` : 'Single session'}
        </span>
      </div>
      <Field label="Name">
        <input
          className={inputCls}
          value={row.name}
          onChange={(e) => onUpdate({ name: e.target.value })}
          placeholder="Service name on visits & invoices"
        />
      </Field>
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        <Field label="Session count">
          <input
            type="number"
            min={1}
            className={inputCls}
            value={String(row.sessionCount)}
            onChange={(e) => onUpdate({ sessionCount: Math.max(1, Number(e.target.value) || 1) })}
          />
        </Field>
        <Field label="Total price">
          <RupeeInput
            valuePaise={row.basePricePaise}
            onChange={(p) => onUpdate({ basePricePaise: p })}
          />
        </Field>
      </div>
      {perSession && isPackage && (
        <p className="text-[11px] text-[var(--muted)]">≈ {perSession} per session</p>
      )}
    </div>
  );
}
