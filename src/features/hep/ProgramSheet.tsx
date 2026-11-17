// New / Edit home program. Exercises sit in three blocks (Warm-up, Main exercises by type, Cool-down) on the left; the
// settings sit in a side panel on a desktop and fold into one summary card on a phone. Templates and earlier programs
// come in through the picker's tabs. An edit changes the live program in place (or starts a separate one). Saving needs
// a connection; after a NEW program is saved the hand-over panel shows the PIN once. Opening and cancelling never change
// anything.
import { useEffect, useMemo, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { useClinic } from '@/app/clinicContext';
import { useEntitlements } from '@/app/useEntitlements';
import { useWorkspaceScope } from '@/app/useWorkspaceScope';
import { Button } from '@/components/Button';
import { ConfirmDialog, Field, SheetDialog, btnPrimary, btnSecondary, inputCls, segOption, segTrack } from '@/components/ui';
import { useIsDesktop } from '@/components/useMediaQuery';
import { addDaysISO, type ExerciseTemplate, type SessionsPerDay } from '@/domain/hep';
import { TIER_LIMITS } from '@/domain/plans';
import { repos } from '@/services';
import { HEP_NEEDS_CONNECTION, hepService, type HepItemInput, type ProgramBundle, type ProgramCreated } from '@/services/hepService';
import type { Patient } from '@/domain/types';
import { AddPatientSheet } from '@/features/patients/AddPatientSheet';
import { ExercisePicker, type PickerTab } from './ExercisePicker';
import { HandOverPanel } from './HandOverPanel';
import { ProgramPreviewDialog } from './PatientPreview';
import { ProgramItemsEditor } from './ProgramItemsEditor';
import { ProgramSettingsPanel, settingsSummary } from './ProgramSettingsPanel';
import { orderBySection, type ItemBlock } from './hepItems';
import { blankDraft, changeSessionsPerDay, changesFor, createSettings, draftFromBundle, draftFromTemplate, draftProblem, sameDraft, updateSettings, type ProgramDraft } from './programDraft';
import { clinicToday, useExercises, useOnline } from './useHepData';

export interface ProgramSaved {
  mode: 'new' | 'edit';
  programId: string;
  patientId: string;
  title: string;
}

export interface ProgramSheetProps {
  open: boolean;
  onClose: () => void;
  mode: 'new' | 'edit';
  /** The patient. Absent when starting from a template: the sheet asks who it is for. */
  patientId?: string;
  /** Edit: the program as loaded (its rows, logs and session checks). */
  bundle?: ProgramBundle;
  /** New: start from this template or this earlier program. */
  startFrom?: { template?: ExerciseTemplate; program?: ProgramBundle };
  /** The visit's date when prescribing from a visit note: the program starts that day. */
  startDate?: string;
  onSaved?: (saved: ProgramSaved) => void;
}

export function ProgramSheet({ open, onClose, mode, patientId, bundle, startFrom, startDate, onSaved }: ProgramSheetProps) {
  const clinic = useClinic();
  const online = useOnline();
  const scope = useWorkspaceScope();
  const isDesktop = useIsDesktop();
  const ent = useEntitlements(clinic.id);
  const library = useExercises(clinic.id) ?? [];
  const therapists = useLiveQuery(() => repos.therapists.list(clinic.id), [clinic.id]);
  const today = clinicToday(clinic);

  const [how, setHow] = useState<'new' | 'edit'>(mode);
  const [patient, setPatient] = useState<Patient | null>(null);
  const [draft, setDraft] = useState<ProgramDraft>(blankDraft());
  const [initial, setInitial] = useState<ProgramDraft>(blankDraft());
  const [templateId, setTemplateId] = useState<string | null>(null);
  const [hasEarlier, setHasEarlier] = useState(false);
  const [activeCount, setActiveCount] = useState<number | null>(null);
  const [query, setQuery] = useState('');
  const [matches, setMatches] = useState<Patient[]>([]);
  const [addingPatient, setAddingPatient] = useState(false);
  const [picking, setPicking] = useState<{ target: ItemBlock; tab: PickerTab } | null>(null);
  const [previewing, setPreviewing] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [handOver, setHandOver] = useState<{ created: ProgramCreated; items: HepItemInput[]; title: string; patient: Patient; fromTemplate: boolean } | null>(null);

  // Set the sheet up each time it opens.
  useEffect(() => {
    if (!open) return;
    const me = scope.myTherapistId ?? null;
    let d: ProgramDraft;
    let tid: string | null = null;
    if (mode === 'edit' && bundle) d = draftFromBundle(bundle, 'edit');
    else if (startFrom?.template) { d = draftFromTemplate(startFrom.template, me); tid = startFrom.template.id; }
    else if (startFrom?.program) d = { ...draftFromBundle(startFrom.program, 'copy'), therapistId: me };
    else d = blankDraft(me);
    if (d.therapistId == null) d = { ...d, therapistId: me };
    setHow(mode); setDraft(d); setInitial(d); setTemplateId(tid);
    setPicking(null); setPreviewing(false); setConfirmDiscard(false); setBusy(false); setError(null); setHandOver(null); setQuery(''); setMatches([]);
    setPatient(null);
    const known = patientId ?? (mode === 'edit' ? bundle?.program.patientId : undefined);
    // On a phone the settings card starts open while the patient still has to be chosen.
    setSettingsOpen(!known);
    if (known) void repos.patients.get(known).then((p) => setPatient(p ?? null)).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const knownPatientId = patientId ?? bundle?.program.patientId;
  const pid = patient?.id ?? knownPatientId;

  // Has the patient an earlier program? Only then is "Repeat an earlier program" offered. Today's logs only: light.
  useEffect(() => {
    setHasEarlier(false);
    if (!open || !online || !pid) return;
    let live = true;
    hepService.listPatientPrograms(pid, today).then((list) => { if (live) setHasEarlier(list.some((b) => b.program.id !== bundle?.program.id)); }).catch(() => {});
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, online, pid]);

  // The plan meter, for a new program on a plan with a cap. Offline or on an error: no meter.
  const limit = ent.enforcementEnabled ? TIER_LIMITS[ent.tier]?.activePrograms ?? null : null;
  useEffect(() => {
    setActiveCount(null);
    if (!open || !online || mode !== 'new' || limit == null) return;
    let live = true;
    Promise.resolve().then(() => hepService.countActivePrograms(clinic.id)).then((n) => { if (live) setActiveCount(n); }).catch(() => {});
    return () => { live = false; };
  }, [open, online, mode, limit, clinic.id]);

  // Browse: with nothing typed, the most recently added patients; typing narrows it down.
  useEffect(() => {
    if (!open || patientId) { setMatches([]); return; }
    let live = true;
    const q = query.trim();
    const load = q.length === 0
      ? repos.patients.list(clinic.id).then((list) => list.filter((p) => !p.deletedAt).sort((a, b) => (b.updatedAt ?? '').localeCompare(a.updatedAt ?? '')).slice(0, 8))
      : repos.patients.search(clinic.id, q, 8).then((list) => list.filter((p) => !p.deletedAt));
    void load.then((list) => { if (live) setMatches(list); }).catch(() => { if (live) setMatches([]); });
    return () => { live = false; };
  }, [open, patientId, query, clinic.id]);

  const dirty = !sameDraft(draft, initial);
  const editing = how === 'edit' && !!bundle;
  const needsPatient = !knownPatientId;
  const problem = draftProblem(draft, needsPatient, !!patient || !!knownPatientId);
  const set = (patch: Partial<ProgramDraft>) => setDraft((d) => ({ ...d, ...patch }));
  const before = useMemo(() => (editing && bundle ? draftFromBundle(bundle, 'edit').items : []), [editing, bundle]);
  const changes = editing ? changesFor(before, draft.items) : [];
  const live = bundle?.program;
  const patientName = patient?.name ?? bundle?.patientName ?? null;

  const changeFrequency = (next: SessionsPerDay) => setDraft((d) => ({ ...d, sessionsPerDay: next, items: changeSessionsPerDay(d.items, d.sessionsPerDay, next) }));

  /** From the picker. A template keeps its id (usage count, `sourceTemplateId`); a suggested name fills a blank one. */
  function added(list: HepItemInput[], meta?: { templateId?: string; suggestedTitle?: string }) {
    setDraft((d) => ({
      ...d,
      items: [...d.items, ...list.map((i) => ({ ...i, sessionsPerDay: d.sessionsPerDay }))],
      title: d.title.trim() === '' && meta?.suggestedTitle ? meta.suggestedTitle : d.title,
    }));
    if (meta?.templateId) setTemplateId(meta.templateId);
  }

  async function save() {
    if (problem) { setError(problem); return; }
    if (!online) { setError(HEP_NEEDS_CONNECTION); return; }
    setBusy(true);
    setError(null);
    try {
      const items = orderBySection(draft.items);
      if (editing && bundle) {
        await hepService.updateProgram({ programId: bundle.program.id, title: draft.title.trim(), status: bundle.program.status, items, customPin: draft.customPin || null, today, settings: updateSettings(draft) });
        onSaved?.({ mode: 'edit', programId: bundle.program.id, patientId: bundle.program.patientId, title: draft.title.trim() });
        onClose();
        return;
      }
      if (!pid) throw new Error('Choose the patient.');
      const start = startDate ?? addDaysISO(today, draft.startOffset);
      const created = await hepService.createProgram({ clinicId: clinic.id, patientId: pid, therapistId: draft.therapistId, title: draft.title.trim(), items, customPin: draft.customPin || null, sourceTemplateId: templateId, today: start, settings: createSettings(draft) });
      onSaved?.({ mode: 'new', programId: created.programId, patientId: created.patientId, title: draft.title.trim() });
      const patientRow = patient ?? (await repos.patients.get(pid));
      setHandOver({ created, items, title: draft.title.trim(), patient: patientRow ?? ({ id: pid, name: 'the patient', phone: null } as Patient), fromTemplate: templateId != null });
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save the program.');
    } finally {
      setBusy(false);
    }
  }

  const close = () => (dirty && !busy ? setConfirmDiscard(true) : onClose());

  const footer = (
    <>
      <Button type="button" className={btnSecondary} onClick={close} disabled={busy}>Cancel</Button>
      <Button type="button" className={btnSecondary} onClick={() => setPreviewing(true)} disabled={busy || draft.items.length === 0}>Preview as patient</Button>
      <Button type="button" className={btnPrimary} onClick={() => void save()} disabled={busy || !online || problem !== null}>{busy ? 'Saving…' : !online ? 'Needs a connection' : editing ? 'Save changes' : 'Save and share'}</Button>
    </>
  );

  const patientField = needsPatient ? (
    <section aria-label="Patient" className="space-y-1.5">
      <Field label="Patient">
        {patient ? (
          <div className="flex items-center justify-between rounded-lg border border-[var(--border)] px-3 py-2 text-sm"><span>{patient.name}</span><Button type="button" className="text-xs text-[var(--teal)]" onClick={() => setPatient(null)}>Change</Button></div>
        ) : (
          <input className={inputCls} placeholder="Search by name or number" value={query} onChange={(e) => setQuery(e.target.value)} />
        )}
      </Field>
      {!patient && matches.length > 0 && (
        <ul aria-label={query.trim() ? 'Matching patients' : 'Recent patients'} className="divide-y divide-[var(--border)] rounded-lg border border-[var(--border)]">
          {matches.map((p) => <li key={p.id}><button type="button" className="block w-full px-3 py-2 text-left text-sm hover:bg-[var(--paper)]" onClick={() => { setPatient(p); setQuery(''); }}>{p.name} <span className="text-[var(--muted)]">{p.mrno}</span></button></li>)}
        </ul>
      )}
      {!patient && query.trim().length > 0 && matches.length === 0 && <p className="text-sm text-[var(--muted)]">No patient matches “{query.trim()}”.</p>}
      {!patient && <Button type="button" className={btnSecondary} onClick={() => setAddingPatient(true)}>+ New patient</Button>}
    </section>
  ) : (
    <div className="space-y-0.5">
      <div className="text-label font-medium text-[var(--muted)]">Patient</div>
      <div className="text-sm font-semibold text-[var(--ink)]">{patientName ?? '…'}</div>
    </div>
  );

  const panel = (
    <ProgramSettingsPanel draft={draft} set={set} onFrequency={changeFrequency} editing={editing} liveSessionsPerDay={editing ? live?.sessionsPerDay : undefined}
      startDate={startDate} therapists={therapists ?? []} patientField={patientField} />
  );

  return (
    <>
      <SheetDialog open={open && !handOver} wide="xl" title={editing ? `Edit home program · ${bundle?.patientName ?? ''}` : 'New home program'} onClose={close} busy={busy} error={error} footer={footer}>
        {!editing && mode === 'new' && limit != null && activeCount != null && <p className="-mt-1 mb-3 text-xs text-[var(--muted)]">Free plan · {activeCount} of {limit} active programs</p>}
        <div className="grid grid-cols-1 gap-5 desktop:grid-cols-[minmax(0,1fr)_19rem]">
          <div className="min-w-0 space-y-4">
            {!isDesktop && (
              <section aria-label="Program settings" className="rounded-xl border border-[var(--border)] p-3">
                <div className="flex items-start gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="truncate font-display text-sm font-semibold text-[var(--ink)]">{draft.title.trim() || 'Program name needed'}</div>
                    <div className="text-xs text-[var(--muted)]">{settingsSummary(draft, { patientName, editing, startDate })}</div>
                  </div>
                  <Button type="button" aria-label={settingsOpen ? 'Done with settings' : 'Edit settings'} aria-expanded={settingsOpen} className="text-sm font-medium text-[var(--teal)]" onClick={() => setSettingsOpen((o) => !o)}>{settingsOpen ? 'Done' : 'Edit'}</Button>
                </div>
                {settingsOpen && <div className="mt-3 border-t border-[var(--border)] pt-3">{panel}</div>}
              </section>
            )}

            {mode === 'edit' && bundle && (
              <div className={segTrack} role="group" aria-label="Edit or start a separate program">
                <button type="button" aria-pressed={how === 'edit'} className={segOption(how === 'edit')} onClick={() => { setHow('edit'); setDraft(initial); }}>Edit current program</button>
                <button type="button" aria-pressed={how === 'new'} className={segOption(how === 'new')} onClick={() => { setHow('new'); setDraft({ ...draftFromBundle(bundle, 'copy'), title: `${bundle.program.title} (new)`, therapistId: draft.therapistId }); setTemplateId(null); }}>Start a separate program</button>
              </div>
            )}

            <ProgramItemsEditor
              items={draft.items}
              setItems={(items) => set({ items })}
              sessionsPerDay={draft.sessionsPerDay}
              library={library}
              editingLive={editing}
              live={live}
              bundle={bundle}
              today={today}
              onAdd={(target) => setPicking({ target, tab: 'exercises' })}
              onQuickStart={(tab) => setPicking({ target: 'main', tab })}
              canRepeatEarlier={hasEarlier}
            />

            {editing && changes.length > 0 && (
              <section aria-label="What changes" className="rounded-xl bg-[var(--sky-light,var(--teal-light))] p-3 text-sm">
                <p className="mb-1 font-semibold text-[var(--ink)]">What changes with this save</p>
                <ul className="space-y-0.5 text-[var(--ink)]">{changes.map((c) => <li key={`${c.change}-${c.title}`}>{c.change === 'added' ? 'Added' : c.change === 'removed' ? 'Removed' : 'Changed'}: {c.title}{c.detail ? ` (${c.detail})` : ''}</li>)}</ul>
              </section>
            )}
          </div>

          {isDesktop && <section aria-label="Program settings" className="self-start rounded-xl border border-[var(--border)] bg-[var(--paper)] p-4">{panel}</section>}
        </div>
      </SheetDialog>

      <ExercisePicker
        open={open && picking !== null && !handOver}
        onClose={() => setPicking(null)}
        target={picking?.target}
        initialTab={picking?.tab}
        patientId={pid}
        patientName={patientName ?? undefined}
        excludeProgramId={bundle?.program.id}
        disabledIds={new Set(draft.items.map((i) => i.sourceExerciseId).filter((x): x is string => !!x))}
        onAdd={added}
      />
      <ProgramPreviewDialog open={open && previewing} onClose={() => setPreviewing(false)} clinicId={clinic.id} clinicName={clinic.name} title={draft.title.trim() || 'Home program'} items={orderBySection(draft.items)} sessionsPerDay={draft.sessionsPerDay} />
      <ConfirmDialog open={confirmDiscard} title="Discard unsaved changes?" message="What you changed in this program will not be saved." confirmLabel="Discard" destructive onConfirm={() => { setConfirmDiscard(false); onClose(); }} onCancel={() => setConfirmDiscard(false)} />
      <AddPatientSheet open={addingPatient} onClose={() => setAddingPatient(false)} initialName={query.trim()} onCreated={(p) => { setPatient(p); setQuery(''); setAddingPatient(false); }} onUseExisting={(p) => { setPatient(p); setQuery(''); setAddingPatient(false); }} />
      {handOver && (
        <HandOverPanel
          open
          onClose={() => { setHandOver(null); onClose(); }}
          patientId={handOver.patient.id}
          patientName={handOver.patient.name}
          patientPhone={handOver.patient.phone ?? null}
          programId={handOver.created.programId}
          programTitle={handOver.title}
          token={handOver.created.token}
          pin={handOver.created.pin}
          items={handOver.items}
          fromTemplate={handOver.fromTemplate}
        />
      )}
    </>
  );
}
