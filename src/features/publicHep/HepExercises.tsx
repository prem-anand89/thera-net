// The signed-in page: the clinic header (logo, name, reminder, call), the Home and Exercises tabs with the bottom tab bar,
// the checklist, the one-exercise screen, the end-of-session Pain | Effort check, the calendar reminder and "Forget this
// phone". Taps are saved at once and shown at once; if one cannot be saved it is taken back and the patient is told (an
// offline queue is Slice 2).
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { publicLogoUrl } from '@/lib/supabase';
import { addDaysISO, type SessionsPerDay, type SkipReason } from '@/domain/hep';
import { publicHepService, type PublicCredential, type PublicHepItem, type PublicHepPayload, type PublicResult } from '@/services/publicHepService';
import { HepChecklist } from './HepChecklist';
import { HepExerciseScreen } from './HepExerciseScreen';
import { HepHome, type HepHomeData } from './HepHome';
import { HepReminder } from './HepReminder';
import { HepSessionCheck, type SessionCheckValues } from './HepSessionCheck';
import { HepTabBar, type HepTab } from './HepTabBar';
import { createHepSound, nextSoundMode, readSoundMode, saveSoundMode, type SoundMode } from './hepSound';
import { checkHandled, markCheckHandled, markOpened, readOpened } from './hepStorage';
import { clinicDay, currentSession, dayNumber, itemsInSession, nextToDo, sessionComplete, sessionLabel, sessionsToday, statusOf, todayCounts, type PublicLog } from './hepSession';

export type HepData = Omit<PublicHepPayload, 'ok'>;

export interface HepExercisesProps {
  token: string;
  data: HepData;
  credential: () => PublicCredential;
  onPinNeeded: () => void;
  onForget: () => void;
  onSwitchProgram: (programId: string) => void;
  onImageError: () => void;
  tab: HepTab;
  onTab: (tab: HepTab) => void;
  /** The Home RPC's answer; null while it loads or when it failed (Home then shows only the Today card). */
  home: HepHomeData | null;
}

interface Toast { text: string; undo?: () => void }

export function HepExercises({ token, data, credential, onPinNeeded, onForget, onSwitchProgram, onImageError, tab, onTab, home }: HepExercisesProps) {
  const program = data.programs.find((p) => p.id === data.shownProgramId) ?? null;
  const items = data.items;
  const [logs, setLogs] = useState<PublicLog[]>(data.logs);
  const logsRef = useRef(logs);
  useEffect(() => { logsRef.current = logs; }, [logs]);

  const [today, setToday] = useState(() => clinicDay(data.clinic.timezone));
  useEffect(() => {
    const id = setInterval(() => setToday(clinicDay(data.clinic.timezone)), 60_000);
    return () => clearInterval(id);
  }, [data.clinic.timezone]);

  const sessionCount = sessionsToday(items, today);
  const [session, setSession] = useState(() => currentSession(items, data.logs, clinicDay(data.clinic.timezone), sessionsToday(items, clinicDay(data.clinic.timezone))));
  const activeSession = Math.min(session, sessionCount);
  const [screen, setScreen] = useState<{ id: string; first: boolean } | null>(null);
  const [toast, setToast] = useState<Toast | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [rating, setRating] = useState<number | null>(null);
  const [handled, setHandled] = useState<Set<number>>(() => new Set()); // sessions whose check was saved or dismissed on this page
  const [feedback, setFeedback] = useState(() => new Map(data.sessionFeedback.map((f) => [f.sessionIndex as number, f])));
  const [reminderOpen, setReminderOpen] = useState(false);
  const [setsDone, setSetsDone] = useState<{ date: string; byItem: Record<string, number> }>(() => ({ date: today, byItem: {} }));
  const setKey = (id: string, sessionIndex: number) => `${id}:${sessionIndex}`;
  const setsDoneFor = (id: string, sessionIndex: number) => (setsDone.date === today ? (setsDone.byItem[setKey(id, sessionIndex)] ?? 0) : 0);
  const updateSetsDone = (id: string, sessionIndex: number, count: number) =>
    setSetsDone((cur) => ({ date: today, byItem: { ...(cur.date === today ? cur.byItem : {}), [setKey(id, sessionIndex)]: count } }));

  const [soundMode, setSoundMode] = useState<SoundMode>(() => readSoundMode());
  const modeRef = useRef(soundMode);
  useEffect(() => { modeRef.current = soundMode; }, [soundMode]);
  const sound = useMemo(() => createHepSound(() => modeRef.current), []);

  useEffect(() => {
    if (!toast) return;
    const id = setTimeout(() => setToast(null), 6000);
    return () => clearTimeout(id);
  }, [toast]);

  // ---- saving a tap ---------------------------------------------------------------------------------------------
  const run = useCallback(
    async (next: (l: PublicLog[]) => PublicLog[], requests: Array<() => Promise<PublicResult<object>>>) => {
      const before = logsRef.current;
      setLogs(next(before));
      setNotice(null);
      try {
        const results = await Promise.all(requests.map((r) => r()));
        const failed = results.find((r) => !r.ok);
        if (failed && !failed.ok) {
          setLogs(before);
          if (failed.reason === 'pin_needed') onPinNeeded();
          else if (failed.reason === 'busy') setNotice('Please wait a minute and try again.');
          else setNotice("That didn't save. Please try again.");
        }
      } catch {
        setLogs(before);
        setNotice('No connection, so that was not saved. Try again when you are back online.');
      }
    },
    [onPinNeeded],
  );

  const logOf = (item: PublicHepItem, s: number, skipped: boolean, reason: SkipReason | null): PublicLog => ({
    programItemId: item.id, logDate: today, sessionIndex: s as SessionsPerDay, skipped, skipReason: reason, completedAt: new Date().toISOString(),
  });
  const without = (l: PublicLog[], item: PublicHepItem, s: number) => l.filter((x) => !(x.programItemId === item.id && x.logDate === today && x.sessionIndex === s));
  const submit = (item: PublicHepItem, s: number, skipped: boolean, reason: SkipReason | null) => () =>
    publicHepService.submitExerciseLog({ ...credential(), itemId: item.id, sessionIndex: s as SessionsPerDay, logDate: today, skipped, skipReason: reason });
  const undoCall = (item: PublicHepItem, s: number) => () => publicHepService.undoExerciseLog({ ...credential(), itemId: item.id, sessionIndex: s as SessionsPerDay, logDate: today });

  const markDone = (item: PublicHepItem, s: number) => run((l) => [...without(l, item, s), logOf(item, s, false, null)], [submit(item, s, false, null)]);
  const skip = (item: PublicHepItem, s: number, reason: SkipReason) => run((l) => [...without(l, item, s), logOf(item, s, true, reason)], [submit(item, s, true, reason)]);
  const undo = (item: PublicHepItem, s: number) => run((l) => without(l, item, s), [undoCall(item, s)]);

  function toggle(item: PublicHepItem) {
    const status = statusOf(item, logsRef.current, today, activeSession);
    if (status === 'open') {
      void markDone(item, activeSession);
      setToast({ text: `Marked done: ${item.title}`, undo: () => void undo(item, activeSession) });
    } else void undo(item, activeSession);
  }

  function sectionDone(list: PublicHepItem[]) {
    void run(
      (l) => list.reduce((acc, item) => [...without(acc, item, activeSession), logOf(item, activeSession, false, null)], l),
      list.map((item) => submit(item, activeSession, false, null)),
    );
  }
  function sectionSkip(list: PublicHepItem[], reason: SkipReason) {
    void run(
      (l) => list.reduce((acc, item) => [...without(acc, item, activeSession), logOf(item, activeSession, true, reason)], l),
      list.map((item) => submit(item, activeSession, true, reason)),
    );
  }

  // ---- the one-exercise screen ----------------------------------------------------------------------------------
  const mine = itemsInSession(items, logs, today, activeSession);
  const openExercise = (item: PublicHepItem) => {
    setScreen({ id: item.id, first: !readOpened(token).has(item.id) });
    markOpened(token, item.id);
  };
  const shown = screen ? mine.find((i) => i.id === screen.id) ?? null : null;
  const shownIndex = shown ? mine.findIndex((i) => i.id === shown.id) : -1;
  const goTo = (item: PublicHepItem | undefined | null) => (item ? openExercise(item) : setScreen(null));

  // ---- the end-of-session check ---------------------------------------------------------------------------------
  const firstSessionDone = sessionComplete(items, logs, today, 1);
  const autoCheck = !shown && firstSessionDone && !feedback.has(1) && !handled.has(1) && !checkHandled(token, today, 1);
  const checkSession = rating ?? (autoCheck ? 1 : null);

  async function saveCheck(s: number, v: SessionCheckValues) {
    const res = await publicHepService.submitSessionFeedback({ ...credential(), programId: program?.id ?? '', sessionIndex: s as SessionsPerDay, logDate: today, ...v });
    if (!res.ok) {
      if (res.reason === 'pin_needed') onPinNeeded();
      throw new Error(res.reason);
    }
    setFeedback((m) => new Map(m).set(s, { sessionIndex: s as SessionsPerDay, pain: v.pain, effort: v.effort, painItemIds: v.painItemIds, hardItemIds: v.hardItemIds }));
    markCheckHandled(token, today, s);
    setRating(null);
    setHandled((h) => new Set(h).add(s));
    setToast({ text: 'Thank you. Your therapist can see this.' });
  }
  const notNow = (s: number) => {
    markCheckHandled(token, today, s);
    setRating(null);
    setHandled((h) => new Set(h).add(s));
  };

  if (!program) {
    return (
      <main className="mx-auto max-w-md space-y-3 px-5 py-12 text-center">
        <h1 className="text-2xl font-bold">{data.clinic.name}</h1>
        <p className="text-lg text-slate-700">You have no exercises to do right now. Your clinic will add a program when you are ready.</p>
        <button type="button" onClick={onForget} className="min-h-11 text-base font-semibold text-slate-600 underline">Forget this phone</button>
      </main>
    );
  }

  const counts = todayCounts(items, logs, today);
  const day = dayNumber(program.startDate, today);
  const endDate = program.durationDays ? addDaysISO(program.startDate, program.durationDays - 1) : null;
  const clinicPhone = data.clinic.phone;
  const listItems = mine.filter((i) => !i.optional);

  const logoUrl = publicLogoUrl(data.clinic.logoPath);
  const forgetLine = (
    <p className="pt-4 text-center text-base text-slate-600">
      Share this link only with the patient or the person helping them.
      <br />
      Not using this phone?{' '}
      <button type="button" onClick={onForget} className="min-h-11 font-semibold text-slate-800 underline">Forget this phone</button>
    </p>
  );

  return (
    <div
      className={`min-h-dvh bg-slate-50 text-slate-900 ${
        tab === 'exercises'
          ? 'pb-[calc(9.5rem+env(safe-area-inset-bottom))]'
          : 'pb-[calc(5.5rem+env(safe-area-inset-bottom))]'
      }`}
    >
      <header className="sticky top-0 z-10 border-b border-slate-200 bg-white px-4 pb-2 pt-[max(0.5rem,env(safe-area-inset-top))]">
        <div className="mx-auto flex max-w-xl items-center gap-2">
          {logoUrl ? (
            <img src={logoUrl} alt="" className="h-10 w-10 shrink-0 rounded-xl object-contain" />
          ) : (
            <span aria-hidden className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-teal-700 text-base font-bold text-white">{data.clinic.name.trim().charAt(0).toUpperCase()}</span>
          )}
          <p className="min-w-0 flex-1 truncate text-base font-bold">{data.clinic.name}</p>
          <button type="button" onClick={() => setReminderOpen((v) => !v)} aria-label="Add a daily reminder" aria-expanded={reminderOpen} className="min-h-11 min-w-11 text-2xl">🔔</button>
          {clinicPhone && <a href={`tel:${clinicPhone.replace(/\s+/g, '')}`} aria-label="Call the clinic" className="flex min-h-11 min-w-11 items-center justify-center text-2xl">📞</a>}
        </div>
      </header>

      <main className="mx-auto max-w-xl space-y-4 px-4 py-4">
        {notice && <p role="alert" className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-base text-rose-900">{notice}</p>}

        {reminderOpen && (
          <HepReminder clinicName={data.clinic.name} url={window.location.origin + window.location.pathname} sessionCount={sessionCount} startDate={program.startDate > today ? program.startDate : today} endDate={endDate} onClose={() => setReminderOpen(false)} />
        )}

        {tab === 'home' ? (
          <HepHome
            data={data}
            program={program}
            logs={logs}
            today={today}
            home={home}
            onStart={() => {
              const firstOpen = nextToDo(mine, logs, today, activeSession);
              onTab('exercises');
              if (firstOpen) openExercise(firstOpen);
            }}
            onSeeList={() => onTab('exercises')}
            onOpenProgram={onSwitchProgram}
          />
        ) : (
          <>
            <div>
              {data.programs.length > 1 ? (
                <select aria-label="Program" value={program.id} onChange={(e) => onSwitchProgram(e.target.value)} className="min-h-11 w-full rounded-xl border border-slate-300 bg-white px-2 text-lg font-bold">
                  {data.programs.map((p) => <option key={p.id} value={p.id}>{p.title}</option>)}
                </select>
              ) : (
                <h1 className="text-xl font-bold">{program.title}</h1>
              )}
              <p className="text-base text-slate-600">
                {program.durationDays ? `Day ${Math.min(day, program.durationDays)} of ${program.durationDays}` : `Day ${day}`}
                {counts.total > 0 && <> · Today: {counts.done} of {counts.total} done</>}
              </p>
            </div>

            {items.length === 0 ? (
              <p className="rounded-2xl bg-white p-6 text-center text-lg text-slate-700">Your therapist has not added any exercises to this program yet.</p>
            ) : (
              <HepChecklist items={items} logs={logs} today={today} session={activeSession} sessionCount={sessionCount} onSession={setSession} onOpen={openExercise} onToggle={toggle} onSectionDone={sectionDone} onSectionSkip={sectionSkip} startBottom="bottom-[calc(4.5rem+env(safe-area-inset-bottom))]" />
            )}

            {checkSession !== null && (
              <HepSessionCheck
                key={checkSession}
                items={itemsInSession(items, logs, today, checkSession)}
                defaultSide={program.feedbackDefault}
                initial={feedback.get(checkSession)}
                clinicPhone={clinicPhone}
                sessionName={sessionLabel(sessionCount, checkSession)}
                onSave={(v) => saveCheck(checkSession, v)}
                onNotNow={() => notNow(checkSession)}
              />
            )}

            {checkSession === null && listItems.length > 0 && (
              <button type="button" onClick={() => setRating(activeSession)} className="min-h-11 w-full text-center text-base font-semibold text-teal-800 underline">Rate this session</button>
            )}
          </>
        )}

        {forgetLine}
      </main>

      <HepTabBar tab={tab} onTab={onTab} />

      {toast && (
        <div
          role="status"
          className={`fixed inset-x-4 z-50 mx-auto flex max-w-xl items-center gap-3 rounded-2xl bg-slate-900 px-4 py-3 text-base text-white shadow-lg ${
            tab === 'exercises'
              ? 'bottom-[calc(8.75rem+env(safe-area-inset-bottom))]'
              : 'bottom-[calc(4.75rem+env(safe-area-inset-bottom))]'
          }`}
        >
          <span className="flex-1">{toast.text}</span>
          {toast.undo && <button type="button" onClick={() => { toast.undo?.(); setToast(null); }} className="min-h-11 px-2 font-bold text-teal-300">Undo</button>}
        </div>
      )}

      {shown && (
        <HepExerciseScreen
          key={shown.id}
          item={shown}
          position={shownIndex + 1}
          total={mine.length}
          session={activeSession}
          sessionCount={sessionCount}
          status={statusOf(shown, logs, today, activeSession)}
          skipReason={logs.find((l) => l.programItemId === shown.id && l.logDate === today && l.sessionIndex === activeSession)?.skipReason ?? null}
          firstVisit={screen?.first ?? false}
          soundMode={soundMode}
          sound={sound}
          onSoundMode={() => setSoundMode((m) => { const n = nextSoundMode(m); saveSoundMode(n); return n; })}
          onBack={() => setScreen(null)}
          onPrev={shownIndex > 0 ? () => goTo(mine[shownIndex - 1]) : null}
          onNext={shownIndex < mine.length - 1 ? () => goTo(mine[shownIndex + 1]) : null}
          onDone={() => {
            void markDone(shown, activeSession);
            goTo(nextToDo(mine, logsRef.current, today, activeSession, shown.id));
          }}
          onSkip={(reason) => {
            void skip(shown, activeSession, reason);
            goTo(nextToDo(mine, logsRef.current, today, activeSession, shown.id));
          }}
          onUndo={() => void undo(shown, activeSession)}
          onImageError={onImageError}
          setsDone={setsDoneFor(shown.id, activeSession)}
          onSetsDoneChange={(n) => updateSetsDone(shown.id, activeSession, n)}
        />
      )}
    </div>
  );
}
