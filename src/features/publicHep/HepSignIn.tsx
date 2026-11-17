// The PIN screen. It shows the clinic's name and logo (so the page is trusted) and nothing about the patient or the
// exercises until the PIN is right. The 4th digit sends it. "Remember this phone" is ticked by default.
import { useEffect, useRef, useState } from 'react';
import type { PublicFailure } from '@/services/publicHepService';

export interface HepBrand {
  name: string;
  logoUrl: string | null;
}

export interface HepSignInProps {
  brand: HepBrand | null;
  /** Resolves to null when the PIN worked, or to the reason it did not. Rejects when the connection failed. */
  onSubmit: (pin: string, remember: boolean) => Promise<PublicFailure | null>;
  /** A message to show before anything is typed (for example after a remembered phone stopped working). */
  notice?: string | null;
}

export function failureMessage(f: PublicFailure): string {
  if (f.reason === 'wrong_pin') {
    const n = f.attemptsLeft ?? 0;
    return n > 0 ? `That PIN isn't right. ${n} ${n === 1 ? 'try' : 'tries'} left.` : "That PIN isn't right.";
  }
  if (f.reason === 'locked') return 'Too many tries. Please try again in 15 minutes.';
  if (f.reason === 'busy') return 'Please wait a minute and try again.';
  if (f.reason === 'pin_needed') return 'Please enter your PIN again.';
  return "This link isn't working. Ask your clinic for a new one.";
}

export function HepSignIn({ brand, onSubmit, notice }: HepSignInProps) {
  const [pin, setPin] = useState('');
  const [remember, setRemember] = useState(true);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(notice ?? null);
  const [locked, setLocked] = useState(false);
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => { input.current?.focus(); }, []);

  async function submit(value: string) {
    setBusy(true);
    setMessage(null);
    try {
      const failure = await onSubmit(value, remember);
      if (failure) {
        setMessage(failureMessage(failure));
        setLocked(failure.reason === 'locked');
        setPin('');
        setBusy(false);
        input.current?.focus();
      }
    } catch {
      setMessage('No connection. Check your internet and try again.');
      setPin('');
      setBusy(false);
    }
  }

  function change(raw: string) {
    const digits = raw.replace(/\D/g, '').slice(0, 4);
    setPin(digits);
    if (digits.length === 4) void submit(digits);
  }

  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col gap-6 px-5 pt-[max(2.5rem,env(safe-area-inset-top))] pb-[max(2.5rem,env(safe-area-inset-bottom))] text-slate-900 [&>*:first-child]:mt-auto [&>*:last-child]:mb-auto">
      <header className="flex flex-col items-center gap-3 text-center">
        {brand &&
          (brand.logoUrl ? (
            <img src={brand.logoUrl} alt="" className="h-16 w-16 rounded-2xl border border-slate-200 object-cover" />
          ) : (
            <div aria-hidden className="flex h-16 w-16 items-center justify-center rounded-2xl border border-teal-200 bg-teal-50 text-xl font-bold text-teal-800">
              {brand.name.trim().slice(0, 2).toUpperCase()}
            </div>
          ))}
        {brand && <p className="text-lg font-semibold text-slate-700">{brand.name}</p>}
        <h1 className="text-2xl font-bold">Your Home Exercise Program</h1>
        <p className="text-base text-slate-600">Sign in to see the exercises your therapist prepared for you</p>
      </header>

      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          if (pin.length === 4 && !busy) void submit(pin);
        }}
      >
        <label className="flex min-h-11 items-center gap-3 text-base">
          <input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} className="h-6 w-6 accent-teal-700" />
          <span>Remember this phone for 30 days</span>
        </label>
        <p className="-mt-2 text-sm text-slate-500">Untick this on a shared or borrowed phone.</p>
        {/iPhone|iPad|iPod/.test(navigator.userAgent) && (
          <p className="-mt-2 text-sm text-slate-500">On iPhone, open this link in Safari so it remembers you. Links opened inside WhatsApp may forget.</p>
        )}

        <div>
          <label htmlFor="hep-pin" className="mb-1 block text-base font-semibold">Your 4-digit PIN</label>
          <input
            id="hep-pin"
            ref={input}
            value={pin}
            onChange={(e) => change(e.target.value)}
            inputMode="numeric"
            pattern="[0-9]*"
            maxLength={4}
            autoComplete="off"
            disabled={busy || locked}
            aria-describedby={message ? 'hep-pin-message' : undefined}
            className="min-h-14 w-full rounded-2xl border border-slate-300 bg-white px-4 text-center text-3xl font-bold tracking-[0.6em] outline-none focus:border-teal-700 focus:ring-2 focus:ring-teal-200 disabled:bg-slate-100"
          />
          {message && (
            <p id="hep-pin-message" role="alert" className="mt-2 text-base font-medium text-rose-700">
              {message}
            </p>
          )}
        </div>

        <button type="submit" disabled={pin.length !== 4 || busy || locked} className="min-h-12 w-full rounded-full bg-teal-700 px-6 text-lg font-semibold text-white disabled:opacity-50">
          {busy ? 'Checking…' : 'Open my exercises'}
        </button>
      </form>

      <p className="text-center text-base text-slate-600">Lost your PIN? Ask your clinic for a new one.</p>
    </main>
  );
}
