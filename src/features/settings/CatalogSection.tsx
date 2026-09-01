import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { useClinic } from '@/app/clinicContext';
import { repos } from '@/services';
import { formatINR } from '@/domain/money';
import {
  effectivePricePerSession,
  type CatalogItem,
  type ReferringSourceItem,
  type TreatmentItem,
} from '@/domain/types';
import { Field, inputCls, btnPrimary, btnSecondary, ErrorNote, RupeeInput, SectionCard } from '@/components/ui';
import { toFriendlyMessage } from '@/lib/errors';

export type CatalogView = 'packages' | 'treatments' | 'referrals';

const CATALOG_VIEWS: { key: CatalogView; label: string }[] = [
  { key: 'packages', label: 'Billing packages' },
  { key: 'treatments', label: 'Treatments' },
  { key: 'referrals', label: 'Referral sources' },
];

export function CatalogSection({ view, onViewChange }: { view: CatalogView; onViewChange: (v: CatalogView) => void }) {
  return (
    <div>
      <div className="mb-5 flex gap-1.5">
        {CATALOG_VIEWS.map(({ key, label }) => {
          const selected = view === key;
          return (
            <button
              key={key}
              type="button"
              className="rounded-lg border px-3 py-1.5 text-xs font-semibold"
              style={{
                borderColor: selected ? 'var(--teal)' : 'var(--border)',
                background: selected ? 'var(--teal-light)' : 'var(--surface)',
                color: selected ? 'var(--teal-strong)' : 'var(--muted)',
              }}
              onClick={() => onViewChange(key)}
            >
              {label}
            </button>
          );
        })}
      </div>
      {view === 'packages' && <ServiceCatalog />}
      {view === 'treatments' && <TreatmentCatalog />}
      {view === 'referrals' && <ReferringSourcesCatalog />}
    </div>
  );
}

function CatalogStats({ items }: { items: { label: string; value: string | number; warn?: boolean }[] }) {
  return (
    <div className="mb-4 flex flex-wrap gap-1.5">
      {items.map((s) => (
        <span
          key={s.label}
          className="rounded-full border px-2.5 py-0.5 font-mono text-[11px]"
          style={
            s.warn
              ? {
                  borderColor: 'var(--amber)',
                  background: 'var(--amber-light)',
                  color: 'var(--amber-strong)',
                }
              : {
                  borderColor: 'var(--border)',
                  background: 'var(--paper)',
                  color: 'var(--muted)',
                }
          }
        >
          {s.value} {s.label}
        </span>
      ))}
    </div>
  );
}

function ActivePill({ active }: { active: boolean }) {
  return (
    <span
      className="inline-block self-start rounded-full px-2.5 py-0.5 text-[10.5px] font-semibold"
      style={
        active
          ? { background: 'var(--moss-light)', color: 'var(--moss-strong)' }
          : { background: 'var(--paper)', color: 'var(--muted)' }
      }
    >
      {active ? 'Active' : 'Inactive'}
    </span>
  );
}

function CatalogCardShell({
  active,
  children,
  footer,
}: {
  active: boolean;
  children: ReactNode;
  footer: ReactNode;
}) {
  return (
    <div
      className={`flex h-full flex-col gap-2.5 rounded-xl border border-[var(--border)] bg-[var(--surface)] p-3.5 shadow-sm ${active ? '' : 'opacity-60'}`}
    >
      {children}
      <div className="mt-auto flex flex-wrap gap-3.5 border-t border-[var(--border)] pt-2.5 text-xs font-medium">
        {footer}
      </div>
    </div>
  );
}

function CatalogAddCard({ title, hint, children }: { title: string; hint?: string; children: ReactNode }) {
  return (
    <div className="rounded-xl border border-dashed border-[var(--border)] bg-[var(--paper)] p-4">
      <h4 className="text-sm font-semibold text-[var(--ink)]">{title}</h4>
      {hint && <p className="mt-1 mb-3 text-xs text-[var(--muted)]">{hint}</p>}
      {!hint && <div className="mb-3" />}
      {children}
    </div>
  );
}

function ServiceCatalog() {
  const clinic = useClinic();
  const items = useLiveQuery(() => repos.catalog.list(clinic.id, true), [clinic.id]);
  const [showInactive, setShowInactive] = useState(false);
  const groups = useMemo(() => {
    const map = new Map<string, CatalogItem[]>();
    for (const item of items ?? []) {
      if (!showInactive && !item.active) continue;
      const key = item.category.trim() || 'Uncategorized';
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(item);
    }
    return [...map.entries()];
  }, [items, showInactive]);
  const stats = useMemo(() => {
    const all = items ?? [];
    const active = all.filter((i) => i.active).length;
    const categories = new Set(all.map((i) => i.category.trim() || 'Uncategorized')).size;
    return { total: all.length, active, inactive: all.length - active, categories };
  }, [items]);

  const categoryOptions = useMemo(
    () => [...new Set((items ?? []).map((i) => i.category))].filter(Boolean),
    [items]
  );

  return (
    <SectionCard title="Billing packages">
      <p className="mb-3 text-xs text-[var(--muted)]">
        Billable services and package prices. Price changes affect <strong>future</strong> visits only —
        logged visits keep their snapshot. Deactivate instead of deleting so history keeps resolving.
      </p>
      <CatalogStats
        items={[
          { label: 'packages', value: stats.total },
          { label: 'active', value: stats.active },
          { label: 'categories', value: stats.categories },
          ...(stats.inactive > 0 ? [{ label: 'inactive', value: stats.inactive, warn: true }] : []),
        ]}
      />
      {stats.inactive > 0 && (
        <label className="mb-4 flex items-center gap-2 text-xs text-[var(--muted)]">
          <input
            type="checkbox"
            checked={showInactive}
            onChange={(e) => setShowInactive(e.target.checked)}
          />
          Show inactive packages
        </label>
      )}
      <datalist id="catalog-categories">
        {categoryOptions.map((c) => (
          <option key={c} value={c} />
        ))}
      </datalist>

      {groups.length > 0 ? (
        <div className="mb-6 space-y-4">
          {groups.map(([category, catItems]) => (
            <div key={category}>
              <p className="mb-2 px-0.5 text-[11px] font-bold uppercase tracking-wider text-[var(--muted)]/80">
                {category}
              </p>
              <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2 lg:grid-cols-3">
                {catItems.map((item) => (
                  <ServicePackageCard key={item.id} item={item} />
                ))}
              </div>
            </div>
          ))}
        </div>
      ) : (
        <p className="mb-6 text-xs text-[var(--muted)]">No packages yet.</p>
      )}

      <ServicePackageAddForm categoryOptions={categoryOptions} />
    </SectionCard>
  );
}

function ServicePackageCard({ item }: { item: CatalogItem }) {
  const [editing, setEditing] = useState(false);
  const [category, setCategory] = useState(item.category);
  const [name, setName] = useState(item.name);
  const [sessionCount, setSessionCount] = useState(String(item.sessionCount));
  const [pricePaise, setPricePaise] = useState<number | null>(item.basePricePaise);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savedFlash, setSavedFlash] = useState(false);
  const savedTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!editing) {
      setCategory(item.category);
      setName(item.name);
      setSessionCount(String(item.sessionCount));
      setPricePaise(item.basePricePaise);
    }
  }, [item, editing]);

  async function save() {
    if (!name.trim() || !category.trim() || pricePaise == null) {
      setError('Category, name, and price are required');
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await repos.catalog.put({
        ...item,
        category: category.trim(),
        name: name.trim(),
        sessionCount: Math.max(1, Number(sessionCount) || 1),
        basePricePaise: pricePaise,
        updatedAt: new Date().toISOString(),
      });
      setEditing(false);
      if (savedTimeoutRef.current) clearTimeout(savedTimeoutRef.current);
      setSavedFlash(true);
      savedTimeoutRef.current = setTimeout(() => setSavedFlash(false), 1500);
    } catch (e) {
      setError(toFriendlyMessage(e));
    } finally {
      setSaving(false);
    }
  }

  async function toggleActive() {
    await repos.catalog.put({
      ...item,
      active: !item.active,
      updatedAt: new Date().toISOString(),
    });
  }

  if (editing) {
    return (
      <CatalogCardShell
        active={item.active}
        footer={
          <>
            <button type="button" className={btnPrimary} disabled={saving} onClick={() => void save()}>
              {saving ? 'Saving…' : 'Save'}
            </button>
            <button type="button" className={btnSecondary} disabled={saving} onClick={() => setEditing(false)}>
              Cancel
            </button>
          </>
        }
      >
        <p className="text-sm font-semibold text-[var(--ink)]">Edit package</p>
        <Field label="Category">
          <input className={inputCls} list="catalog-categories" value={category} onChange={(e) => setCategory(e.target.value)} />
        </Field>
        <Field label="Package name">
          <input className={inputCls} value={name} onChange={(e) => setName(e.target.value)} autoFocus />
        </Field>
        <div className="flex gap-2">
          <Field label="Sessions">
            <input
              type="number"
              min={1}
              className={inputCls}
              value={sessionCount}
              onChange={(e) => setSessionCount(e.target.value)}
            />
          </Field>
          <Field label="Price">
            <RupeeInput valuePaise={pricePaise} onChange={setPricePaise} />
          </Field>
        </div>
        <p className="text-[11px] text-[var(--muted)]">New price applies to future visits only.</p>
        <ErrorNote message={error} />
      </CatalogCardShell>
    );
  }

  return (
    <CatalogCardShell
      active={item.active}
      footer={
        <>
          <button type="button" className="text-[var(--teal)] hover:underline" onClick={() => setEditing(true)}>
            Edit
          </button>
          <button type="button" className="text-[var(--teal)] hover:underline" onClick={() => void toggleActive()}>
            {item.active ? 'Deactivate' : 'Reactivate'}
          </button>
          {savedFlash && <span className="text-[var(--moss)]">Saved</span>}
        </>
      }
    >
      <p className="font-display text-sm font-medium text-[var(--ink)]">{item.name}</p>
      <ActivePill active={item.active} />
      <p className="text-xs text-[var(--muted)]">
        {item.sessionCount} session{item.sessionCount === 1 ? '' : 's'} · {formatINR(item.basePricePaise)} total
      </p>
      <p className="text-xs text-[var(--muted)]">
        Per session: {formatINR(effectivePricePerSession(item))}
      </p>
    </CatalogCardShell>
  );
}

function ServicePackageAddForm({ categoryOptions }: { categoryOptions: string[] }) {
  const clinic = useClinic();
  const [draft, setDraft] = useState({ category: categoryOptions[0] ?? '', name: '', sessionCount: '1' });
  const [draftPrice, setDraftPrice] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function addItem() {
    setError(null);
    if (!draft.category.trim() || !draft.name.trim() || draftPrice == null) {
      setError('Category, name, and price are required');
      return;
    }
    const item: CatalogItem = {
      id: crypto.randomUUID(),
      clinicId: clinic.id,
      category: draft.category.trim(),
      name: draft.name.trim(),
      sessionCount: Math.max(1, Number(draft.sessionCount) || 1),
      basePricePaise: draftPrice,
      active: true,
      updatedAt: new Date().toISOString(),
    };
    await repos.catalog.put(item);
    setDraft({ category: draft.category, name: '', sessionCount: '1' });
    setDraftPrice(null);
  }

  return (
    <CatalogAddCard title="Add a package" hint="Grouped by category on visits and invoices.">
      <div className="space-y-2">
        <Field label="Category">
          <input
            className={inputCls}
            list="catalog-categories"
            placeholder="e.g. Physiotherapy"
            value={draft.category}
            onChange={(e) => setDraft({ ...draft, category: e.target.value })}
          />
        </Field>
        <Field label="Package name">
          <input
            className={inputCls}
            placeholder="e.g. 5-session package"
            value={draft.name}
            onChange={(e) => setDraft({ ...draft, name: e.target.value })}
          />
        </Field>
        <div className="flex gap-2">
          <Field label="Sessions">
            <input
              type="number"
              min={1}
              className={inputCls}
              value={draft.sessionCount}
              onChange={(e) => setDraft({ ...draft, sessionCount: e.target.value })}
            />
          </Field>
          <Field label="Price">
            <RupeeInput valuePaise={draftPrice} onChange={setDraftPrice} />
          </Field>
        </div>
        <button type="button" className={`${btnSecondary} w-full`} onClick={() => void addItem()}>
          + Add package
        </button>
        <ErrorNote message={error} />
      </div>
    </CatalogAddCard>
  );
}

function TreatmentCatalog() {
  const clinic = useClinic();
  const itemsRaw = useLiveQuery(() => repos.treatmentCatalog.list(clinic.id, true), [clinic.id]);
  const [showInactive, setShowInactive] = useState(false);
  const visible = useMemo(
    () =>
      [...(itemsRaw ?? [])]
        .filter((i) => showInactive || i.active)
        .sort((a, b) => {
          if (a.active !== b.active) return a.active ? -1 : 1;
          return a.name.localeCompare(b.name);
        }),
    [itemsRaw, showInactive]
  );
  const activeCount = (itemsRaw ?? []).filter((i) => i.active).length;
  const itemList = itemsRaw ?? [];

  return (
    <SectionCard title="Treatments performed">
      <p className="mb-3 text-xs text-[var(--muted)]">
        Clinical checklist on each visit, independent of billing. Deactivate instead of deleting so
        past visits keep displaying correctly.
      </p>
      <CatalogStats
        items={[
          { label: 'total', value: itemList.length },
          { label: 'active', value: activeCount },
          ...(itemList.length - activeCount > 0
            ? [{ label: 'inactive', value: itemList.length - activeCount, warn: true }]
            : []),
        ]}
      />
      {itemList.length - activeCount > 0 && (
        <label className="mb-4 flex items-center gap-2 text-xs text-[var(--muted)]">
          <input type="checkbox" checked={showInactive} onChange={(e) => setShowInactive(e.target.checked)} />
          Show inactive treatments
        </label>
      )}
      {visible.length > 0 ? (
        <div className="mb-6 grid grid-cols-1 gap-2.5 sm:grid-cols-2 lg:grid-cols-3">
          {visible.map((item) => (
            <TreatmentCard key={item.id} item={item} />
          ))}
        </div>
      ) : (
        <p className="mb-6 text-xs text-[var(--muted)]">No treatments yet.</p>
      )}
      <TreatmentAddForm />
    </SectionCard>
  );
}

function TreatmentCard({ item }: { item: TreatmentItem }) {
  const [editing, setEditing] = useState(false);
  const [nameDraft, setNameDraft] = useState(item.name);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!editing) setNameDraft(item.name);
  }, [item.name, editing]);

  async function save() {
    const trimmed = nameDraft.trim();
    if (!trimmed) {
      setError('Name is required');
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await repos.treatmentCatalog.put({
        ...item,
        name: trimmed,
        updatedAt: new Date().toISOString(),
      });
      setEditing(false);
    } catch (e) {
      setError(toFriendlyMessage(e));
    } finally {
      setSaving(false);
    }
  }

  async function toggleActive() {
    await repos.treatmentCatalog.put({
      ...item,
      active: !item.active,
      updatedAt: new Date().toISOString(),
    });
  }

  if (editing) {
    return (
      <CatalogCardShell
        active={item.active}
        footer={
          <>
            <button type="button" className={btnPrimary} disabled={saving} onClick={() => void save()}>
              {saving ? 'Saving…' : 'Save'}
            </button>
            <button type="button" className={btnSecondary} disabled={saving} onClick={() => setEditing(false)}>
              Cancel
            </button>
          </>
        }
      >
        <Field label="Treatment name">
          <input className={inputCls} value={nameDraft} onChange={(e) => setNameDraft(e.target.value)} autoFocus />
        </Field>
        <ErrorNote message={error} />
      </CatalogCardShell>
    );
  }

  return (
    <CatalogCardShell
      active={item.active}
      footer={
        <>
          <button type="button" className="text-[var(--teal)] hover:underline" onClick={() => setEditing(true)}>
            Edit
          </button>
          <button type="button" className="text-[var(--teal)] hover:underline" onClick={() => void toggleActive()}>
            {item.active ? 'Deactivate' : 'Reactivate'}
          </button>
        </>
      }
    >
      <p className="text-sm font-medium text-[var(--ink)]">{item.name}</p>
      <ActivePill active={item.active} />
    </CatalogCardShell>
  );
}

function TreatmentAddForm() {
  const clinic = useClinic();
  const [draftName, setDraftName] = useState('');
  const [error, setError] = useState<string | null>(null);

  async function addItem() {
    setError(null);
    const name = draftName.trim();
    if (!name) {
      setError('Name is required');
      return;
    }
    await repos.treatmentCatalog.put({
      id: crypto.randomUUID(),
      clinicId: clinic.id,
      name,
      active: true,
      updatedAt: new Date().toISOString(),
    });
    setDraftName('');
  }

  return (
    <CatalogAddCard title="Add a treatment" hint="e.g. Manual therapy, Exercise, Electrotherapy.">
      <div className="flex flex-wrap gap-2">
        <input
          className={`${inputCls} min-w-0 flex-1`}
          placeholder="Treatment name"
          value={draftName}
          onChange={(e) => setDraftName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') void addItem();
          }}
        />
        <button type="button" className={btnSecondary} onClick={() => void addItem()}>
          + Add
        </button>
      </div>
      <ErrorNote message={error} />
    </CatalogAddCard>
  );
}

function ReferringSourcesCatalog() {
  const clinic = useClinic();
  const itemsRaw = useLiveQuery(() => repos.referringSourceCatalog.list(clinic.id, true), [clinic.id]);
  const [showInactive, setShowInactive] = useState(false);
  const visible = useMemo(
    () =>
      [...(itemsRaw ?? [])]
        .filter((i) => showInactive || i.active)
        .sort((a, b) => {
          if (a.active !== b.active) return a.active ? -1 : 1;
          return a.name.localeCompare(b.name);
        }),
    [itemsRaw, showInactive]
  );
  const itemList = itemsRaw ?? [];
  const withDetail = itemList.filter((i) => i.detailLabel).length;
  const activeCount = itemList.filter((i) => i.active).length;

  return (
    <SectionCard title="Referral sources">
      <p className="mb-3 text-xs text-[var(--muted)]">
        Shown when adding or editing a patient. Deactivate instead of deleting so existing patients
        keep displaying correctly. Optionally add a <strong>detail field label</strong> — when staff pick
        that source, the patient form shows an extra text field with that label (e.g. source &quot;Doctor
        referral&quot; with detail &quot;Referring doctor&quot;).
      </p>
      <CatalogStats
        items={[
          { label: 'sources', value: itemList.length },
          { label: 'active', value: activeCount },
          { label: 'with detail field', value: withDetail },
          ...(itemList.length - activeCount > 0
            ? [{ label: 'inactive', value: itemList.length - activeCount, warn: true }]
            : []),
        ]}
      />
      {itemList.length - activeCount > 0 && (
        <label className="mb-4 flex items-center gap-2 text-xs text-[var(--muted)]">
          <input type="checkbox" checked={showInactive} onChange={(e) => setShowInactive(e.target.checked)} />
          Show inactive sources
        </label>
      )}
      {visible.length > 0 ? (
        <div className="mb-6 grid grid-cols-1 gap-2.5 sm:grid-cols-2 lg:grid-cols-3">
          {visible.map((item) => (
            <ReferralSourceCard key={item.id} item={item} />
          ))}
        </div>
      ) : (
        <p className="mb-6 text-xs text-[var(--muted)]">No referral sources yet.</p>
      )}
      <ReferralSourceAddForm />
    </SectionCard>
  );
}

function ReferralSourceCard({ item }: { item: ReferringSourceItem }) {
  const [editing, setEditing] = useState(false);
  const [nameDraft, setNameDraft] = useState(item.name);
  const [detailDraft, setDetailDraft] = useState(item.detailLabel ?? '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!editing) {
      setNameDraft(item.name);
      setDetailDraft(item.detailLabel ?? '');
    }
  }, [item, editing]);

  async function save() {
    const name = nameDraft.trim();
    if (!name) {
      setError('Name is required');
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await repos.referringSourceCatalog.put({
        ...item,
        name,
        detailLabel: detailDraft.trim() || null,
        updatedAt: new Date().toISOString(),
      });
      setEditing(false);
    } catch (e) {
      setError(toFriendlyMessage(e));
    } finally {
      setSaving(false);
    }
  }

  async function toggleActive() {
    await repos.referringSourceCatalog.put({
      ...item,
      active: !item.active,
      updatedAt: new Date().toISOString(),
    });
  }

  if (editing) {
    return (
      <CatalogCardShell
        active={item.active}
        footer={
          <>
            <button type="button" className={btnPrimary} disabled={saving} onClick={() => void save()}>
              {saving ? 'Saving…' : 'Save'}
            </button>
            <button type="button" className={btnSecondary} disabled={saving} onClick={() => setEditing(false)}>
              Cancel
            </button>
          </>
        }
      >
        <Field label="Source name">
          <input className={inputCls} value={nameDraft} onChange={(e) => setNameDraft(e.target.value)} autoFocus />
        </Field>
        <Field label="Detail field label (optional)">
          <input
            className={inputCls}
            placeholder="e.g. Referring doctor"
            value={detailDraft}
            onChange={(e) => setDetailDraft(e.target.value)}
          />
          <p className="mt-1 text-[11px] text-[var(--muted)]">
            Leave blank if patients only need to pick the source name — no follow-up field.
          </p>
        </Field>
        <ErrorNote message={error} />
      </CatalogCardShell>
    );
  }

  return (
    <CatalogCardShell
      active={item.active}
      footer={
        <>
          <button type="button" className="text-[var(--teal)] hover:underline" onClick={() => setEditing(true)}>
            Edit
          </button>
          <button type="button" className="text-[var(--teal)] hover:underline" onClick={() => void toggleActive()}>
            {item.active ? 'Deactivate' : 'Reactivate'}
          </button>
        </>
      }
    >
      <p className="text-sm font-medium text-[var(--ink)]">{item.name}</p>
      <ActivePill active={item.active} />
      {item.detailLabel ? (
        <p className="text-[11.5px] text-[var(--muted)]">
          Detail field: <span className="text-[var(--ink)]">{item.detailLabel}</span>
        </p>
      ) : null}
    </CatalogCardShell>
  );
}

function ReferralSourceAddForm() {
  const clinic = useClinic();
  const [draftName, setDraftName] = useState('');
  const [draftDetailLabel, setDraftDetailLabel] = useState('');
  const [error, setError] = useState<string | null>(null);

  async function addItem() {
    setError(null);
    const name = draftName.trim();
    if (!name) {
      setError('Name is required');
      return;
    }
    await repos.referringSourceCatalog.put({
      id: crypto.randomUUID(),
      clinicId: clinic.id,
      name,
      detailLabel: draftDetailLabel.trim() || null,
      active: true,
      updatedAt: new Date().toISOString(),
    });
    setDraftName('');
    setDraftDetailLabel('');
  }

  return (
    <CatalogAddCard
      title="Add a referral source"
      hint='e.g. "Instagram ad" or "Doctor referral" with detail "Referring doctor".'
    >
      <div className="space-y-2">
        <input
          className={inputCls}
          placeholder="Source name"
          value={draftName}
          onChange={(e) => setDraftName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') void addItem();
          }}
        />
        <input
          className={inputCls}
          placeholder="Detail field label (optional)"
          value={draftDetailLabel}
          onChange={(e) => setDraftDetailLabel(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') void addItem();
          }}
        />
        <button type="button" className={`${btnSecondary} w-full`} onClick={() => void addItem()}>
          + Add
        </button>
        <ErrorNote message={error} />
      </div>
    </CatalogAddCard>
  );
}
