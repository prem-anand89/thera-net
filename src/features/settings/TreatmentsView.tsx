import { useEffect, useMemo, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { useClinic } from '@/app/clinicContext';
import { repos, catalogService } from '@/services';
import type { TreatmentItem } from '@/domain/types';
import { Field, inputCls, btnPrimary, btnSecondary, ErrorNote, SectionCard } from '@/components/ui';
import { nameCheck, nameCheckBlocks } from '@/domain/nameCheck';
import { CatalogActionButton, CatalogAddCard, CatalogCardShell, InactivePill, NameCheckNote, saveErrorMessage } from './catalogShared';

export function TreatmentCatalog() {
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
    <SectionCard id="settings-card-services-treatments" title="Treatments">
      <p className="mb-3 text-xs text-[var(--muted)]">
        What you did in the session, for your clinical record. Not on the bill. Shown as quick picks on each visit,
        most used first. Hide a treatment instead of deleting it, so past visits keep showing it.
      </p>
      {itemList.length - activeCount > 0 && (
        <label className="mb-4 flex items-center gap-2 text-xs text-[var(--muted)]">
          <input type="checkbox" checked={showInactive} onChange={(e) => setShowInactive(e.target.checked)} />
          Show hidden ({itemList.length - activeCount})
        </label>
      )}
      {visible.length > 0 ? (
        <div className="mb-6 grid grid-cols-1 gap-2.5 sm:grid-cols-2 lg:grid-cols-3">
          {visible.map((item) => (
            <TreatmentCard key={item.id} item={item} all={itemList} />
          ))}
        </div>
      ) : (
        <p className="mb-6 text-xs text-[var(--muted)]">No treatments yet.</p>
      )}
      <TreatmentAddForm all={itemList} />
    </SectionCard>
  );
}

function TreatmentCard({ item, all }: { item: TreatmentItem; all: TreatmentItem[] }) {
  const [editing, setEditing] = useState(false);
  const [nameDraft, setNameDraft] = useState(item.name);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const check = nameCheck(nameDraft, all, { selfId: item.id });

  useEffect(() => {
    if (!editing) setNameDraft(item.name);
  }, [item.name, editing]);

  async function save() {
    const trimmed = nameDraft.trim();
    if (!trimmed) {
      setError('Name is required');
      return;
    }
    if (nameCheckBlocks(check)) return;
    setSaving(true);
    setError(null);
    try {
      await catalogService.updateTreatment({
        ...item,
        name: trimmed,
        updatedAt: new Date().toISOString(),
      });
      setEditing(false);
    } catch (e) {
      setError(saveErrorMessage(e));
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
            <button type="button" className={btnPrimary} disabled={saving || nameCheckBlocks(check)} onClick={() => void save()}>
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
          <NameCheckNote result={check} hiddenText="is hidden" onUse={setNameDraft} />
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
          <CatalogActionButton onClick={() => setEditing(true)}>Edit</CatalogActionButton>
          <CatalogActionButton tone={item.active ? 'rust' : 'teal'} onClick={() => void toggleActive()}>
            {item.active ? 'Hide' : 'Show'}
          </CatalogActionButton>
        </>
      }
    >
      <p className="text-sm font-medium text-[var(--ink)]">{item.name}</p>
      {!item.active && <InactivePill />}
    </CatalogCardShell>
  );
}

function TreatmentAddForm({ all }: { all: TreatmentItem[] }) {
  const clinic = useClinic();
  const [draftName, setDraftName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const check = nameCheck(draftName, all);

  async function addItem() {
    setError(null);
    const name = draftName.trim();
    if (!name) {
      setError('Name is required');
      return;
    }
    if (nameCheckBlocks(check)) return;
    try {
      await catalogService.addTreatment({
        id: crypto.randomUUID(),
        clinicId: clinic.id,
        name,
        active: true,
        updatedAt: new Date().toISOString(),
      });
      setDraftName('');
    } catch (e) {
      setError(saveErrorMessage(e));
    }
  }

  /** "Show it again": switches the hidden treatment with this name back on, instead of adding a second one. */
  async function showAgain(match: TreatmentItem) {
    try {
      await repos.treatmentCatalog.put({ ...match, active: true, updatedAt: new Date().toISOString() });
      setDraftName('');
    } catch (e) {
      setError(saveErrorMessage(e));
    }
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
        <button type="button" className={btnSecondary} disabled={nameCheckBlocks(check)} onClick={() => void addItem()}>
          + Add
        </button>
      </div>
      <NameCheckNote result={check} hiddenText="is hidden" restoreLabel="Show it again" onRestore={(m) => void showAgain(m)} onUse={setDraftName} />
      <ErrorNote message={error} />
    </CatalogAddCard>
  );
}

