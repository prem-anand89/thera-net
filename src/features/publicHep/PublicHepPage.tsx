// /p/$token — the patient's exercise page. No login: the link plus a 4-digit PIN, or a remembered phone.
// States: loading -> sign in -> program (Home and Exercises tabs). Before the PIN it shows only the clinic's name and logo.
// Verify once: the PIN (or device token) is checked by get_public_hep first; only after that succeeded is the Home RPC
// asked, once per sign-in or reload, with the credential the page already holds (the device token when remembered).
// Home failing never blocks the Exercises tab or the sign-in state.
import { useCallback, useEffect, useRef, useState } from 'react';
import { useParams } from '@tanstack/react-router';
import { publicLogoUrl } from '@/lib/supabase';
import { publicHepService, type PublicCredential, type PublicFailure } from '@/services/publicHepService';
import { HepExercises, type HepData } from './HepExercises';
import type { HepHomeData } from './HepHome';
import { HepSignIn, type HepBrand } from './HepSignIn';
import type { HepTab } from './HepTabBar';
import { forgetDevice, readDevice, saveDevice } from './hepStorage';

/** Picture links are signed for about an hour; ask for fresh ones well before that. */
const MEDIA_REFRESH_MS = 25 * 60 * 1000;
const MIN_REFRESH_GAP_MS = 60 * 1000;

type Stage =
  | { name: 'loading' }
  | { name: 'signin'; brand: HepBrand | null }
  | { name: 'program'; data: HepData }
  | { name: 'unavailable' }
  | { name: 'busy' }
  | { name: 'offline' };

function Message({ title, text, onRetry }: { title: string; text: string; onRetry?: () => void }) {
  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col items-center justify-center gap-3 px-6 text-center text-slate-900">
      <h1 className="text-2xl font-bold">{title}</h1>
      <p className="text-lg text-slate-700">{text}</p>
      {onRetry && <button type="button" onClick={onRetry} className="min-h-12 rounded-full bg-teal-700 px-8 text-lg font-semibold text-white">Try again</button>}
    </main>
  );
}

export function PublicHepPage() {
  const { token } = useParams({ strict: false }) as { token: string };
  const [stage, setStage] = useState<Stage>({ name: 'loading' });
  // The PIN lives here, in memory only. A remembered phone sends its device token instead.
  const cred = useRef<{ pin: string | null; device: string | null }>({ pin: null, device: null });
  const lastRefresh = useRef(0);
  const [tab, setTab] = useState<HepTab>('home');
  const [home, setHome] = useState<HepHomeData | null>(null);
  const homeGen = useRef(0);
  const stageRef = useRef<Stage>(stage);
  useEffect(() => { stageRef.current = stage; }, [stage]);

  // This page must never be indexed.
  useEffect(() => {
    const meta = document.createElement('meta');
    meta.name = 'robots';
    meta.content = 'noindex, nofollow';
    document.head.appendChild(meta);
    return () => meta.remove();
  }, []);

  const credential = useCallback((): PublicCredential => ({ token, pin: cred.current.device ? null : cred.current.pin, device: cred.current.device }), [token]);

  /** The Home tab's data, asked once after the program loaded. A failure (or a missing RPC) leaves Home with Today only. */
  const loadHome = useCallback(async () => {
    const gen = ++homeGen.current;
    try {
      const res = await publicHepService.getPublicHome(credential());
      if (gen === homeGen.current && res.ok) setHome(res);
    } catch {
      /* Home shows only the Today card */
    }
  }, [credential]);

  const showSignIn = useCallback(async () => {
    cred.current = { pin: null, device: null };
    homeGen.current += 1;
    setHome(null);
    setTab('home');
    try {
      const res = await publicHepService.clinicBrand(token);
      if (res.ok) setStage({ name: 'signin', brand: { name: res.name, logoUrl: publicLogoUrl(res.logoPath) } });
      else setStage(res.reason === 'busy' ? { name: 'busy' } : { name: 'unavailable' });
    } catch {
      setStage({ name: 'offline' });
    }
  }, [token]);

  const boot = useCallback(async () => {
    setStage({ name: 'loading' });
    const device = readDevice(token);
    if (device) {
      try {
        const res = await publicHepService.getPublicHep({ token, device });
        if (res.ok) {
          cred.current = { pin: null, device };
          setStage({ name: 'program', data: res });
          lastRefresh.current = Date.now();
          void loadHome();
          return;
        }
        if (res.reason === 'busy') return setStage({ name: 'busy' });
        forgetDevice(token); // expired, revoked or unknown: back to the PIN screen
      } catch {
        return setStage({ name: 'offline' });
      }
    }
    await showSignIn();
  }, [token, showSignIn, loadHome]);

  useEffect(() => { void boot(); }, [boot]);

  const signIn = useCallback(
    async (pin: string, remember: boolean): Promise<PublicFailure | null> => {
      const res = await publicHepService.getPublicHep({ token, pin });
      if (!res.ok) return res;
      let device: string | null = null;
      if (remember) {
        try {
          const r = await publicHepService.rememberDevice(token, pin);
          if (r.ok) {
            device = r.device;
            saveDevice(token, device);
          }
        } catch {
          /* not remembered; the PIN still works for this visit */
        }
      }
      cred.current = { pin, device };
      lastRefresh.current = Date.now();
      setStage({ name: 'program', data: res });
      void loadHome();
      return null;
    },
    [token, loadHome],
  );

  /** Fresh picture links, keeping everything the patient has done on the page. */
  const refreshMedia = useCallback(
    async (force = false) => {
      const cur = stageRef.current;
      if (cur.name !== 'program') return;
      if (!force && Date.now() - lastRefresh.current < MIN_REFRESH_GAP_MS) return;
      lastRefresh.current = Date.now();
      try {
        const res = await publicHepService.getPublicHep({ ...credential(), programId: cur.data.shownProgramId, reason: 'refresh' });
        if (!res.ok) {
          if (res.reason === 'pin_needed') await showSignIn();
          return;
        }
        setStage((now) => {
          if (now.name !== 'program' || now.data.shownProgramId !== res.shownProgramId) return now;
          const urls = new Map(res.items.map((i) => [i.id, i.mediaUrls]));
          return { name: 'program', data: { ...now.data, items: now.data.items.map((i) => ({ ...i, mediaUrls: urls.get(i.id) ?? i.mediaUrls })) } };
        });
      } catch {
        /* offline: the old links may still work, and the next try will fetch new ones */
      }
    },
    [credential, showSignIn],
  );

  useEffect(() => {
    if (stage.name !== 'program') return;
    const id = setInterval(() => void refreshMedia(true), MEDIA_REFRESH_MS);
    return () => clearInterval(id);
  }, [stage.name, refreshMedia]);

  const switchProgram = useCallback(
    async (programId: string) => {
      try {
        const res = await publicHepService.getPublicHep({ ...credential(), programId, reason: 'refresh' });
        if (res.ok) {
          setStage({ name: 'program', data: res });
        } else if (res.reason === 'pin_needed') await showSignIn();
      } catch {
        /* stay on the current program */
      }
    },
    [credential, showSignIn],
  );

  const forget = useCallback(() => {
    forgetDevice(token);
    void showSignIn();
  }, [token, showSignIn]);

  if (stage.name === 'loading') return <Message title="Your Home Exercise Program" text="Opening…" />;
  if (stage.name === 'unavailable') return <Message title="Your Home Exercise Program" text="This link isn't working. Ask your clinic for a new one." />;
  if (stage.name === 'busy') return <Message title="Your Home Exercise Program" text="Please wait a minute and try again." onRetry={() => void boot()} />;
  if (stage.name === 'offline') return <Message title="No connection" text="Check your internet and try again." onRetry={() => void boot()} />;
  if (stage.name === 'signin') return <HepSignIn brand={stage.brand} onSubmit={signIn} />;
  return (
    <HepExercises
      key={stage.data.shownProgramId ?? 'none'}
      token={token}
      data={stage.data}
      credential={credential}
      onPinNeeded={() => { forgetDevice(token); void showSignIn(); }}
      onForget={forget}
      onSwitchProgram={(id) => void switchProgram(id)}
      onImageError={() => void refreshMedia()}
      tab={tab}
      onTab={setTab}
      home={home}
    />
  );
}
