// "Preview as patient": the real patient screens inside a phone frame, fed from what the therapist is editing.
// Nothing is saved and no patient data is touched; done / skipped marks live in local state only.
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { SessionsPerDay, SkipReason } from '@/domain/hep';
import { clinicTimezone } from '@/domain/clinicRegion';
import { useClinic } from '@/app/clinicContext';
import { hepMediaService } from '@/services/hepMediaService';
import type { HepItemInput } from '@/services/hepService';
import type { PublicHepItem } from '@/services/publicHepService';
import { Button } from '@/components/Button';
import { SheetDialog, btnSecondary } from '@/components/ui';
import { HepChecklist } from '../publicHep/HepChecklist';
import { HepExerciseScreen } from '../publicHep/HepExerciseScreen';
import type { HepData } from '../publicHep/HepExercises';
import { HepHome } from '../publicHep/HepHome';
import { HepTabBar, type HepTab } from '../publicHep/HepTabBar';
import { createHepSound, nextSoundMode, type SoundMode } from '../publicHep/hepSound';
import { itemsInSession, nextToDo, statusOf, type PublicLog } from '../publicHep/hepSession';
import type { Picture } from './PictureField';
import { orderBySection } from './hepItems';
import { toPreviewItems } from './patientPreview';
import { clinicToday, useExercises, useOnline } from './useHepData';

export function PhoneFrame({ children, label }: { children: ReactNode; label: string }) {
  return (
    <div
      aria-label={label}
      className="mx-auto flex aspect-[360/680] max-h-[75vh] w-full max-w-[360px] flex-col overflow-hidden rounded-[2rem] border-[6px] border-slate-800 bg-slate-50 shadow-lg"
    >
      <p className="shrink-0 bg-amber-100 px-3 py-1.5 text-center text-xs font-semibold text-amber-900">Preview · what the patient sees · nothing is saved</p>
      <div className="relative min-h-0 flex-1 overflow-hidden text-slate-900 [transform:translateZ(0)]">{children}</div>
    </div>
  );
}

const PREVIEW_TOAST = 'Preview: marked done, nothing saved';

function PreviewToast({ text }: { text: string | null }) {
  return text ? <p role="status" className="absolute inset-x-3 top-12 z-50 rounded-2xl bg-slate-900 px-4 py-2 text-center text-sm text-white shadow-lg">{text}</p> : null;
}

function usePreviewSound() {
  const [mode, setMode] = useState<SoundMode>('off');
  const modeRef = useRef(mode);
  modeRef.current = mode;
  const sound = useMemo(() => createHepSound(() => modeRef.current), []);
  return { mode, sound, cycle: () => setMode(nextSoundMode) };
}

/** Signed URLs for the saved pictures. Offline (or on a failure) there are none and the tiles show text. */
function useMintedUrls(clinicId: string, keys: string[]): Record<string, string> {
  const online = useOnline();
  const [urls, setUrls] = useState<Record<string, string>>({});
  const joined = keys.join('|');
  useEffect(() => {
    if (!online || keys.length === 0) return;
    let live = true;
    hepMediaService.mintViewUrls(clinicId, keys).then((u) => { if (live) setUrls(u); }).catch(() => {});
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `joined` stands for `keys`
  }, [online, clinicId, joined]);
  return online ? urls : {};
}

export interface ProgramPreviewDialogProps {
  open: boolean;
  onClose: () => void;
  clinicId: string;
  clinicName: string;
  title: string;
  items: HepItemInput[];
  sessionsPerDay: SessionsPerDay;
}

/** The body mounts each time the dialog opens, so every opening starts from a clean local state. */
export function ProgramPreviewDialog(p: ProgramPreviewDialogProps) {
  return (
    <SheetDialog open={p.open} title="Preview as patient" onClose={p.onClose} footer={<Button type="button" className={btnSecondary} onClick={p.onClose}>Close</Button>}>
      <ProgramPreviewBody {...p} />
    </SheetDialog>
  );
}

function ProgramPreviewBody(p: ProgramPreviewDialogProps) {
  const clinic = useClinic();
  const today = useMemo(() => clinicToday(clinic), [clinic]);
  const cached = useExercises(p.clinicId);
  const allKeys = useMemo(() => [...new Set(p.items.flatMap((i) => i.mediaKeys))], [p.items]);
  const mediaUrls = useMintedUrls(p.clinicId, p.open ? allKeys : []);
  // Each row carries its source exercise's "Hide pictures in lists" (the same flag the patient's page receives).
  const items = useMemo(() => {
    const ordered = orderBySection(p.items);
    return toPreviewItems(p.items, { today, sessionsPerDay: p.sessionsPerDay, mediaUrls }).map((it, i) => {
      const src = ordered[i].sourceExerciseId ? cached?.find((e) => e.id === ordered[i].sourceExerciseId) : undefined;
      return { ...it, hidePicturesInLists: src?.hidePicturesInLists ?? false };
    });
  }, [p.items, today, p.sessionsPerDay, mediaUrls, cached]);
  // Home is built from this program alone: no Home RPC, no patient data.
  const homeData = useMemo<HepData>(() => ({
    clinicId: p.clinicId,
    today,
    clinic: { name: p.clinicName, logoPath: null, phone: null, timezone: clinicTimezone(clinic) },
    programs: [{ id: 'preview', title: p.title || 'Your Home Exercise Program', startDate: today, durationDays: null, feedbackDefault: 'pain', prescribedBy: null }],
    shownProgramId: 'preview',
    items,
    logs: [],
    sessionFeedback: [],
  }), [p.clinicId, p.clinicName, p.title, today, clinic, items]);
  const [tab, setTab] = useState<HepTab>('exercises');
  const [logs, setLogs] = useState<PublicLog[]>([]);
  const [session, setSession] = useState(1);
  const [openId, setOpenId] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const { mode, sound, cycle } = usePreviewSound();
  const count = p.sessionsPerDay;

  const mark = (it: PublicHepItem, s: number, skipped: boolean, reason: SkipReason | null) =>
    setLogs((l) => [...l.filter((x) => !(x.programItemId === it.id && x.sessionIndex === s)), { programItemId: it.id, logDate: today, sessionIndex: s as SessionsPerDay, skipped, skipReason: reason, completedAt: new Date().toISOString() }]);
  const unmark = (it: PublicHepItem, s: number) => setLogs((l) => l.filter((x) => !(x.programItemId === it.id && x.sessionIndex === s)));

  const mine = itemsInSession(items, logs, today, session);
  const shown = mine.find((i) => i.id === openId) ?? null;
  const shownIndex = shown ? mine.indexOf(shown) : -1;

  return (
    <>
      <PhoneFrame label="Patient preview">
        <div className="absolute inset-x-0 bottom-14 top-0 overflow-y-auto px-3 py-3">
          <p className="text-sm font-medium text-slate-600">{p.clinicName}</p>
          {tab === 'home' ? (
            <div className="mt-2">
              <HepHome data={homeData} program={homeData.programs[0]} logs={logs} today={today} home={null} onStart={() => setTab('exercises')} onOpenProgram={() => {}} />
            </div>
          ) : (
            <>
              <h2 className="mb-3 text-xl font-bold">{p.title || 'Your Home Exercise Program'}</h2>
              <HepChecklist
                items={items}
                logs={logs}
                today={today}
                session={session}
                sessionCount={count}
                onSession={setSession}
                onOpen={(it) => setOpenId(it.id)}
                onToggle={(it) => (statusOf(it, logs, today, session) === 'open' ? mark(it, session, false, null) : unmark(it, session))}
                onSectionDone={(its) => its.forEach((it) => mark(it, session, false, null))}
                onSectionSkip={(its, reason) => its.forEach((it) => mark(it, session, true, reason))}
              />
            </>
          )}
        </div>
        <HepTabBar framed tab={tab} onTab={setTab} />
        <PreviewToast text={toast} />
        {shown && (
          <HepExerciseScreen
            key={shown.id}
            framed
            item={shown}
            position={shownIndex + 1}
            total={mine.length}
            session={session}
            sessionCount={count}
            status={statusOf(shown, logs, today, session)}
            firstVisit
            soundMode={mode}
            sound={sound}
            onSoundMode={cycle}
            onBack={() => { setToast(null); setOpenId(null); }}
            onPrev={shownIndex > 0 ? () => setOpenId(mine[shownIndex - 1].id) : null}
            onNext={shownIndex < mine.length - 1 ? () => setOpenId(mine[shownIndex + 1].id) : null}
            onDone={() => { mark(shown, session, false, null); setToast(PREVIEW_TOAST); setOpenId(nextToDo(mine, logs, today, session, shown.id)?.id ?? null); }}
            onSkip={(reason) => mark(shown, session, true, reason)}
            onUndo={() => unmark(shown, session)}
            onImageError={() => {}}
          />
        )}
      </PhoneFrame>
    </>
  );
}

export function ExercisePreviewPhone({ clinicId, item, pictures }: { clinicId: string; item: HepItemInput; pictures: Picture[] }) {
  const savedKeys = useMemo(() => pictures.flatMap((pic) => (pic.key ? [pic.key] : [])), [pictures]);
  const minted = useMintedUrls(clinicId, savedKeys);
  const clinic = useClinic();
  const today = useMemo(() => clinicToday(clinic), [clinic]);
  const [toast, setToast] = useState<string | null>(null);
  const { mode, sound, cycle } = usePreviewSound();
  const shown = useMemo(() => {
    const keyed = pictures.map((pic, i) => ({ id: pic.key ?? `new-${i}`, url: pic.key ? minted[pic.key] : pic.preview, caption: pic.caption })).filter((m) => !!m.url);
    const urls: Record<string, string> = Object.fromEntries(keyed.map((m) => [m.id, m.url as string]));
    const asInput: HepItemInput = {
      ...item,
      mediaType: keyed.length === 0 ? 'none' : pictures[0]?.isGif ? 'gif' : 'stills',
      mediaKeys: keyed.map((m) => m.id),
      mediaCaptions: keyed.map((m) => m.caption),
    };
    return toPreviewItems([asInput], { today, sessionsPerDay: item.sessionsPerDay, mediaUrls: urls })[0];
  }, [item, pictures, minted, today]);

  return (
    <PhoneFrame label="Patient preview">
      <PreviewToast text={toast} />
      <HepExerciseScreen
        framed
        item={shown}
        position={1}
        total={1}
        session={1}
        sessionCount={item.sessionsPerDay}
        status="open"
        firstVisit
        soundMode={mode}
        sound={sound}
        onSoundMode={cycle}
        onBack={() => {}}
        onPrev={null}
        onNext={null}
        onDone={() => setToast(PREVIEW_TOAST)}
        onSkip={() => {}}
        onUndo={() => setToast(null)}
        onImageError={() => {}}
      />
    </PhoneFrame>
  );
}
