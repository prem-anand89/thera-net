// Create or edit a template: a named list of exercises with their doses, grouped in the order a patient does them
// (warm-up first). Items are copies: changing the Library later never changes a template. Saving needs a connection.
import { useEffect, useState } from 'react';
import { Button } from '@/components/Button';
import { Field, SheetDialog, btnPrimary, btnSecondary, inputCls } from '@/components/ui';
import { EXERCISE_PHASE_LABELS, type ExerciseTemplate } from '@/domain/hep';
import { describeDose, isDoseValid } from '@/domain/hepDose';
import { useClinic } from '@/app/clinicContext';
import { hepService, HEP_NEEDS_CONNECTION, type HepItemInput } from '@/services/hepService';
import { ExerciseDoseEditor } from './ExerciseDoseEditor';
import { ExercisePicker } from './ExercisePicker';
import { exerciseToItem, groupItemsByPhase, itemDose, itemsMinutes, moveWithinSection, orderBySection, templateItemToInput, withItemDose } from './hepItems';
import { useOnline } from './useHepData';

export interface TemplateEditorProps {
  open: boolean;
  /** The template to edit; absent for a new one. */
  template?: ExerciseTemplate;
  onClose: () => void;
  onSaved: () => void;
}

export function TemplateEditor({ open, template, onClose, onSaved }: TemplateEditorProps) {
  const clinic = useClinic();
  const online = useOnline();
  const [title, setTitle] = useState('');
  const [note, setNote] = useState('');
  const [items, setItems] = useState<HepItemInput[]>([]);
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(new Set());
  const [editing, setEditing] = useState<number | null>(null);
  const [picking, setPicking] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setTitle(template?.title ?? '');
    setNote(template?.note ?? '');
    setItems((template?.items ?? []).map(templateItemToInput));
    setCollapsed(new Set());
    setEditing(null);
    setError(null);
    setBusy(false);
  }, [open, template]);

  const sections = groupItemsByPhase(items);
  const valid = title.trim().length > 0 && items.length > 0 && items.every((i) => isDoseValid(itemDose(i)));
  const allCollapsed = sections.length > 0 && sections.every((s) => collapsed.has(s.phase));

  async function save() {
    if (!online) { setError(HEP_NEEDS_CONNECTION); return; }
    setBusy(true);
    setError(null);
    try {
      await hepService.saveTemplate({ clinicId: clinic.id, templateId: template?.id, title: title.trim(), note: note.trim() || null, items: orderBySection(items) });
      onSaved();
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save the template.');
    } finally {
      setBusy(false);
    }
  }

  const footer = (
    <>
      <Button type="button" className={btnSecondary} onClick={onClose} disabled={busy}>Cancel</Button>
      <Button type="button" className={btnPrimary} onClick={() => void save()} disabled={busy || !valid || !online}>
        {busy ? 'Saving…' : !online ? 'Needs a connection' : 'Save template'}
      </Button>
    </>
  );

  return (
    <>
      <SheetDialog open={open} wide title={template ? 'Edit template' : 'New template'} onClose={onClose} busy={busy} error={error} footer={footer}>
        <div className="space-y-4">
          <div className="grid gap-3 tab:grid-cols-2">
            <Field label="Template name"><input className={inputCls} value={title} maxLength={80} onChange={(e) => setTitle(e.target.value)} placeholder="For example Knee replacement, week 1" /></Field>
            <Field label="Short note (optional)" hint={`${note.length}/120`}><input className={inputCls} value={note} maxLength={120} onChange={(e) => setNote(e.target.value)} placeholder="When to use it" /></Field>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <p className="text-sm text-[var(--muted)]" aria-live="polite">
              {items.length} {items.length === 1 ? 'exercise' : 'exercises'}{items.length > 0 && <> · about {itemsMinutes(items)} min</>}
            </p>
            <div className="flex-1" />
            {sections.length > 1 && (
              <Button type="button" className="text-xs font-medium text-[var(--teal)]" onClick={() => setCollapsed(allCollapsed ? new Set() : new Set(sections.map((s) => s.phase)))}>
                {allCollapsed ? 'Expand all' : 'Collapse all'}
              </Button>
            )}
            <Button type="button" className={btnSecondary} onClick={() => setPicking(true)}>+ Add exercises</Button>
          </div>

          {items.length === 0 && <p className="rounded-xl border border-dashed border-[var(--border)] p-6 text-center text-sm text-[var(--muted)]">No exercises yet. Add some from the Library.</p>}

          {sections.map((s) => {
            const closed = collapsed.has(s.phase);
            return (
              <section key={s.phase} aria-label={EXERCISE_PHASE_LABELS[s.phase]} className="space-y-1.5">
                <button type="button" aria-expanded={!closed} className="flex w-full items-center justify-between text-left" onClick={() => setCollapsed((cur) => { const n = new Set(cur); if (n.has(s.phase)) n.delete(s.phase); else n.add(s.phase); return n; })}>
                  <h3 className="font-display text-sm font-semibold text-[var(--ink)]">{closed ? '▸' : '▾'} {EXERCISE_PHASE_LABELS[s.phase]} <span className="font-normal text-[var(--muted)]">({s.rows.length})</span></h3>
                </button>
                {!closed && (
                  <ul className="space-y-1.5">
                    {s.rows.map(({ item, index }, pos) => (
                      <li key={`${item.sourceExerciseId ?? item.title}-${index}`} className="rounded-xl border border-[var(--border)] bg-[var(--surface)]">
                        <div className="flex items-center gap-2 p-2">
                          <button type="button" aria-expanded={editing === index} className="min-w-0 flex-1 text-left" onClick={() => setEditing(editing === index ? null : index)}>
                            <span className="block truncate text-sm font-semibold text-[var(--ink)]">{item.title}{item.optional && <span className="ml-2 text-xs font-medium text-[var(--muted)]">Optional</span>}</span>
                            <span className="block truncate text-xs text-[var(--muted)]">{describeDose(itemDose(item), 1)}</span>
                          </button>
                          <Button type="button" aria-label={`Move ${item.title} up`} className="min-h-9 min-w-9 text-[var(--muted)] disabled:opacity-30" disabled={pos === 0} onClick={() => setItems(moveWithinSection(items, index, -1))}>↑</Button>
                          <Button type="button" aria-label={`Move ${item.title} down`} className="min-h-9 min-w-9 text-[var(--muted)] disabled:opacity-30" disabled={pos === s.rows.length - 1} onClick={() => setItems(moveWithinSection(items, index, 1))}>↓</Button>
                          <Button type="button" aria-label={`Remove ${item.title}`} className="min-h-9 min-w-9 text-[var(--rust)]" onClick={() => { setItems(items.filter((_, i) => i !== index)); setEditing(null); }}>✕</Button>
                        </div>
                        {editing === index && (
                          <div className="border-t border-[var(--border)] p-3">
                            <ExerciseDoseEditor value={itemDose(item)} showOptional onChange={(d) => setItems(items.map((it, i) => (i === index ? withItemDose(it, d) : it)))} />
                          </div>
                        )}
                      </li>
                    ))}
                  </ul>
                )}
              </section>
            );
          })}
        </div>
      </SheetDialog>
      <ExercisePicker
        open={open && picking}
        onClose={() => setPicking(false)}
        disabledIds={new Set(items.map((i) => i.sourceExerciseId).filter((x): x is string => !!x))}
        onAdd={(list) => setItems((cur) => [...cur, ...list.map(exerciseToItem)])}
      />
    </>
  );
}
