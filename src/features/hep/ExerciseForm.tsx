// Add or edit one library exercise, in four sections that fold into a one-line summary (Exercise details, Media and
// instructions, Default dosage, Classification), with the patient's view of it beside the form on desktop (behind a
// Preview button below that). Saving needs a connection (the server enforces the free-plan cap); pictures go straight to
// the private bucket through signed links and the form saves their keys. Archive replaces Delete once the exercise has
// been used. A changed form asks before it is closed.
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Button } from '@/components/Button';
import { useIsDesktop } from '@/components/useMediaQuery';
import { useClinic } from '@/app/clinicContext';
import { ConfirmDialog, SheetDialog, btnPrimary, btnSecondary, pillSmDanger } from '@/components/ui';
import {
  HEP_REGIONS,
  canonicalRegion,
  positionsOf,
  suggestedDoseType,
  type Exercise,
  type ExerciseMediaType,
  type ExercisePhase,
} from '@/domain/hep';
import { formatDateDM } from '@/domain/fiscalYear';
import { describeDose, doseToExerciseFields, exerciseToDose, isDoseValid, withKind, type DoseValue } from '@/domain/hepDose';
import { similarExercise } from '@/domain/hepLibrary';
import { db } from '@/lib/db';
import { compressImageForUpload, createThumbnailBlob } from '@/lib/imageCompression';
import { MAX_PICTURES, type Picture } from './PictureField';
import { hepMediaService } from '@/services/hepMediaService';
import { HEP_NEEDS_CONNECTION, hepService, type HepItemInput } from '@/services/hepService';
import { ExerciseDoseEditor } from './ExerciseDoseEditor';
import {
  ClassificationFields,
  DetailsFields,
  FormSection,
  MediaFields,
  OTHER_REGION,
  SECTION_ORDER,
  SECTION_TITLES,
  classificationSummary,
  detailsSummary,
  mediaSummary,
  stepLines,
  type SectionKey,
} from './ExerciseFormSections';
import { ExercisePreviewPhone } from './PatientPreview';
import { exerciseToSaveInput } from './exerciseSaveInput';
import { clinicToday, useOnline } from './useHepData';

const blankDose = (): DoseValue => ({ kind: 'reps', sets: 3, reps: 10, holdSeconds: null, durationSeconds: null, restSeconds: 30, side: 'none', sessionsPerDay: 1 });

/** Everything the therapist can change, as the form opened it: compared with the current values for "unsaved changes". */
function startingValues(ex: Exercise | undefined, initialTitle: string | undefined) {
  return {
    title: ex?.title ?? initialTitle ?? '',
    region: ex ? canonicalRegion(ex.bodyRegion) : '',
    customRegion: '',
    also: ex?.alsoRegions ?? [],
    phase: ex?.phase ?? ('other' as ExercisePhase),
    equipment: ex?.equipment ?? [],
    customEquipment: '',
    steps: ex?.instructions ?? '',
    stopIf: ex?.stopIf ?? '',
    dose: ex ? exerciseToDose(ex) : blankDose(),
    otherNames: ex?.otherNames ?? [],
    otherNameDraft: '',
    positions: ex ? positionsOf(ex) : [],
    hidePictures: ex?.hidePicturesInLists ?? false,
    pictures: (ex?.mediaKeys ?? []).map((key, i): Picture => ({ key, file: null, preview: null, caption: ex?.mediaCaptions[i] ?? '', isGif: ex?.mediaType === 'gif' })),
  };
}
type FormValues = ReturnType<typeof startingValues>;
/** Signed preview links arrive later and are not a change, so pictures compare by key, file and caption. */
/** Which pictures are in the form: saved ones by key, new or adjusted ones by file. Order and captions do not count. */
const pictureSet = (ps: Picture[]) => ps.map((p) => (p.file ? `new:${p.file.name}:${p.file.size}:${p.ready ? 1 : 0}` : `key:${p.key}`)).sort().join('|');
const snapshot = (v: FormValues) =>
  JSON.stringify({ ...v, pictures: v.pictures.map((p) => [p.key, p.file ? `${p.file.name}:${p.file.size}:${p.ready ? 1 : 0}` : null, p.caption, p.isGif]) });

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
  const clinic = useClinic();
  const isDesktop = useIsDesktop();
  const isEdit = !!exercise;
  const [id, setId] = useState<string>(() => exercise?.id ?? crypto.randomUUID());
  const [title, setTitle] = useState('');
  const [region, setRegion] = useState<string>('');
  const [customRegion, setCustomRegion] = useState('');
  const [also, setAlso] = useState<string[]>([]);
  const [phase, setPhase] = useState<ExercisePhase>('other');
  const [typeChosen, setTypeChosen] = useState(false);
  const [equipment, setEquipment] = useState<string[]>([]);
  const [customEquipment, setCustomEquipment] = useState('');
  const [steps, setSteps] = useState('');
  const [stopIf, setStopIf] = useState('');
  const [dose, setDose] = useState<DoseValue>(blankDose);
  const [otherNames, setOtherNames] = useState<string[]>([]);
  const [otherNameDraft, setOtherNameDraft] = useState('');
  const [positions, setPositions] = useState<string[]>([]);
  const [pictures, setPicturesState] = useState<Picture[]>([]);
  const [hidePictures, setHidePictures] = useState(false);
  // Consent ticked in this form: it covers the pictures present when it was ticked, so it clears when they change.
  const [consentTicked, setConsentTicked] = useState(false);
  const [consentBlocked, setConsentBlocked] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [usage, setUsage] = useState<{ programs: number; templates: number } | null>(null);
  const [duplicated, setDuplicated] = useState(false);
  const [openSections, setOpenSections] = useState<SectionKey[]>([]);
  const [baseline, setBaseline] = useState('');
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  const [previewOpen, setPreviewOpen] = useState(false);
  const kindTouched = useRef(false);

  const setPictures = (next: Picture[]) => {
    if (pictureSet(next) !== pictureSet(pictures)) { setConsentTicked(false); setConsentBlocked(false); }
    setPicturesState(next);
  };

  // Load the exercise (or a blank form) each time the sheet opens.
  useEffect(() => {
    if (!open) return;
    const ex = exercise;
    const v = startingValues(ex, initialTitle);
    setId(ex?.id ?? crypto.randomUUID());
    setTitle(v.title);
    setRegion(v.region);
    setCustomRegion(v.customRegion);
    setAlso(v.also);
    setPhase(v.phase);
    setTypeChosen(!!ex);
    setEquipment(v.equipment);
    setCustomEquipment(v.customEquipment);
    setSteps(v.steps);
    setStopIf(v.stopIf);
    setDose(v.dose);
    setOtherNames(v.otherNames);
    setOtherNameDraft(v.otherNameDraft);
    setPositions(v.positions);
    setPicturesState(v.pictures);
    setHidePictures(v.hidePictures);
    setConsentTicked(false);
    setConsentBlocked(false);
    setBaseline(snapshot(v));
    setError(null);
    setBusy(false);
    setUsage(null);
    setDuplicated(false);
    // A new exercise starts on Exercise details; an existing one opens with every section folded.
    setOpenSections(ex ? [] : ['details']);
    setConfirmDiscard(false);
    setPreviewOpen(false);
    kindTouched.current = !!ex;
    if (ex && navigator.onLine) hepService.exerciseUsage(ex.id).then(setUsage).catch(() => {});
    if (ex && ex.mediaKeys.length > 0 && navigator.onLine) {
      hepMediaService.mintViewUrls(clinicId, ex.mediaKeys).then((urls) => {
        setPicturesState((cur) => cur.map((p) => (p.key && !p.preview ? { ...p, preview: urls[p.key] ?? null } : p)));
      }).catch(() => {});
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, exercise?.id]);

  const regionOptions = useMemo(() => {
    const own = exercise ? [canonicalRegion(exercise.bodyRegion)] : [];
    const custom = [...allExercises.map((e) => canonicalRegion(e.bodyRegion)), ...own].filter((r) => r && !(HEP_REGIONS as readonly string[]).includes(r));
    return [...HEP_REGIONS, ...new Set(custom)] as string[];
  }, [allExercises, exercise]);

  const effectiveRegion = region === OTHER_REGION ? canonicalRegion(customRegion) : region;
  const similar = useMemo(() => similarExercise(title, allExercises, exercise?.id), [title, allExercises, exercise?.id]);

  const hasGif = pictures.some((p) => p.isGif);
  const mediaType: ExerciseMediaType = pictures.length === 0 ? 'none' : hasGif ? 'gif' : 'stills';
  const picturesOk = pictures.length === 0 || (hasGif ? pictures.length === 1 : pictures.length >= 1 && pictures.length <= MAX_PICTURES);
  // Position is not needed to save (older exercises have none); only Classification's ✓ waits for it.
  const valid = title.trim().length > 0 && effectiveRegion.length > 0 && isDoseValid(dose) && picturesOk;
  const dirty = snapshot({ title, region, customRegion, also, phase, equipment, customEquipment, steps, stopIf, dose, otherNames, otherNameDraft, positions, hidePictures, pictures }) !== baseline;

  // Consent is asked for when a save brings pictures in: a new exercise (a progression included), or a different set of
  // pictures from the saved one. An untouched legacy exercise saves without it (the server rule is the same).
  const editingSaved = isEdit && !duplicated;
  const picturesIntroduced = pictures.length > 0 && (!editingSaved || pictureSet(pictures) !== pictureSet(startingValues(exercise, undefined).pictures));
  const recordedConsent = editingSaved && !picturesIntroduced && pictures.length > 0 && exercise?.pictureConsentAt ? exercise.pictureConsentAt : null;
  const consent = {
    recordedOn: recordedConsent ? formatDateDM(clinicToday(clinic, new Date(recordedConsent))) : null,
    ticked: consentTicked,
    onTick: (v: boolean) => { setConsentTicked(v); if (v) setConsentBlocked(false); },
    blocked: consentBlocked && picturesIntroduced && !consentTicked,
    legacy: editingSaved && !picturesIntroduced && !recordedConsent,
  };

  const done: Record<SectionKey, boolean> = {
    details: title.trim().length > 0 && effectiveRegion.length > 0 && typeChosen,
    media: stepLines(steps).length > 0,
    dose: isDoseValid(dose),
    class: positions.length > 0,
  };
  const summaries: Record<SectionKey, string> = {
    details: detailsSummary(title, effectiveRegion, phase, typeChosen),
    media: mediaSummary(pictures, steps, stopIf),
    dose: describeDose(dose),
    class: classificationSummary(positions, equipment, also.filter((a) => a !== effectiveRegion), otherNames),
  };
  const nextAfter = (k: SectionKey) => SECTION_ORDER.slice(SECTION_ORDER.indexOf(k) + 1).find((s) => !done[s]) ?? null;

  const previewItem = useMemo((): HepItemInput => ({
    sourceExerciseId: id, title: title.trim() || 'Exercise name', bodyRegion: effectiveRegion, phase, instructions: steps.trim(),
    mediaType, mediaKeys: [], mediaCaptions: [], equipment,
    doseType: dose.kind, sets: dose.sets, reps: dose.reps, holdSeconds: dose.holdSeconds, durationSeconds: dose.durationSeconds,
    restSeconds: dose.restSeconds, sessionsPerDay: dose.sessionsPerDay ?? 1, side: dose.side, optional: false, stopIf: stopIf.trim(),
  }), [id, title, effectiveRegion, phase, steps, mediaType, equipment, dose, stopIf]);

  function chooseType(next: ExercisePhase) {
    setPhase(next);
    setTypeChosen(true);
    if (!kindTouched.current) setDose((d) => withKind(d, suggestedDoseType(next)));
  }

  function addOtherName() {
    const n = otherNameDraft.trim();
    if (n && otherNames.length < 6 && !otherNames.some((o) => o.toLowerCase() === n.toLowerCase())) setOtherNames([...otherNames, n]);
    setOtherNameDraft('');
  }

  function requestClose() {
    if (busy) return;
    if (dirty) setConfirmDiscard(true);
    else onClose();
  }

  async function save() {
    if (!online) { setError(HEP_NEEDS_CONNECTION); return; }
    if (picturesIntroduced && !consentTicked) {
      setConsentBlocked(true);
      setOpenSections(['media']);
      return;
    }
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
        positions,
        instructions: steps.trim(),
        mediaType,
        mediaKeys: finalKeys,
        mediaCaptions: pictures.map((p) => p.caption.trim()),
        thumbKey,
        hidePicturesInLists: hidePictures,
        ...doseToExerciseFields(dose),
        stopIf: stopIf.trim(),
        active: exercise?.active ?? true,
      };
      // Consent goes only when newly ticked; the server records who and when (an unchanged exercise keeps its record).
      const newConsent = pictures.length > 0 && consentTicked;
      const savedId = await hepService.saveExercise({ id, clinicId, ...fields, ...(newConsent ? { pictureConsent: true } : {}) });
      // Show it in the local list at once; the next sync pull replaces this row with the server's.
      const now = new Date().toISOString();
      const keptConsent = editingSaved && !picturesIntroduced ? { pictureConsentAt: exercise?.pictureConsentAt ?? null, pictureConsentBy: exercise?.pictureConsentBy ?? null } : { pictureConsentAt: null, pictureConsentBy: null };
      const saved: Exercise = { ...fields, ...(newConsent ? { pictureConsentAt: now, pictureConsentBy: null } : keptConsent), id: savedId, clinicId, isFavorite: duplicated ? false : (exercise?.isFavorite ?? false), deleted: false, version: (exercise && !duplicated ? exercise.version : 0) + 1, createdAt: exercise && !duplicated ? exercise.createdAt : now, updatedAt: now };
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
    // The copy keeps the same pictures; it is a new exercise from here on. Its name and dosage are what usually change.
    setError(null);
    setUsage(null);
    kindTouched.current = true;
    setDuplicated(true);
    setConsentTicked(false);
    setConsentBlocked(false);
    setOpenSections(['details', 'dose']);
  }

  const used = (usage?.programs ?? 0) + (usage?.templates ?? 0) > 0;
  const editingExisting = isEdit && !duplicated;

  const footer = (
    <>
      <Button type="button" className={btnSecondary} onClick={requestClose} disabled={busy}>Cancel</Button>
      {editingExisting && <Button type="button" className={btnSecondary} onClick={duplicate} disabled={busy}>Create progression</Button>}
      <Button type="button" className={btnPrimary} onClick={() => void save()} disabled={busy || !valid || !online}>
        {busy ? (progress ? `Uploading ${Math.min(progress.done + 1, progress.total)} of ${progress.total}…` : 'Saving…') : !online ? 'Needs a connection' : saveLabel}
      </Button>
    </>
  );

  const body: Record<SectionKey, ReactNode> = {
    details: (
      <DetailsFields
        title={title} setTitle={setTitle} regionOptions={regionOptions} region={region} setRegion={setRegion}
        customRegion={customRegion} setCustomRegion={setCustomRegion} phase={phase} typeChosen={typeChosen} onType={chooseType}
        similarNote={similar && <p className="rounded-md bg-[var(--amber-light)] px-3 py-2 text-xs text-[var(--amber-strong)]" role="status">Similar: {similar.title} ({canonicalRegion(similar.bodyRegion)}). You can still save this one.</p>}
      />
    ),
    media: <MediaFields pictures={pictures} setPictures={setPictures} onProblem={setError} busy={busy} steps={steps} setSteps={setSteps} stopIf={stopIf} setStopIf={setStopIf} consent={consent} hidePictures={hidePictures} setHidePictures={setHidePictures} />,
    dose: (
      <>
        <ExerciseDoseEditor value={dose} onChange={(v) => { if (v.kind !== dose.kind) kindTouched.current = true; setDose(v); }} />
        <p className="rounded-xl bg-[var(--paper)] p-3 text-sm text-[var(--ink)]" aria-live="polite"><span className="block text-xs font-semibold text-[var(--muted)]">The patient reads</span>{describeDose(dose)}</p>
      </>
    ),
    class: (
      <ClassificationFields
        positions={positions} setPositions={setPositions} equipment={equipment} setEquipment={setEquipment}
        customEquipment={customEquipment} setCustomEquipment={setCustomEquipment}
        alsoOptions={regionOptions.filter((r) => r !== effectiveRegion)} also={also} setAlso={setAlso}
        otherNames={otherNames} setOtherNames={setOtherNames} otherNameDraft={otherNameDraft} setOtherNameDraft={setOtherNameDraft} onAddOtherName={addOtherName}
      />
    ),
  };

  const phone = <ExercisePreviewPhone clinicId={clinicId} item={previewItem} pictures={pictures} />;

  return (
    <SheetDialog
      open={open} wide="xl" title={editingExisting ? 'Edit exercise' : 'New exercise'} onClose={requestClose} busy={busy} error={error} footer={footer}
      headerAction={!isDesktop && <Button type="button" className={btnSecondary} onClick={() => setPreviewOpen(true)}>Preview</Button>}
    >
      <div className="grid gap-6 desktop:grid-cols-[minmax(0,1fr)_340px]">
        <div className="min-w-0 space-y-2.5">
          {SECTION_ORDER.map((k, i) => {
            const next = nextAfter(k);
            return (
              <FormSection
                key={k} index={i} title={SECTION_TITLES[k]} open={openSections.includes(k)} done={done[k]} summary={summaries[k]}
                // Opening one section folds the others; tapping an open one folds it.
                onToggle={() => setOpenSections((cur) => (cur.includes(k) ? cur.filter((x) => x !== k) : [k]))}
                nextTitle={next && SECTION_TITLES[next]} onNext={() => setOpenSections(next ? [next] : [])}
              >
                {body[k]}
              </FormSection>
            );
          })}

          {editingExisting && exercise && (
            <section aria-labelledby="ex-manage" className="space-y-2 pt-3">
              <h3 id="ex-manage" className="sr-only">Manage</h3>
              <div className="flex flex-wrap gap-2">
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

        {isDesktop && (
          <aside aria-label="Patient view" className="min-w-0">
            <div className="sticky top-0 space-y-2">
              <div className="text-label font-medium text-[var(--muted)]">Patient view</div>
              {phone}
            </div>
          </aside>
        )}
      </div>

      <SheetDialog open={previewOpen && !isDesktop} title="Patient view" onClose={() => setPreviewOpen(false)}
        footer={<Button type="button" className={btnSecondary} onClick={() => setPreviewOpen(false)}>Close</Button>}>
        {phone}
      </SheetDialog>
      <ConfirmDialog
        open={confirmDiscard} title="Discard unsaved changes?" message="Your changes to this exercise will be lost."
        confirmLabel="Discard" cancelLabel="Keep editing" destructive
        onConfirm={() => { setConfirmDiscard(false); onClose(); }} onCancel={() => setConfirmDiscard(false)}
      />
    </SheetDialog>
  );
}
