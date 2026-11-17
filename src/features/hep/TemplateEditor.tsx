// Create or edit a template: a named list of exercises with their doses, in the same three blocks as a program
// (Warm-up, Main exercises by type, Cool-down). Items are copies: changing the Library later never changes a template.
// "Preview as patient" shows it as a patient would see it. Saving needs a connection; closing with unsaved changes asks.
import { useEffect, useState } from 'react';
import { Button } from '@/components/Button';
import { ConfirmDialog, Field, SheetDialog, btnPrimary, btnSecondary, inputCls } from '@/components/ui';
import type { ExerciseTemplate } from '@/domain/hep';
import { isDoseValid } from '@/domain/hepDose';
import { useClinic } from '@/app/clinicContext';
import { hepService, HEP_NEEDS_CONNECTION, type HepItemInput } from '@/services/hepService';
import { ExercisePicker } from './ExercisePicker';
import { ProgramPreviewDialog } from './PatientPreview';
import { ProgramItemsEditor } from './ProgramItemsEditor';
import { itemDose, orderBySection, templateItemToInput, type ItemBlock } from './hepItems';
import { commonSessionsPerDay } from './programDraft';
import { useExercises, useOnline } from './useHepData';

export interface TemplateEditorProps {
  open: boolean;
  /** The template to edit; absent for a new one. */
  template?: ExerciseTemplate;
  onClose: () => void;
  onSaved: () => void;
}

type Draft = { title: string; note: string; items: HepItemInput[] };
const fromTemplate = (t?: ExerciseTemplate): Draft => ({ title: t?.title ?? '', note: t?.note ?? '', items: (t?.items ?? []).map(templateItemToInput) });

export function TemplateEditor({ open, template, onClose, onSaved }: TemplateEditorProps) {
  const clinic = useClinic();
  const online = useOnline();
  const library = useExercises(clinic.id) ?? [];
  const [draft, setDraft] = useState<Draft>(fromTemplate());
  const [initial, setInitial] = useState<Draft>(fromTemplate());
  const [picking, setPicking] = useState<ItemBlock | null>(null);
  const [previewing, setPreviewing] = useState(false);
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    const d = fromTemplate(template);
    setDraft(d);
    setInitial(d);
    setPicking(null);
    setPreviewing(false);
    setConfirmDiscard(false);
    setError(null);
    setBusy(false);
  }, [open, template]);

  const { title, note, items } = draft;
  const set = (patch: Partial<Draft>) => setDraft((d) => ({ ...d, ...patch }));
  const valid = title.trim().length > 0 && items.length > 0 && items.every((i) => isDoseValid(itemDose(i)));
  const dirty = JSON.stringify(draft) !== JSON.stringify(initial);
  const sessionsPerDay = commonSessionsPerDay(items);
  const close = () => (dirty && !busy ? setConfirmDiscard(true) : onClose());

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
      <Button type="button" className={btnSecondary} onClick={close} disabled={busy}>Cancel</Button>
      <Button type="button" className={btnSecondary} onClick={() => setPreviewing(true)} disabled={busy || items.length === 0}>Preview as patient</Button>
      <Button type="button" className={btnPrimary} onClick={() => void save()} disabled={busy || !valid || !online}>
        {busy ? 'Saving…' : !online ? 'Needs a connection' : 'Save template'}
      </Button>
    </>
  );

  return (
    <>
      <SheetDialog open={open} wide title={template ? 'Edit template' : 'New template'} onClose={close} busy={busy} error={error} footer={footer}>
        <div className="space-y-4">
          <div className="grid grid-cols-1 gap-3 tab:grid-cols-2">
            <Field label="Template name"><input className={inputCls} value={title} maxLength={80} onChange={(e) => set({ title: e.target.value })} placeholder="For example Knee replacement, week 1" /></Field>
            <Field label="Short note (optional)" hint={`${note.length}/120`}><input className={inputCls} value={note} maxLength={120} onChange={(e) => set({ note: e.target.value })} placeholder="When to use it" /></Field>
          </div>
          <ProgramItemsEditor items={items} setItems={(next) => set({ items: next })} sessionsPerDay={sessionsPerDay} library={library} onAdd={setPicking} forTemplate />
        </div>
      </SheetDialog>
      <ExercisePicker
        open={open && picking !== null}
        onClose={() => setPicking(null)}
        target={picking ?? undefined}
        disabledIds={new Set(items.map((i) => i.sourceExerciseId).filter((x): x is string => !!x))}
        onAdd={(list) => setDraft((d) => ({ ...d, items: [...d.items, ...list] }))}
      />
      <ProgramPreviewDialog open={open && previewing} onClose={() => setPreviewing(false)} clinicId={clinic.id} clinicName={clinic.name} title={title.trim() || 'Template'} items={orderBySection(items)} sessionsPerDay={sessionsPerDay} />
      <ConfirmDialog open={confirmDiscard} title="Discard unsaved changes?" message="What you changed in this template will not be saved." confirmLabel="Discard" destructive onConfirm={() => { setConfirmDiscard(false); onClose(); }} onCancel={() => setConfirmDiscard(false)} />
    </>
  );
}
