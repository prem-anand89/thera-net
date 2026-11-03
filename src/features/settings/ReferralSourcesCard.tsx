import { useEffect, useMemo, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { useClinic } from '@/app/clinicContext';
import { repos, catalogService } from '@/services';
import type { ReferringSourceItem } from '@/domain/types';
import { Field, inputCls, btnPrimary, btnSecondary, ErrorNote, SectionCard } from '@/components/ui';
import { nameCheck, nameCheckBlocks } from '@/domain/nameCheck';
import { REFERRALS_CARD_ID } from './sections';
import { CatalogActionButton, CatalogAddCard, CatalogCardShell, InactivePill, NameCheckNote, saveErrorMessage } from './catalogShared';

/** "How patients found you": the referral sources staff pick when adding a patient. Lives on the General tab. */
export function ReferralSourcesCard() {
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
  const activeCount = itemList.filter((i) => i.active).length;

  return (
    <SectionCard id={REFERRALS_CARD_ID} title="How patients found you">
      <p className="mb-3 text-xs text-[var(--muted)]">
        Asked when you add a patient. Feeds the Referral sources report. Hide a source instead of deleting it, so
        existing patients keep showing it. Optionally add a <strong>detail field label</strong>: when staff pick that
        source, the patient form shows an extra box with that label (e.g. &quot;Referring doctor&quot;).
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
            <ReferralSourceCard key={item.id} item={item} all={itemList} />
          ))}
        </div>
      ) : (
        <p className="mb-6 text-xs text-[var(--muted)]">No referral sources yet.</p>
      )}
      <ReferralSourceAddForm all={itemList} />
    </SectionCard>
  );
}

function ReferralSourceCard({ item, all }: { item: ReferringSourceItem; all: ReferringSourceItem[] }) {
  const [editing, setEditing] = useState(false);
  const [nameDraft, setNameDraft] = useState(item.name);
  const [detailDraft, setDetailDraft] = useState(item.detailLabel ?? '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const check = nameCheck(nameDraft, all, { selfId: item.id });

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
    if (nameCheckBlocks(check)) return;
    setSaving(true);
    setError(null);
    try {
      await catalogService.updateReferralSource({
        ...item,
        name,
        detailLabel: detailDraft.trim() || null,
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
            <button type="button" className={btnPrimary} disabled={saving || nameCheckBlocks(check)} onClick={() => void save()}>
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
          <NameCheckNote result={check} hiddenText="is hidden" onUse={setNameDraft} />
        </Field>
        <Field label="Detail field label (optional)">
          <input
            className={inputCls}
            placeholder="e.g. Referring doctor"
            value={detailDraft}
            onChange={(e) => setDetailDraft(e.target.value)}
          />
          <p className="mt-1 text-hint text-[var(--muted)]">
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
          <CatalogActionButton onClick={() => setEditing(true)}>Edit</CatalogActionButton>
          <CatalogActionButton tone={item.active ? 'rust' : 'teal'} onClick={() => void toggleActive()}>
            {item.active ? 'Hide' : 'Show'}
          </CatalogActionButton>
        </>
      }
    >
      <p className="text-sm font-medium text-[var(--ink)]">{item.name}</p>
      {!item.active && <InactivePill />}
      {item.detailLabel ? (
        <p className="text-hint text-[var(--muted)]">
          Detail field: <span className="text-[var(--ink)]">{item.detailLabel}</span>
        </p>
      ) : null}
    </CatalogCardShell>
  );
}

function ReferralSourceAddForm({ all }: { all: ReferringSourceItem[] }) {
  const clinic = useClinic();
  const [draftName, setDraftName] = useState('');
  const [draftDetailLabel, setDraftDetailLabel] = useState('');
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
      await catalogService.addReferralSource({
        id: crypto.randomUUID(),
        clinicId: clinic.id,
        name,
        detailLabel: draftDetailLabel.trim() || null,
        active: true,
        updatedAt: new Date().toISOString(),
      });
      setDraftName('');
      setDraftDetailLabel('');
    } catch (e) {
      setError(saveErrorMessage(e));
    }
  }

  /** "Show it again": switches the hidden source with this name back on, instead of adding a second one. */
  async function showAgain(match: ReferringSourceItem) {
    try {
      await repos.referringSourceCatalog.put({ ...match, active: true, updatedAt: new Date().toISOString() });
      setDraftName('');
      setDraftDetailLabel('');
    } catch (e) {
      setError(saveErrorMessage(e));
    }
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
        <NameCheckNote result={check} hiddenText="is hidden" restoreLabel="Show it again" onRestore={(m) => void showAgain(m)} onUse={setDraftName} />
        <button type="button" className={`${btnSecondary} w-full`} disabled={nameCheckBlocks(check)} onClick={() => void addItem()}>
          + Add
        </button>
        <ErrorNote message={error} />
      </div>
    </CatalogAddCard>
  );
}
