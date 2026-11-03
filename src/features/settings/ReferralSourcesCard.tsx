import { useId, useMemo, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { useClinic } from '@/app/clinicContext';
import { repos, catalogService } from '@/services';
import type { ReferringSourceItem } from '@/domain/types';
import { btnPrimary, btnSecondary, Field, inputCls, SectionCard, SheetDialog } from '@/components/ui';
import { nameCheck, nameCheckBlocks } from '@/domain/nameCheck';
import { REFERRALS_CARD_ID } from './sections';
import { SwitchRow } from './settingsShared';
import { HiddenItemsFooter, NameCheckNote, saveErrorMessage } from './catalogShared';

type SourceSheet = { kind: 'add' } | { kind: 'edit'; item: ReferringSourceItem };

/**
 * Referral sources: how patients found the clinic, picked when adding a patient (General tab). One list card, one
 * row per source with its follow-up question under the name; "+ Add" in the header and a tap on a row open the same
 * small sheet; hidden sources sit in a footer. The follow-up question is the old "detail field label" (`detail_label`).
 */
export function ReferralSourcesCard() {
  const clinic = useClinic();
  const items = useLiveQuery(() => repos.referringSourceCatalog.list(clinic.id, true), [clinic.id]);
  const [sheet, setSheet] = useState<SourceSheet | null>(null);
  const [hiddenOpen, setHiddenOpen] = useState(false);
  const all = useMemo(() => items ?? [], [items]);
  const shown = useMemo(() => all.filter((i) => i.active).sort((a, b) => a.name.localeCompare(b.name)), [all]);
  const hidden = useMemo(() => all.filter((i) => !i.active).sort((a, b) => a.name.localeCompare(b.name)), [all]);

  return (
    <SectionCard
      id={REFERRALS_CARD_ID}
      title="Referral sources"
      action={
        <button type="button" className={`${btnPrimary} min-h-9 px-3 text-sm`} onClick={() => setSheet({ kind: 'add' })}>
          + Add
        </button>
      }
    >
      <p className="mb-3 text-xs text-[var(--muted)]">
        How patients found you. Asked when you add a patient; feeds the Referral sources report.
      </p>
      {shown.length === 0 ? (
        <p className="py-4 text-sm text-[var(--muted)]">
          {hidden.length > 0
            ? 'No sources shown right now. Show one again under Hidden, or add one with "+ Add".'
            : 'No sources yet. Add the first one with "+ Add".'}
        </p>
      ) : (
        <div className="overflow-clip rounded-xl border border-[var(--border)] bg-[var(--surface)]">
          {shown.map((item) => (
            <SourceRow key={item.id} item={item} onOpen={() => setSheet({ kind: 'edit', item })} />
          ))}
        </div>
      )}
      <HiddenItemsFooter label="Hidden" count={hidden.length} open={hiddenOpen} onToggle={() => setHiddenOpen((v) => !v)}>
        {hidden.map((item) => (
          <SourceRow key={item.id} item={item} dim onOpen={() => setSheet({ kind: 'edit', item })} />
        ))}
      </HiddenItemsFooter>
      {sheet && <SourceForm key={sheet.kind === 'edit' ? sheet.item.id : 'add'} mode={sheet} all={all} onClose={() => setSheet(null)} />}
    </SectionCard>
  );
}

function SourceRow({ item, dim = false, onOpen }: { item: ReferringSourceItem; dim?: boolean; onOpen: () => void }) {
  const question = item.detailLabel?.trim();
  return (
    <button
      type="button"
      aria-label={`Edit ${item.name}`}
      className={`flex min-h-11 w-full items-center gap-3 border-t border-[var(--border)] px-3 py-2.5 text-left first:border-t-0 hover:bg-[var(--paper)] active:bg-[var(--paper)] ${
        dim ? 'opacity-60' : ''
      }`}
      onClick={onOpen}
    >
      <span className="min-w-0 flex-1">
        <span className="block break-words text-sm font-medium text-[var(--ink)]">{item.name}</span>
        {question && <span className="block text-xs text-[var(--muted)]">Then asks: {question}</span>}
      </span>
      <span aria-hidden="true" className="shrink-0 text-lg text-[var(--muted)]">›</span>
    </button>
  );
}

/** "Add a source" / "Edit source": name (checked as you type), an optional follow-up question, and whether it is shown. */
function SourceForm({ mode, all, onClose }: { mode: SourceSheet; all: ReferringSourceItem[]; onClose: () => void }) {
  const clinic = useClinic();
  const editing = mode.kind === 'edit' ? mode.item : null;
  const [name, setName] = useState(editing?.name ?? '');
  const [asks, setAsks] = useState(Boolean(editing?.detailLabel?.trim()));
  const [question, setQuestion] = useState(editing?.detailLabel ?? '');
  const [active, setActive] = useState(editing?.active ?? true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const nameId = useId();
  const questionId = useId();
  const check = nameCheck(name, all, { selfId: editing?.id });

  async function save() {
    setError(null);
    if (!name.trim()) return setError('Enter a name.');
    if (nameCheckBlocks(check)) return;
    if (asks && !question.trim()) return setError('Enter the question, or turn off "Ask a follow-up question".');
    // Turning the follow-up off clears the question: the patient form then shows no extra box.
    const detailLabel = asks ? question.trim() : null;
    setSaving(true);
    try {
      const now = new Date().toISOString();
      if (editing) await catalogService.updateReferralSource({ ...editing, name: name.trim(), detailLabel, active, updatedAt: now });
      else await catalogService.addReferralSource({ id: crypto.randomUUID(), clinicId: clinic.id, name: name.trim(), detailLabel, active: true, updatedAt: now });
      onClose();
    } catch (e) {
      setError(saveErrorMessage(e));
    } finally {
      setSaving(false);
    }
  }

  /** "Show it again": switches the hidden source with this name back on instead of adding a second one. */
  async function showAgain(match: ReferringSourceItem) {
    setSaving(true);
    setError(null);
    try {
      await repos.referringSourceCatalog.put({ ...match, active: true, updatedAt: new Date().toISOString() });
      onClose();
    } catch (e) {
      setError(saveErrorMessage(e));
    } finally {
      setSaving(false);
    }
  }

  return (
    <SheetDialog
      open
      title={editing ? 'Edit source' : 'Add a source'}
      onClose={onClose}
      busy={saving}
      error={error}
      footer={
        <>
          <button type="button" className={btnSecondary} disabled={saving} onClick={onClose}>
            Cancel
          </button>
          <button type="button" className={btnPrimary} disabled={saving || nameCheckBlocks(check)} onClick={() => void save()}>
            {saving ? 'Saving…' : editing ? 'Save' : 'Add'}
          </button>
        </>
      }
    >
      <Field label="Name" htmlFor={nameId}>
        <input
          id={nameId}
          className={inputCls}
          value={name}
          placeholder="e.g. Doctor referral"
          onChange={(e) => setName(e.target.value)}
          autoFocus
          autoComplete="off"
        />
        <NameCheckNote
          result={check}
          hiddenText="is hidden"
          restoreLabel={editing ? undefined : 'Show it again'}
          onRestore={editing ? undefined : (m) => void showAgain(m)}
          onUse={setName}
        />
      </Field>
      <div className="mt-3 border-t border-[var(--border)] pt-1">
        <SwitchRow label="Ask a follow-up question" hint="Adds one more box on the patient form." checked={asks} onChange={setAsks} />
        {asks && (
          <div className="mt-2">
          <Field label="Question" htmlFor={questionId} hint='Shown as the label of the extra box, e.g. "Referring doctor".'>
            <input
              id={questionId}
              className={inputCls}
              value={question}
              placeholder="e.g. Referring doctor"
              onChange={(e) => setQuestion(e.target.value)}
              autoComplete="off"
            />
          </Field>
          </div>
        )}
      </div>
      {editing && (
        <div className="mt-3 border-t border-[var(--border)] pt-1">
          <SwitchRow label="Shown" hint="Turn off to hide this source from new patients. Existing patients keep it." checked={active} onChange={setActive} />
        </div>
      )}
    </SheetDialog>
  );
}
