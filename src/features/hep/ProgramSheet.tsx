// New / Edit home program. A new program starts from a template, an earlier program, "same as last time" or the Library;
// an edit changes the live program in place (or starts a separate one). Rows are copies of exercises with their own dose,
// grouped by section in the order a patient does them. Saving needs a connection. After a NEW program is saved the
// hand-over panel shows the PIN once. Opening and cancelling never change anything.
import { useEffect, useMemo, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { useClinic } from '@/app/clinicContext';
import { useWorkspaceScope } from '@/app/useWorkspaceScope';
import { Button } from '@/components/Button';
import { ConfirmDialog, Field, SheetDialog, btnPrimary, btnSecondary, filterChip, inputCls, segOption, segTrack } from '@/components/ui';
import { EXERCISE_PHASE_LABELS, addDaysISO, estimateSessionMinutes, type ExerciseTemplate, type SessionsPerDay } from '@/domain/hep';
import { describeDose } from '@/domain/hepDose';
import { repos } from '@/services';
import { HEP_NEEDS_CONNECTION, hepService, type HepItemInput, type ProgramBundle, type ProgramCreated } from '@/services/hepService';
import type { Patient } from '@/domain/types';
import { AddPatientSheet } from '@/features/patients/AddPatientSheet';
import { ExerciseDoseEditor } from './ExerciseDoseEditor';
import { ExercisePicker } from './ExercisePicker';
import { HandOverPanel } from './HandOverPanel';
import { exerciseToItem, groupItemsByPhase, itemDose, moveWithinSection, orderBySection, withItemDose } from './hepItems';
import { itemProgress, itemProgressLine } from './itemProgress';
import {
  CHECKIN_CHOICES, LENGTH_CHOICES, TARGET_CHOICES, blankDraft, changeSessionsPerDay, changesFor, createSettings, draftFromBundle, draftFromTemplate, draftProblem, estimateLabel, isSectionOptional,
  latestEarlierProgram, sameDraft, setSectionOptional, updateSettings, type ProgramDraft,
} from './programDraft';
import { clinicToday, useOnline } from './useHepData';

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

type Source = 'last' | 'template' | 'earlier' | 'library';
const SESSION_LABEL = ['', 'once a day', 'twice a day', '3 times a day'];

export function ProgramSheet({ open, onClose, mode, patientId, bundle, startFrom, startDate, onSaved }: ProgramSheetProps) {
  const clinic = useClinic();
  const online = useOnline();
  const scope = useWorkspaceScope();
  const therapists = useLiveQuery(() => repos.therapists.list(clinic.id), [clinic.id]);
  const today = clinicToday(clinic);

  const [how, setHow] = useState<'new' | 'edit'>(mode);
  const [patient, setPatient] = useState<Patient | null>(null);
  const [draft, setDraft] = useState<ProgramDraft>(blankDraft());
  const [initial, setInitial] = useState<ProgramDraft>(blankDraft());
  const [templateId, setTemplateId] = useState<string | null>(null);
  const [source, setSource] = useState<Source>('library');
  const [templates, setTemplates] = useState<Array<ExerciseTemplate & { usedCount: number }> | null>(null);
  const [earlier, setEarlier] = useState<ProgramBundle[]>([]);
  const [query, setQuery] = useState('');
  const [matches, setMatches] = useState<Patient[]>([]);
  const [addingPatient, setAddingPatient] = useState(false);
  const [openRow, setOpenRow] = useState<number | null>(null);
  const [closedSections, setClosedSections] = useState<ReadonlySet<string>>(new Set());
  const [picking, setPicking] = useState(false);
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
    setHow(mode); setDraft(d); setInitial(d); setTemplateId(tid); setSource(startFrom?.template ? 'template' : startFrom?.program ? 'earlier' : 'library');
    setOpenRow(null); setClosedSections(new Set()); setPicking(false); setConfirmDiscard(false); setBusy(false); setError(null); setHandOver(null); setQuery(''); setMatches([]);
    setPatient(null);
    const known = patientId ?? (mode === 'edit' ? bundle?.program.patientId : undefined);
    if (known) void repos.patients.get(known).then((p) => setPatient(p ?? null)).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // For a new program: the patient's earlier programs ("Same as last time") and the templates.
  useEffect(() => {
    if (!open || mode !== 'new' || !online) return;
    const pid = patient?.id ?? patientId;
    if (pid) hepService.listPatientPrograms(pid, addDaysISO(today, -14)).then(setEarlier).catch(() => setEarlier([]));
    hepService.listTemplates(clinic.id).then(setTemplates).catch(() => setTemplates([]));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, mode, online, patient?.id, patientId]);

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

  const last = useMemo(() => latestEarlierProgram(earlier, today), [earlier, today]);
  const dirty = !sameDraft(draft, initial);
  const editing = how === 'edit' && !!bundle;
  const knownPatientId = patientId ?? bundle?.program.patientId;
  const needsPatient = !knownPatientId;
  const problem = draftProblem(draft, needsPatient, !!patient || !!knownPatientId);
  const sections = groupItemsByPhase(draft.items);
  const set = (patch: Partial<ProgramDraft>) => setDraft((d) => ({ ...d, ...patch }));
  const setItems = (items: HepItemInput[]) => set({ items });
  const orderedTemplates = useMemo(() => [...(templates ?? [])].sort((a, b) => b.usedCount - a.usedCount || a.title.localeCompare(b.title)), [templates]);
  const before = useMemo(() => (bundle && editing ? draftFromBundle(bundle, 'edit').items : []), [bundle, editing]);
  const changes = editing ? changesFor(before, draft.items) : [];

  function pickSource(next: Source) {
    setSource(next);
    if (next === 'last' && last) { setDraft(applyCopy(last)); setTemplateId(null); }
    if (next === 'library') { setDraft((d) => ({ ...blankDraft(d.therapistId), title: d.title })); setTemplateId(null); }
  }
  const applyCopy = (b: ProgramBundle): ProgramDraft => ({ ...draftFromBundle(b, 'copy'), therapistId: draft.therapistId });
  function chooseTemplate(id: string) {
    const t = orderedTemplates.find((x) => x.id === id);
    if (!t) return;
    setDraft({ ...draftFromTemplate(t, draft.therapistId), customPin: draft.customPin });
    setTemplateId(t.id);
  }
  function chooseEarlier(id: string) {
    const b = earlier.find((x) => x.program.id === id);
    if (b) { setDraft(applyCopy(b)); setTemplateId(null); }
  }

  function changeTimesADay(next: SessionsPerDay) {
    setDraft((d) => ({ ...d, sessionsPerDay: next, items: changeSessionsPerDay(d.items, d.sessionsPerDay, next) }));
  }
  const updateRow = (index: number, fn: (i: HepItemInput) => HepItemInput) => setItems(draft.items.map((it, i) => (i === index ? fn(it) : it)));

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
      const who = patient;
      const pid = who?.id ?? knownPatientId;
      if (!pid) throw new Error('Choose the patient.');
      const start = startDate ?? addDaysISO(today, draft.startOffset);
      const created = await hepService.createProgram({ clinicId: clinic.id, patientId: pid, therapistId: draft.therapistId, title: draft.title.trim(), items, customPin: draft.customPin || null, sourceTemplateId: templateId, today: start, settings: createSettings(draft) });
      onSaved?.({ mode: 'new', programId: created.programId, patientId: created.patientId, title: draft.title.trim() });
      const patientRow = who ?? (await repos.patients.get(pid));
      setHandOver({ created, items, title: draft.title.trim(), patient: patientRow ?? ({ id: pid, name: 'the patient', phone: null } as Patient), fromTemplate: templateId != null });
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save the program.');
    } finally {
      setBusy(false);
    }
  }

  const close = () => (dirty && !busy ? setConfirmDiscard(true) : onClose());
  const live = bundle?.program;
  const showEstimate = estimateLabel(draft.items, draft.sessionsPerDay);

  const footer = (
    <>
      <Button type="button" className={btnSecondary} onClick={close} disabled={busy}>Cancel</Button>
      <Button type="button" className={btnPrimary} onClick={() => void save()} disabled={busy || !online || problem !== null}>{busy ? 'Saving…' : !online ? 'Needs a connection' : 'Save program'}</Button>
    </>
  );

  return (
    <>
      <SheetDialog open={open && !handOver} wide title={editing ? `Edit home program · ${bundle?.patientName ?? ''}` : 'New home program'} onClose={close} busy={busy} error={error} footer={footer}>
        <div className="space-y-5">
          {needsPatient && (
            <section aria-label="Patient" className="space-y-1.5">
              <Field label="Patient">
                {patient ? (
                  <div className="flex items-center justify-between rounded-lg border border-[var(--border)] px-3 py-2 text-sm"><span>{patient.name}</span><Button type="button" className="text-xs text-[var(--teal)]" onClick={() => { setPatient(null); setEarlier([]); }}>Change</Button></div>
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
          )}

          {mode === 'edit' && bundle && (
            <div className={segTrack} role="group" aria-label="Edit or start a separate program">
              <button type="button" aria-pressed={how === 'edit'} className={segOption(how === 'edit')} onClick={() => { setHow('edit'); setDraft(initial); }}>Edit current program</button>
              <button type="button" aria-pressed={how === 'new'} className={segOption(how === 'new')} onClick={() => { setHow('new'); setDraft({ ...draftFromBundle(bundle, 'copy'), title: `${bundle.program.title} (new)`, therapistId: draft.therapistId }); setTemplateId(null); }}>Start a separate program</button>
            </div>
          )}

          {mode === 'new' && (
            <section aria-label="Start from" className="space-y-2">
              <div className="text-label font-medium text-[var(--muted)]">Start from</div>
              <div className="flex flex-wrap gap-1.5" role="group">
                {last && <button type="button" aria-pressed={source === 'last'} className={filterChip(source === 'last')} onClick={() => pickSource('last')}>Same as last time</button>}
                <button type="button" aria-pressed={source === 'template'} className={filterChip(source === 'template')} onClick={() => setSource('template')}>A template</button>
                {earlier.length > 0 && <button type="button" aria-pressed={source === 'earlier'} className={filterChip(source === 'earlier')} onClick={() => setSource('earlier')}>An earlier program</button>}
                <button type="button" aria-pressed={source === 'library'} className={filterChip(source === 'library')} onClick={() => pickSource('library')}>The Library</button>
              </div>
              {source === 'template' && (
                <select className={inputCls} aria-label="Template" value={templateId ?? ''} onChange={(e) => chooseTemplate(e.target.value)}>
                  <option value="" disabled>{templates === null ? 'Loading templates…' : templates.length === 0 ? 'No templates yet' : 'Choose a template'}</option>
                  {orderedTemplates.map((t) => <option key={t.id} value={t.id}>{t.title}{t.usedCount > 0 ? ` · used ${t.usedCount}×` : ''}</option>)}
                </select>
              )}
              {source === 'earlier' && (
                <select className={inputCls} aria-label="Earlier program" defaultValue="" onChange={(e) => chooseEarlier(e.target.value)}>
                  <option value="" disabled>Choose a program</option>
                  {earlier.map((b) => <option key={b.program.id} value={b.program.id}>{b.program.title} · {b.program.startDate}</option>)}
                </select>
              )}
            </section>
          )}

          <Field label="Program name" hint="The patient sees this name. A plain name works best, for example “Right knee, week 2”.">
            <input className={inputCls} value={draft.title} maxLength={80} onChange={(e) => set({ title: e.target.value })} />
          </Field>

          <section aria-label="Times a day" className="space-y-1.5">
            <div className="text-label font-medium text-[var(--muted)]">Times a day</div>
            <div className="flex flex-wrap gap-1.5" role="group" aria-label="Times a day">
              {([1, 2, 3] as SessionsPerDay[]).map((n) => <button key={n} type="button" aria-pressed={draft.sessionsPerDay === n} className={filterChip(draft.sessionsPerDay === n)} onClick={() => changeTimesADay(n)}>{n === 1 ? 'Once' : n === 2 ? 'Twice' : '3 times'}</button>)}
            </div>
            {editing && live && draft.sessionsPerDay !== live.sessionsPerDay && <p className="text-hint text-[var(--muted)]">Today stays {SESSION_LABEL[live.sessionsPerDay]}; the new number starts tomorrow.</p>}
          </section>

          <section aria-label="Exercises" className="space-y-3">
            <div className="flex flex-wrap items-center gap-3">
              <p className="text-sm text-[var(--muted)]" aria-live="polite">{draft.items.length} {draft.items.length === 1 ? 'exercise' : 'exercises'}{showEstimate && <> · {showEstimate}</>}</p>
              <div className="flex-1" />
              {sections.length > 1 && <Button type="button" className="text-xs font-medium text-[var(--teal)]" onClick={() => setClosedSections(sections.every((s) => closedSections.has(s.phase)) ? new Set() : new Set(sections.map((s) => s.phase)))}>{sections.every((s) => closedSections.has(s.phase)) ? 'Expand all' : 'Collapse all'}</Button>}
              <Button type="button" className={btnSecondary} onClick={() => setPicking(true)}>+ Add exercises</Button>
            </div>
            {draft.items.length === 0 && <p className="rounded-xl border border-dashed border-[var(--border)] p-6 text-center text-sm text-[var(--muted)]">No exercises yet. Start from a template above, or add some from the Library.</p>}
            {sections.map((s) => {
              const closed = closedSections.has(s.phase);
              const sectionItems = s.rows.map((r) => r.item);
              return (
                <section key={s.phase} aria-label={EXERCISE_PHASE_LABELS[s.phase]} className="space-y-1.5">
                  <div className="flex flex-wrap items-center gap-2">
                    <button type="button" aria-expanded={!closed} className="min-w-0 flex-1 text-left" onClick={() => setClosedSections((cur) => { const n = new Set(cur); if (n.has(s.phase)) n.delete(s.phase); else n.add(s.phase); return n; })}>
                      <h3 className="font-display text-sm font-semibold text-[var(--ink)]">{closed ? '▸' : '▾'} {EXERCISE_PHASE_LABELS[s.phase]} <span className="font-normal text-[var(--muted)]">· {s.rows.length} {s.rows.length === 1 ? 'exercise' : 'exercises'} · ~{estimateSessionMinutes(sectionItems, draft.sessionsPerDay)} min</span></h3>
                    </button>
                    <label className="flex items-center gap-1.5 text-xs text-[var(--muted)]"><input type="checkbox" checked={isSectionOptional(draft.items, s.phase)} onChange={(e) => setItems(setSectionOptional(draft.items, s.phase, e.target.checked))} /> Make the whole section optional</label>
                  </div>
                  {!closed && (
                    <ul className="space-y-1.5">
                      {s.rows.map(({ item, index }, pos) => {
                        const override = item.sessionsPerDay !== draft.sessionsPerDay;
                        const src = live?.items.find((i) => i.id === item.id);
                        return (
                          <li key={`${item.id ?? item.sourceExerciseId ?? item.title}-${index}`} className="rounded-xl border border-[var(--border)] bg-[var(--surface)]">
                            <div className="flex items-center gap-1 p-2">
                              <button type="button" aria-expanded={openRow === index} className="min-w-0 flex-1 text-left" onClick={() => setOpenRow(openRow === index ? null : index)}>
                                <span className="block truncate text-sm font-semibold text-[var(--ink)]">{item.title}{item.optional && <span className="ml-2 text-xs font-medium text-[var(--muted)]">Optional</span>}</span>
                                <span className="block truncate text-xs text-[var(--muted)]">{describeDose(itemDose(item), draft.sessionsPerDay)}{override && ` · Only this one: ${SESSION_LABEL[item.sessionsPerDay]}`}</span>
                              </button>
                              <Button type="button" aria-label={`Move ${item.title} up`} className="min-h-9 min-w-9 text-[var(--muted)] disabled:opacity-30" disabled={pos === 0} onClick={() => setItems(moveWithinSection(draft.items, index, -1))}>↑</Button>
                              <Button type="button" aria-label={`Move ${item.title} down`} className="min-h-9 min-w-9 text-[var(--muted)] disabled:opacity-30" disabled={pos === s.rows.length - 1} onClick={() => setItems(moveWithinSection(draft.items, index, 1))}>↓</Button>
                              <Button type="button" aria-label={`Remove ${item.title}`} className="min-h-9 min-w-9 text-[var(--rust)]" onClick={() => { setItems(draft.items.filter((_, i) => i !== index)); setOpenRow(null); }}>✕</Button>
                            </div>
                            {openRow === index && (
                              <div className="space-y-3 border-t border-[var(--border)] p-3">
                                {editing && live && src && <p className="text-xs text-[var(--muted)]">So far: {itemProgressLine(itemProgress(src, live, bundle.logs, bundle.sessionFeedback, today))}</p>}
                                <ExerciseDoseEditor
                                  value={{ ...itemDose(item), sessionsPerDay: override ? item.sessionsPerDay : null }}
                                  programSessionsPerDay={draft.sessionsPerDay}
                                  showOptional
                                  showProgress={editing && !!item.id}
                                  onChange={(d) => updateRow(index, (it) => withItemDose(it, { ...d, sessionsPerDay: d.sessionsPerDay ?? draft.sessionsPerDay }))}
                                />
                                <Field label="A note for this patient (optional, any language)">
                                  <textarea className={inputCls} rows={2} maxLength={300} value={item.specialInstructions ?? ''} onChange={(e) => updateRow(index, (it) => ({ ...it, specialInstructions: e.target.value }))} />
                                </Field>
                              </div>
                            )}
                          </li>
                        );
                      })}
                    </ul>
                  )}
                </section>
              );
            })}
          </section>

          {editing && changes.length > 0 && (
            <section aria-label="What changes" className="rounded-xl bg-[var(--sky-light,var(--teal-light))] p-3 text-sm">
              <p className="mb-1 font-semibold text-[var(--ink)]">What changes with this save</p>
              <ul className="space-y-0.5 text-[var(--ink)]">{changes.map((c) => <li key={`${c.change}-${c.title}`}>{c.change === 'added' ? 'Added' : c.change === 'removed' ? 'Removed' : 'Changed'}: {c.title}{c.detail ? ` (${c.detail})` : ''}</li>)}</ul>
            </section>
          )}

          <section aria-label="Settings" className="grid gap-4 tab:grid-cols-2">
            <div className="space-y-1.5">
              <div className="text-label font-medium text-[var(--muted)]">Length</div>
              <div className="flex flex-wrap gap-1.5" role="group" aria-label="Length">
                {LENGTH_CHOICES.map((c) => <button key={c.label} type="button" aria-pressed={draft.durationDays === c.days} className={filterChip(draft.durationDays === c.days)} onClick={() => set({ durationDays: c.days })}>{c.label}</button>)}
              </div>
            </div>
            {!editing && (
              <div className="space-y-1.5">
                <div className="text-label font-medium text-[var(--muted)]">Start</div>
                {startDate ? <p className="text-sm text-[var(--ink)]">On the visit date ({startDate})</p> : (
                  <div className="flex gap-1.5" role="group" aria-label="Start">
                    <button type="button" aria-pressed={draft.startOffset === 0} className={filterChip(draft.startOffset === 0)} onClick={() => set({ startOffset: 0 })}>Today</button>
                    <button type="button" aria-pressed={draft.startOffset === 1} className={filterChip(draft.startOffset === 1)} onClick={() => set({ startOffset: 1 })}>Tomorrow</button>
                  </div>
                )}
              </div>
            )}
            <div className="space-y-1.5">
              <div className="text-label font-medium text-[var(--muted)]">Check in</div>
              {editing ? (
                <div className="flex items-center gap-2">
                  <input type="date" className={`${inputCls} !w-auto`} aria-label="Check in on" value={draft.checkinOn ?? ''} onChange={(e) => set({ checkinOn: e.target.value || null })} />
                  {draft.checkinOn && <Button type="button" className="text-xs text-[var(--teal)]" onClick={() => set({ checkinOn: null })}>None</Button>}
                </div>
              ) : (
                <div className="flex flex-wrap gap-1.5" role="group" aria-label="Check in">
                  {CHECKIN_CHOICES.map((c) => <button key={c.label} type="button" aria-pressed={draft.checkinDays === c.days} className={filterChip(draft.checkinDays === c.days)} onClick={() => set({ checkinDays: c.days })}>{c.label}</button>)}
                </div>
              )}
            </div>
            <Field label="Prescribed by">
              <select className={inputCls} value={draft.therapistId ?? ''} onChange={(e) => set({ therapistId: e.target.value || null })}>
                <option value="">Not set</option>
                {(therapists ?? []).filter((t) => t.active).map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
              </select>
            </Field>
          </section>

          <details className="rounded-xl border border-[var(--border)] p-3">
            <summary className="cursor-pointer text-sm font-medium text-[var(--ink)]">Advanced</summary>
            <div className="mt-3 space-y-4">
              <div className="space-y-1.5">
                <div className="text-label font-medium text-[var(--muted)]">After each session, ask about</div>
                <div className={segTrack} role="group" aria-label="Ask about">
                  <button type="button" aria-pressed={draft.feedbackDefault === 'pain'} className={segOption(draft.feedbackDefault === 'pain')} onClick={() => set({ feedbackDefault: 'pain' })}>Pain first</button>
                  <button type="button" aria-pressed={draft.feedbackDefault === 'effort'} className={segOption(draft.feedbackDefault === 'effort')} onClick={() => set({ feedbackDefault: 'effort' })}>Effort first</button>
                </div>
              </div>
              <div className="space-y-1.5">
                <div className="text-label font-medium text-[var(--muted)]">Counts as completed at</div>
                <div className="flex gap-1.5" role="group" aria-label="Counts as completed at">
                  {TARGET_CHOICES.map((n) => <button key={n} type="button" aria-pressed={draft.targetPct === n} className={filterChip(draft.targetPct === n)} onClick={() => set({ targetPct: n })}>{n}%</button>)}
                </div>
              </div>
              <Field label="Set my own 4-digit PIN (optional)" hint="Leave empty for a random PIN. It is shown once after saving.">
                <input className={`${inputCls} !w-28`} inputMode="numeric" maxLength={4} autoComplete="off" value={draft.customPin} onChange={(e) => set({ customPin: e.target.value.replace(/\D/g, '').slice(0, 4) })} />
              </Field>
            </div>
          </details>
        </div>
      </SheetDialog>

      <ExercisePicker
        open={open && picking && !handOver}
        onClose={() => setPicking(false)}
        disabledIds={new Set(draft.items.map((i) => i.sourceExerciseId).filter((x): x is string => !!x))}
        onAdd={(list) => setItems([...draft.items, ...list.map((e) => ({ ...exerciseToItem(e), sessionsPerDay: draft.sessionsPerDay }))])}
      />
      <ConfirmDialog open={confirmDiscard} title="Discard changes?" message="What you changed in this program will not be saved." confirmLabel="Discard" destructive onConfirm={() => { setConfirmDiscard(false); onClose(); }} onCancel={() => setConfirmDiscard(false)} />
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
