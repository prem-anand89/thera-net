// Add or edit one library exercise. Four sections (Basics, How to do it, Default dose, Find it later), two columns on
// wide screens. Saving needs a connection (the server enforces the free-plan cap); pictures go straight to the private
// bucket through signed links and the form saves their keys. Archive replaces Delete once the exercise has been used.
import { useEffect, useMemo, useRef, useState } from 'react';
import { Button } from '@/components/Button';
import { Field, SheetDialog, btnPrimary, btnSecondary, filterChip, inputCls, pillSmDanger } from '@/components/ui';
import {
  EXERCISE_PHASES,
  EXERCISE_PHASE_LABELS,
  HEP_EQUIPMENT,
  HEP_REGIONS,
  canonicalEquipment,
  canonicalRegion,
  suggestedDoseType,
  type Exercise,
  type ExerciseMediaType,
  type ExercisePhase,
} from '@/domain/hep';
import { describeDose, doseToExerciseFields, exerciseToDose, isDoseValid, withKind, type DoseValue } from '@/domain/hepDose';
import { similarExercise } from '@/domain/hepLibrary';
import { db } from '@/lib/db';
import { compressImageForUpload, createThumbnailBlob } from '@/lib/imageCompression';
import { MAX_PICTURES, PictureField, type Picture } from './PictureField';
import { hepMediaService } from '@/services/hepMediaService';
import { HEP_NEEDS_CONNECTION, hepService } from '@/services/hepService';
import { ExerciseDoseEditor } from './ExerciseDoseEditor';
import { exerciseToSaveInput } from './exerciseSaveInput';
import { useOnline } from './useHepData';

const STOP_IF_SUGGESTIONS = ['Sharp pain', 'Pain that gets worse', 'Dizziness', 'Numbness or tingling', 'Chest pain or breathlessness'];

const blankDose = (): DoseValue => ({ kind: 'reps', sets: 3, reps: 10, holdSeconds: null, durationSeconds: null, restSeconds: 30, side: 'none', sessionsPerDay: 1 });

export interface ExerciseFormProps {
  open: boolean;
  clinicId: string;
  /** The exercise to edit; absent for a new one. */
  exercise?: Exercise;
  /** Every exercise of the clinic (for the "Similar:" warning and the region list). */
  allExercises: Exercise[];
  onClose: () => void;
  /** The Save button's words (the picker says "Save and add"). */
  saveLabel?: string;
  /** A name to start a new exercise with (the picker's "+ New exercise" passes what was typed). */
  initialTitle?: string;
  /** Called once it is saved, with the exercise as saved so a picker can use it straight away. */
  onSaved: (id: string, saved: Exercise) => void;
}

export function ExerciseForm({ open, clinicId, exercise, allExercises, initialTitle, saveLabel = 'Save exercise', onClose, onSaved }: ExerciseFormProps) {
  const online = useOnline();
  const isEdit = !!exercise;
  const [id, setId] = useState<string>(() => exercise?.id ?? crypto.randomUUID());
  const [title, setTitle] = useState('');
  const [region, setRegion] = useState<string>('');
  const [customRegion, setCustomRegion] = useState('');
  const [also, setAlso] = useState<string[]>([]);
  const [phase, setPhase] = useState<ExercisePhase>('other');
  const [equipment, setEquipment] = useState<string[]>([]);
  const [customEquipment, setCustomEquipment] = useState('');
  const [steps, setSteps] = useState('');
  const [stopIf, setStopIf] = useState('');
  const [dose, setDose] = useState<DoseValue>(blankDose);
  const [otherNames, setOtherNames] = useState<string[]>([]);
  const [otherNameDraft, setOtherNameDraft] = useState('');
  const [pictures, setPictures] = useState<Picture[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [usage, setUsage] = useState<{ programs: number; templates: number } | null>(null);
  const [duplicated, setDuplicated] = useState(false);
  const kindTouched = useRef(false);

  // Load the exercise (or a blank form) each time the sheet opens.
  useEffect(() => {
    if (!open) return;
    const ex = exercise;
    setId(ex?.id ?? crypto.randomUUID());
    setTitle(ex?.title ?? initialTitle ?? '');
    const r = ex ? canonicalRegion(ex.bodyRegion) : '';
    setRegion(r);
    setCustomRegion('');
    setAlso(ex?.alsoRegions ?? []);
    setPhase(ex?.phase ?? 'other');
    setEquipment(ex?.equipment ?? []);
    setCustomEquipment('');
    setSteps(ex?.instructions ?? '');
    setStopIf(ex?.stopIf ?? '');
    setDose(ex ? exerciseToDose(ex) : blankDose());
    setOtherNames(ex?.otherNames ?? []);
    setOtherNameDraft('');
    setPictures((ex?.mediaKeys ?? []).map((key, i) => ({ key, file: null, preview: null, caption: ex?.mediaCaptions[i] ?? '', isGif: ex?.mediaType === 'gif' })));
    setError(null);
    setBusy(false);
    setUsage(null);
    setDuplicated(false);
    kindTouched.current = !!ex;
    if (ex && navigator.onLine) hepService.exerciseUsage(ex.id).then(setUsage).catch(() => {});
    if (ex && ex.mediaKeys.length > 0 && navigator.onLine) {
      hepMediaService.mintViewUrls(clinicId, ex.mediaKeys).then((urls) => {
        setPictures((cur) => cur.map((p) => (p.key && !p.preview ? { ...p, preview: urls[p.key] ?? null } : p)));
      }).catch(() => {});
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, exercise?.id]);

  const regionOptions = useMemo(() => {
    const custom = allExercises.map((e) => canonicalRegion(e.bodyRegion)).filter((r) => r && !(HEP_REGIONS as readonly string[]).includes(r));
    return [...HEP_REGIONS, ...new Set(custom)] as string[];
  }, [allExercises]);

  const effectiveRegion = region === '__other' ? canonicalRegion(customRegion) : region;
  const similar = useMemo(() => similarExercise(title, allExercises, exercise?.id), [title, allExercises, exercise?.id]);

  const hasGif = pictures.some((p) => p.isGif);
  const mediaType: ExerciseMediaType = pictures.length === 0 ? 'none' : hasGif ? 'gif' : 'stills';
  const picturesOk = pictures.length === 0 || (hasGif ? pictures.length === 1 : pictures.length >= 2 && pictures.length <= MAX_PICTURES);
  const valid = title.trim().length > 0 && effectiveRegion.length > 0 && isDoseValid(dose) && picturesOk;

  function changePhase(next: ExercisePhase) {
    setPhase(next);
    if (!kindTouched.current) setDose((d) => withKind(d, suggestedDoseType(next)));
  }

  function addOtherName() {
    const n = otherNameDraft.trim();
    if (n && otherNames.length < 6 && !otherNames.some((o) => o.toLowerCase() === n.toLowerCase())) setOtherNames([...otherNames, n]);
    setOtherNameDraft('');
  }

  async function save() {
    if (!online) { setError(HEP_NEEDS_CONNECTION); return; }
    setBusy(true);
    setError(null);
    try {
      // Pictures: shrink the new ones (the editor already did for adjusted ones), get signed links (the server picks the
      // keys), send them in parallel, and keep the keys in order.
      let keys = pictures.map((p) => p.key);
      let thumbKey = exercise?.thumbKey ?? null;
      const fresh = pictures.map((p, i) => ({ p, i })).filter(({ p }) => p.file);
      const blobs = new Map<number, Blob>();
      for (const { p, i } of fresh) blobs.set(i, p.ready ? (p.file as File) : await compressImageForUpload(p.file as File));
      // The list thumbnail follows the first picture: made again when that one is new, or when a saved one was moved to the front.
      let firstBlob = blobs.get(0) ?? null;
      const front = pictures[0];
      if (!firstBlob && front?.key && front.preview && front.key !== exercise?.mediaKeys[0]) {
        try { firstBlob = await (await fetch(front.preview)).blob(); } catch { /* keep the old thumbnail */ }
      }
      const slots: Array<number | 'thumb'> = [...fresh.map(({ i }) => i), ...(firstBlob ? (['thumb'] as const) : [])];
      if (slots.length > 0) {
        setProgress({ done: 0, total: slots.length });
        const minted = await hepMediaService.mintUploadUrls(clinicId, id, slots);
        const thumbBlob = firstBlob ? await createThumbnailBlob(firstBlob) : null;
        await Promise.all(minted.map(async (m) => {
          await hepMediaService.putBlob(m, m.slot === 'thumb' ? (thumbBlob as Blob) : (blobs.get(m.slot as number) as Blob));
          setProgress((cur) => (cur ? { ...cur, done: cur.done + 1 } : cur));
        }));
        keys = [...keys];
        for (const m of minted) { if (m.slot === 'thumb') thumbKey = m.key; else keys[m.slot as number] = m.key; }
      }
      if (pictures.length === 0) thumbKey = null;
      const finalKeys = keys.filter((k): k is string => !!k);
      const fields = {
        title: title.trim(),
        otherNames,
        bodyRegion: effectiveRegion,
        alsoRegions: also.filter((a) => a !== effectiveRegion),
        equipment,
        phase,
        instructions: steps.trim(),
        mediaType,
        mediaKeys: finalKeys,
        mediaCaptions: pictures.map((p) => p.caption.trim()),
        thumbKey,
        ...doseToExerciseFields(dose),
        stopIf: stopIf.trim(),
        active: exercise?.active ?? true,
      };
      const savedId = await hepService.saveExercise({ id, clinicId, ...fields });
      // Show it in the local list at once; the next sync pull replaces this row with the server's.
      const now = new Date().toISOString();
      const saved: Exercise = { ...fields, id: savedId, clinicId, isFavorite: duplicated ? false : (exercise?.isFavorite ?? false), deleted: false, version: (exercise && !duplicated ? exercise.version : 0) + 1, createdAt: exercise && !duplicated ? exercise.createdAt : now, updatedAt: now };
      await db.exercises.put(saved).catch(() => {});
      onSaved(savedId, saved);
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save the exercise.');
    } finally {
      setBusy(false);
      setProgress(null);
    }
  }

  async function setActive(active: boolean) {
    if (!exercise) return;
    setBusy(true);
    setError(null);
    try {
      await hepService.saveExercise(exerciseToSaveInput(exercise, { active }));
      await db.exercises.update(exercise.id, { active }).catch(() => {});
      onSaved(exercise.id, { ...exercise, active });
      onClose();
    } catch (e) { setError(e instanceof Error ? e.message : 'Could not change the exercise.'); } finally { setBusy(false); }
  }

  async function remove() {
    if (!exercise) return;
    setBusy(true);
    setError(null);
    try {
      await hepService.saveExercise(exerciseToSaveInput(exercise, { deleted: true }));
      await db.exercises.update(exercise.id, { deleted: true }).catch(() => {});
      onSaved(exercise.id, { ...exercise, deleted: true });
      onClose();
    } catch (e) { setError(e instanceof Error ? e.message : 'Could not delete the exercise.'); } finally { setBusy(false); }
  }

  function duplicate() {
    setId(crypto.randomUUID());
    setTitle((t) => `${t} (progression)`);
    // The copy keeps the same pictures; it is a new exercise from here on.
    setError(null);
    setUsage(null);
    kindTouched.current = true;
    setDuplicated(true);
  }

  const steplines = steps.split('\n').map((s) => s.trim()).filter(Boolean);
  const used = (usage?.programs ?? 0) + (usage?.templates ?? 0) > 0;
  const editingExisting = isEdit && !duplicated;

  const footer = (
    <>
      <Button type="button" className={btnSecondary} onClick={onClose} disabled={busy}>Cancel</Button>
      <Button type="button" className={btnPrimary} onClick={() => void save()} disabled={busy || !valid || !online}>
        {busy ? (progress ? `Uploading ${Math.min(progress.done + 1, progress.total)} of ${progress.total}…` : 'Saving…') : !online ? 'Needs a connection' : saveLabel}
      </Button>
    </>
  );

  return (
    <SheetDialog open={open} wide title={editingExisting ? 'Edit exercise' : 'New exercise'} onClose={onClose} busy={busy} error={error} footer={footer}>
      <div className="grid gap-x-8 gap-y-6 desktop:grid-cols-2">
        <div className="space-y-6">
          <section aria-labelledby="ex-basics" className="space-y-3">
            <h3 id="ex-basics" className="font-display text-sm font-semibold text-[var(--ink)]">Basics</h3>
            <Field label="Name">
              <input className={inputCls} value={title} maxLength={80} onChange={(e) => setTitle(e.target.value)} placeholder="For example Wall slides" />
            </Field>
            {similar && <p className="rounded-md bg-[var(--amber-light)] px-3 py-2 text-xs text-[var(--amber-strong)]" role="status">Similar: {similar.title} ({canonicalRegion(similar.bodyRegion)}). You can still save this one.</p>}
            <Field label="Body region">
              <select className={inputCls} value={region} onChange={(e) => setRegion(e.target.value)}>
                <option value="" disabled>Choose a region</option>
                {regionOptions.map((r) => <option key={r} value={r}>{r}</option>)}
                <option value="__other">Another region…</option>
              </select>
            </Field>
            {region === '__other' && <input className={inputCls} aria-label="New region name" placeholder="Region name" value={customRegion} maxLength={40} onChange={(e) => setCustomRegion(e.target.value)} />}
            <div role="group" aria-labelledby="ex-also" className="space-y-1.5">
              <div id="ex-also" className="text-label font-medium text-[var(--muted)]">Also show under</div>
              <div className="flex flex-wrap gap-1.5">
                {regionOptions.filter((r) => r !== effectiveRegion).map((r) => (
                  <button key={r} type="button" aria-pressed={also.includes(r)} className={filterChip(also.includes(r))} onClick={() => setAlso(also.includes(r) ? also.filter((x) => x !== r) : [...also, r])}>
                    {also.includes(r) ? '✓ ' : ''}{r}
                  </button>
                ))}
              </div>
            </div>
            <Field label="Type">
              <select className={inputCls} value={phase} onChange={(e) => changePhase(e.target.value as ExercisePhase)}>
                {EXERCISE_PHASES.map((p) => <option key={p} value={p}>{EXERCISE_PHASE_LABELS[p]}</option>)}
              </select>
            </Field>
            <div role="group" aria-labelledby="ex-equip" className="space-y-1.5">
              <div id="ex-equip" className="text-label font-medium text-[var(--muted)]">Equipment the patient needs</div>
              <div className="flex flex-wrap gap-1.5">
                {[...HEP_EQUIPMENT.filter((e) => e !== 'None'), ...equipment.filter((e) => !(HEP_EQUIPMENT as readonly string[]).includes(e))].map((e) => (
                  <button key={e} type="button" aria-pressed={equipment.includes(e)} className={filterChip(equipment.includes(e))} onClick={() => setEquipment(equipment.includes(e) ? equipment.filter((x) => x !== e) : [...equipment, e])}>
                    {equipment.includes(e) ? '✓ ' : ''}{e}
                  </button>
                ))}
              </div>
              <div className="flex gap-2">
                <input className={inputCls} aria-label="Other equipment" placeholder="Other equipment" value={customEquipment} maxLength={40} onChange={(e) => setCustomEquipment(e.target.value)} />
                <Button type="button" className={btnSecondary} disabled={!customEquipment.trim()} onClick={() => { const c = canonicalEquipment(customEquipment); if (c && !equipment.includes(c)) setEquipment([...equipment, c]); setCustomEquipment(''); }}>Add</Button>
              </div>
            </div>
          </section>

          <section aria-labelledby="ex-how" className="space-y-3">
            <h3 id="ex-how" className="font-display text-sm font-semibold text-[var(--ink)]">How to do it</h3>
            <PictureField pictures={pictures} setPictures={setPictures} onProblem={setError} disabled={busy} />
            <Field label="Steps" hint="One step per line. The patient sees them as a numbered list.">
              <textarea className={inputCls} rows={5} value={steps} onChange={(e) => setSteps(e.target.value)} placeholder={'Stand with your back to the wall\nSlide your arms up slowly'} />
            </Field>
            {steplines.length > 0 && (
              <div className="rounded-xl bg-[var(--paper)] p-3">
                <div className="mb-1 text-xs font-semibold text-[var(--muted)]">Patient sees</div>
                <ol className="list-decimal space-y-0.5 pl-5 text-sm text-[var(--ink)]">{steplines.map((s, i) => <li key={i}>{s}</li>)}</ol>
              </div>
            )}
            <Field label="Stop if" hint="Shown to the patient as a reason to stop.">
              <input className={inputCls} value={stopIf} maxLength={140} onChange={(e) => setStopIf(e.target.value)} placeholder="For example sharp pain" />
            </Field>
            <div className="flex flex-wrap gap-1.5">
              {STOP_IF_SUGGESTIONS.map((s) => (
                <button key={s} type="button" className={filterChip(false)} onClick={() => setStopIf((cur) => (cur.toLowerCase().includes(s.toLowerCase()) ? cur : cur.trim() ? `${cur.trim()}, ${s.toLowerCase()}` : s))}>{s}</button>
              ))}
            </div>
          </section>
        </div>

        <div className="space-y-6">
          <section aria-labelledby="ex-dose" className="space-y-3">
            <h3 id="ex-dose" className="font-display text-sm font-semibold text-[var(--ink)]">Default dose</h3>
            <ExerciseDoseEditor value={dose} onChange={(v) => { if (v.kind !== dose.kind) kindTouched.current = true; setDose(v); }} />
            <p className="rounded-xl bg-[var(--paper)] p-3 text-sm text-[var(--ink)]" aria-live="polite"><span className="block text-xs font-semibold text-[var(--muted)]">The patient reads</span>{describeDose(dose)}</p>
          </section>

          <section aria-labelledby="ex-find" className="space-y-3">
            <h3 id="ex-find" className="font-display text-sm font-semibold text-[var(--ink)]">Find it later</h3>
            <div className="space-y-1.5">
              <div className="text-label font-medium text-[var(--muted)]">Other names</div>
              <div className="flex flex-wrap gap-1.5">
                {otherNames.map((n) => <button key={n} type="button" className={filterChip(true)} aria-label={`Remove ${n}`} onClick={() => setOtherNames(otherNames.filter((x) => x !== n))}>{n} ✕</button>)}
              </div>
              <div className="flex gap-2">
                <input className={inputCls} aria-label="Add another name" placeholder="For example SLR" value={otherNameDraft} maxLength={40} disabled={otherNames.length >= 6}
                  onChange={(e) => setOtherNameDraft(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addOtherName(); } }} />
                <Button type="button" className={btnSecondary} onClick={addOtherName} disabled={!otherNameDraft.trim() || otherNames.length >= 6}>Add</Button>
              </div>
              <p className="text-hint text-[var(--muted)]">Names your team uses. Search finds them; patients never see them.</p>
            </div>
          </section>

          {editingExisting && exercise && (
            <section aria-labelledby="ex-manage" className="space-y-2 border-t border-[var(--border)] pt-4">
              <h3 id="ex-manage" className="sr-only">Manage</h3>
              <div className="flex flex-wrap gap-2">
                <Button type="button" className={btnSecondary} onClick={duplicate} disabled={busy}>Duplicate…</Button>
                {exercise.active
                  ? used || usage === null
                    ? <Button type="button" className={pillSmDanger} onClick={() => void setActive(false)} disabled={busy || !online}>Archive</Button>
                    : <Button type="button" className={pillSmDanger} onClick={() => void remove()} disabled={busy || !online}>Delete</Button>
                  : <Button type="button" className={btnSecondary} onClick={() => void setActive(true)} disabled={busy || !online}>Restore</Button>}
              </div>
              {exercise.active && used && (
                <p className="text-hint text-[var(--muted)]">Used in {usage?.programs ?? 0} program item{(usage?.programs ?? 0) === 1 ? '' : 's'} and {usage?.templates ?? 0} template item{(usage?.templates ?? 0) === 1 ? '' : 's'}, so it is archived instead of deleted. Programs keep their own copy.</p>
              )}
            </section>
          )}
        </div>
      </div>
    </SheetDialog>
  );
}
