// HEP > Templates: named recipes ("Knee replacement, week 1") that become a patient's program in one step.
// Templates live on the server only (no offline copy): this tab needs a connection and says so.
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useClinic } from '@/app/clinicContext';
import { Button } from '@/components/Button';
import { ConfirmDialog, ErrorNote, KebabMenu, LoadingRows, btnPrimary, inputCls, menuItem, menuItemDestructive, pillSmAccent, pillSmNeutral, pillSmPrimary } from '@/components/ui';
import { EXERCISE_PHASE_LABELS, type ExerciseTemplate } from '@/domain/hep';
import { hepService } from '@/services/hepService';
import { groupItemsByPhase, itemsMinutes, itemsNeed, templateItemToInput } from './hepItems';
import { TemplateEditor } from './TemplateEditor';
import { useOnline } from './useHepData';

type TemplateRow = ExerciseTemplate & { usedCount: number };

export interface TemplatesTabProps {
  /** "Use for a patient": opens the program sheet (wired by the patient chart work). Hidden when absent. */
  onUse?: (template: ExerciseTemplate) => void;
  /** Change this number to load the list again (a template was used, so its count changed). */
  reloadKey?: number;
}

export function sectionLine(items: ExerciseTemplate['items']): string {
  return groupItemsByPhase(items.map(templateItemToInput)).map((s) => `${EXERCISE_PHASE_LABELS[s.phase]} ${s.rows.length}`).join(' · ');
}

export function TemplatesTab({ onUse, reloadKey = 0 }: TemplatesTabProps) {
  const clinic = useClinic();
  const online = useOnline();
  const [rows, setRows] = useState<TemplateRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [editor, setEditor] = useState<{ template?: TemplateRow } | null>(null);
  const [deleting, setDeleting] = useState<TemplateRow | null>(null);

  const load = useCallback(async () => {
    try {
      setError(null);
      setRows(await hepService.listTemplates(clinic.id));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load the templates.');
      setRows((cur) => cur ?? []);
    }
  }, [clinic.id]);

  useEffect(() => { if (online) void load(); }, [online, load, reloadKey]);

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!rows) return [];
    if (!q) return rows;
    return rows.filter((t) => [t.title, t.note ?? '', ...t.items.map((i) => i.title)].join(' ').toLowerCase().includes(q));
  }, [rows, query]);

  async function duplicate(t: TemplateRow) {
    try { setError(null); await hepService.duplicateTemplate(t.id); await load(); } catch (e) { setError(e instanceof Error ? e.message : 'Could not duplicate the template.'); }
  }
  async function remove(t: TemplateRow) {
    try {
      setError(null);
      await hepService.saveTemplate({ clinicId: clinic.id, templateId: t.id, title: t.title, note: t.note, items: [], deleted: true });
      setDeleting(null);
      await load();
    } catch (e) { setError(e instanceof Error ? e.message : 'Could not delete the template.'); setDeleting(null); }
  }

  if (!online && rows === null) return <p className="rounded-xl border border-dashed border-[var(--border)] p-6 text-center text-sm text-[var(--muted)]">Templates need a connection. Reconnect to see and edit them.</p>;
  if (rows === null) return <LoadingRows rows={3} label="Loading templates" />;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <input type="search" aria-label="Search templates" placeholder="Search templates" className={`${inputCls} max-w-xs`} value={query} onChange={(e) => setQuery(e.target.value)} />
        <div className="flex-1" />
        <Button type="button" className={btnPrimary} disabled={!online} onClick={() => setEditor({})}>{online ? '+ New template' : 'Needs a connection'}</Button>
      </div>
      <ErrorNote message={error} />
      {rows.length === 0 && !error && (
        <div className="space-y-2 rounded-2xl border border-dashed border-[var(--border)] p-6 text-center">
          <p className="font-display text-base font-semibold text-[var(--ink)]">No templates yet</p>
          <p className="mx-auto max-w-md text-sm text-[var(--muted)]">A template is a ready list of exercises, like “Knee replacement, week 1”. Build one, then use it for each patient. You can also save any program as a template.</p>
        </div>
      )}
      {rows.length > 0 && shown.length === 0 && <p className="py-6 text-center text-sm text-[var(--muted)]">No templates match “{query}”.</p>}
      <ul className="grid gap-3 desktop:grid-cols-2">
        {shown.map((t) => {
          const items = t.items.map(templateItemToInput);
          const needs = itemsNeed(items);
          return (
            <li key={t.id} className="space-y-2 rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-4">
              <div className="flex items-start gap-2">
                <div className="min-w-0 flex-1">
                  <h3 className="truncate font-display text-base font-semibold text-[var(--ink)]">{t.title}</h3>
                  {t.note && <p className="text-sm text-[var(--muted)]">{t.note}</p>}
                </div>
                <KebabMenu ariaLabel={`Actions for ${t.title}`}>
                  {(close) => (
                    <>
                      <button type="button" className={menuItem} onClick={() => { close(); void duplicate(t); }}>Duplicate</button>
                      <button type="button" className={menuItemDestructive} onClick={() => { close(); setDeleting(t); }}>Delete</button>
                    </>
                  )}
                </KebabMenu>
              </div>
              <p className="text-sm text-[var(--ink)]">{items.length} {items.length === 1 ? 'exercise' : 'exercises'} · about {itemsMinutes(items)} min</p>
              {items.length > 0 && <p className="text-xs text-[var(--muted)]">{sectionLine(t.items)}</p>}
              <p className="text-xs text-[var(--muted)]">{needs.length > 0 ? `Needs: ${needs.join(', ')}` : 'Needs no equipment'} · used {t.usedCount} {t.usedCount === 1 ? 'time' : 'times'}</p>
              <div className="flex flex-wrap gap-2 pt-1">
                {onUse && <Button type="button" className={pillSmPrimary} onClick={() => onUse(t)}>Use for a patient</Button>}
                <Button type="button" className={onUse ? pillSmAccent : pillSmNeutral} disabled={!online} onClick={() => setEditor({ template: t })}>Edit</Button>
              </div>
            </li>
          );
        })}
      </ul>
      <TemplateEditor open={editor !== null} template={editor?.template} onClose={() => setEditor(null)} onSaved={() => void load()} />
      <ConfirmDialog
        open={deleting !== null}
        title="Delete this template?"
        message={`“${deleting?.title ?? ''}” will be removed from the list. Programs already made from it are not changed.`}
        confirmLabel="Delete"
        destructive
        onConfirm={() => deleting && void remove(deleting)}
        onCancel={() => setDeleting(null)}
      />
    </div>
  );
}
