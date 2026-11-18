// After a program is saved (and after Reset PIN): hand it over while the patient is still in the room. The PIN is shown
// once (and never put in a message), the link goes out on WhatsApp, the PIN can be shown full screen or printed, and the
// panel watches for the patient's phone opening the page. The PIN is held in memory only: never stored, never logged.
import { useEffect, useRef, useState } from 'react';
import { useClinic } from '@/app/clinicContext';
import { Button } from '@/components/Button';
import { ConfirmDialog, SheetDialog, btnPrimary, btnSecondary, inputCls } from '@/components/ui';
import { clinicTimezone } from '@/domain/clinicRegion';
import { hepService, type HepItemInput } from '@/services/hepService';
import { buildHepPortalUrl, buildHepWhatsAppShareUrl } from './hepSharing';
import { PrintSheet } from './PrintSheet';
import { useOnline } from './useHepData';

export const POLL_EVERY_MS = 5000;
export const POLL_FOR_MS = 10 * 60 * 1000;

export interface HandOverPanelProps {
  open: boolean;
  onClose: () => void;
  patientId: string;
  patientName: string;
  patientPhone: string | null;
  programId: string;
  programTitle: string;
  token: string;
  /** The PIN, only when it was just created or reset. null = the patient already had one. */
  pin: string | null;
  items: HepItemInput[];
  /** True when the program was started from a template: no "Save as template" offer. */
  fromTemplate: boolean;
}

export function HandOverPanel(p: HandOverPanelProps) {
  const clinic = useClinic();
  const online = useOnline();
  const [pin, setPin] = useState<string | null>(p.pin);
  const [showPin, setShowPin] = useState(false);
  const [printing, setPrinting] = useState(false);
  const [openedAt, setOpenedAt] = useState<string | null>(null);
  const [tried, setTried] = useState(false);
  const [copied, setCopied] = useState<'link' | 'pin' | null>(null);
  const [resetting, setResetting] = useState(false);
  const [confirmReset, setConfirmReset] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [templateName, setTemplateName] = useState<string | null>(null);
  const [templateSaved, setTemplateSaved] = useState(false);
  const started = useRef(0);

  useEffect(() => { if (p.open) { setPin(p.pin); setShowPin(false); setPrinting(false); setOpenedAt(null); setTried(false); setCopied(null); setError(null); setTemplateName(null); setTemplateSaved(false); } }, [p.open, p.pin, p.programId]);

  // Is the patient's phone opening the page? Every 5 seconds, for up to 10 minutes, until it has.
  useEffect(() => {
    if (!p.open || !online || openedAt) return;
    started.current = Date.now();
    let live = true;
    const check = async () => {
      try {
        const s = await hepService.linkStatus(p.patientId);
        if (live && s.firstOpenedAt) setOpenedAt(s.firstOpenedAt);
      } catch { /* try again next time */ }
    };
    void check();
    const timer = setInterval(() => { if (Date.now() - started.current >= POLL_FOR_MS) clearInterval(timer); else void check(); }, POLL_EVERY_MS);
    return () => { live = false; clearInterval(timer); };
  }, [p.open, p.patientId, online, openedAt]);

  const link = buildHepPortalUrl(p.token);
  const whatsapp = buildHepWhatsAppShareUrl({ token: p.token, clinicName: clinic.name, phone: p.patientPhone });
  const time = openedAt ? new Date(openedAt).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: clinicTimezone(clinic) }) : null;

  async function copy(what: 'link' | 'pin', text: string) {
    try { await navigator.clipboard.writeText(text); setCopied(what); } catch { setError('Could not copy. Select it and copy by hand.'); }
  }
  async function resetPin() {
    setConfirmReset(false);
    setResetting(true);
    setError(null);
    try { setPin(await hepService.resetPin(p.patientId)); } catch (e) { setError(e instanceof Error ? e.message : 'Could not reset the PIN.'); } finally { setResetting(false); }
  }
  async function saveTemplate() {
    if (templateName === null) return;
    try { setError(null); await hepService.saveProgramAsTemplate(p.programId, templateName.trim() || p.programTitle); setTemplateSaved(true); setTemplateName(null); } catch (e) { setError(e instanceof Error ? e.message : 'Could not save the template.'); }
  }

  const requirePin = clinic.hepRequirePin ?? true;
  const effectivePin = requirePin ? pin : null;

  return (
    <>
      <SheetDialog open={p.open} title="Share with patient" onClose={p.onClose} error={error} footer={<Button type="button" className={btnPrimary} onClick={p.onClose}>{tried || openedAt ? 'Done' : 'Skip for now'}</Button>}>
        <div className="space-y-4">
          {requirePin ? (
            <section aria-label="PIN details" className="rounded-2xl bg-[var(--paper)] p-4 text-center">
              {pin ? (
                <>
                  <p className="text-sm text-[var(--muted)]">The patient&apos;s PIN</p>
                  <p className="font-num text-4xl font-semibold tracking-[0.3em] text-[var(--ink)]" aria-label="PIN">{pin}</p>
                  <div className="mt-2 flex flex-wrap justify-center gap-2">
                    <Button type="button" className={btnSecondary} onClick={() => void copy('pin', pin)}>{copied === 'pin' ? 'Copied ✓' : 'Copy PIN'}</Button>
                    <Button type="button" className={btnSecondary} onClick={() => setPrinting(true)}>🖨 Print sheet with PIN</Button>
                  </div>
                  <p className="mt-2 text-hint text-[var(--muted)]">The WhatsApp message never contains the PIN.</p>
                </>
              ) : (
                <>
                  <p className="text-sm text-[var(--ink)]">This patient already has a PIN.</p>
                  <Button type="button" className={`${btnSecondary} mt-2`} disabled={resetting || !online} onClick={() => setConfirmReset(true)}>{resetting ? 'Resetting…' : 'Reset PIN…'}</Button>
                </>
              )}
            </section>
          ) : (
            <div className="flex flex-wrap items-center justify-between gap-2 rounded-2xl bg-[var(--paper)] p-3 text-sm text-[var(--ink)]">
              <span>No PIN needed — the link opens directly.</span>
              <Button type="button" className={btnSecondary} onClick={() => setPrinting(true)}>🖨 Print sheet</Button>
            </div>
          )}

          <ol className="space-y-3">
            <li className="space-y-1.5">
              <p className="text-sm font-medium text-[var(--ink)]">1. Send the link now</p>
              <div className="flex flex-wrap gap-2">
                <a href={whatsapp} target="_blank" rel="noreferrer" className={`${btnPrimary} inline-flex items-center`}>Send on WhatsApp</a>
                <Button type="button" className={btnSecondary} onClick={() => void copy('link', link)}>{copied === 'link' ? 'Copied ✓' : 'Copy link'}</Button>
              </div>
            </li>
            {requirePin && (
              <li className="space-y-1.5">
                <p className="text-sm font-medium text-[var(--ink)]">2. Show the PIN to the patient</p>
                {pin
                  ? <Button type="button" className={btnSecondary} onClick={() => setShowPin(true)}>Show PIN</Button>
                  : <p className="text-sm text-[var(--muted)]">The patient uses the PIN they already have. If they have forgotten it, use Reset PIN above.</p>}
              </li>
            )}
            <li className="space-y-1">
              <p className="text-sm font-medium text-[var(--ink)]">{requirePin ? '3.' : '2.'} {requirePin ? 'The patient opens the link, enters the PIN and keeps “Remember this phone” ticked' : 'The patient opens the link to start their exercises'}</p>
              <p className={`text-sm ${openedAt ? 'font-medium text-[var(--moss,var(--teal-strong))]' : 'text-[var(--muted)]'}`} aria-live="polite">{openedAt ? `Opened ✓ ${time}` : online ? 'Waiting for the patient to open it…' : 'Needs a connection to check.'}</p>
            </li>
            <li>
              <label className="flex items-center gap-2 text-sm font-medium text-[var(--ink)]"><input type="checkbox" checked={tried} onChange={(e) => setTried(e.target.checked)} /> {requirePin ? '4.' : '3.'} Try one exercise together</label>
            </li>
          </ol>

          {!p.fromTemplate && !templateSaved && (
            <section aria-label="Save as template" className="rounded-xl border border-[var(--border)] p-3">
              {templateName === null ? (
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-sm text-[var(--ink)]">Use this again?</span>
                  <Button type="button" className={btnSecondary} disabled={!online} onClick={() => setTemplateName(p.programTitle)}>Save as template</Button>
                </div>
              ) : (
                <div className="flex gap-2">
                  <input className={inputCls} aria-label="Template name" value={templateName} maxLength={80} onChange={(e) => setTemplateName(e.target.value)} />
                  <Button type="button" className={btnPrimary} onClick={() => void saveTemplate()}>Save</Button>
                </div>
              )}
            </section>
          )}
          {templateSaved && <p className="text-sm text-[var(--moss,var(--teal-strong))]">Saved as a template ✓</p>}
        </div>
      </SheetDialog>

      {showPin && pin && (
        <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/50 p-4">
          <div role="dialog" aria-modal="true" aria-label="Your PIN" className="w-full max-w-sm space-y-3 rounded-2xl bg-[var(--surface)] p-6 text-center shadow-xl">
            <p className="font-display text-lg font-semibold text-[var(--ink)]">{clinic.name}</p>
            <p className="text-sm text-[var(--muted)]">Your PIN</p>
            <p className="font-num font-semibold tracking-[0.2em] text-[var(--ink)]" style={{ fontSize: '56px', lineHeight: 1.1 }}>{pin}</p>
            <Button type="button" className={btnPrimary} onClick={() => setShowPin(false)}>Done</Button>
          </div>
        </div>
      )}
      <PrintSheet open={printing} onClose={() => setPrinting(false)} clinicName={clinic.name} patientName={p.patientName} programTitle={p.programTitle} link={link} pin={effectivePin} items={p.items} />
      <ConfirmDialog open={confirmReset} title="Reset the PIN?" message="The old PIN stops working and phones that were remembered will ask for the new one." confirmLabel="Reset PIN" onConfirm={() => void resetPin()} onCancel={() => setConfirmReset(false)} />
    </>
  );
}
