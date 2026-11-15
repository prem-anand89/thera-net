// "Message patient": a few ready messages (a reminder, how are you feeling, time for a check-in ...), each editable before
// it is sent on WhatsApp. They carry the clinic name and the page link only: never the PIN, the patient's name or anything
// about their health.
import { useEffect, useState } from 'react';
import { useClinic } from '@/app/clinicContext';
import { Button } from '@/components/Button';
import { SheetDialog, btnSecondary, filterChip, inputCls } from '@/components/ui';
import { buildWhatsAppSendUrl } from '@/lib/pdfShare';
import { repos } from '@/services';
import { HEP_MESSAGE_KINDS, buildHepPatientMessage, type HepMessageKind } from './hepSharing';

export interface MessagePatientSheetProps {
  open: boolean;
  onClose: () => void;
  patientId: string;
  /** The patient's page token (their link). */
  token: string;
  /** Which message to start with. */
  initial?: HepMessageKind;
}

export function MessagePatientSheet({ open, onClose, patientId, token, initial = 'reminder' }: MessagePatientSheetProps) {
  const clinic = useClinic();
  const [kind, setKind] = useState<HepMessageKind>(initial);
  const [text, setText] = useState('');
  const [phone, setPhone] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!open) return;
    setKind(initial);
    setCopied(false);
    void repos.patients.get(patientId).then((p) => setPhone(p?.phone ?? null)).catch(() => setPhone(null));
  }, [open, patientId, initial]);
  useEffect(() => { if (open) setText(buildHepPatientMessage(kind, { token, clinicName: clinic.name })); }, [open, kind, token, clinic.name]);

  return (
    <SheetDialog
      open={open}
      title="Message patient"
      onClose={onClose}
      footer={
        <>
          <Button type="button" className={btnSecondary} onClick={onClose}>Close</Button>
          <a href={buildWhatsAppSendUrl(text, phone)} target="_blank" rel="noreferrer" onClick={onClose} className="inline-flex min-h-11 items-center justify-center rounded-lg bg-[var(--teal)] px-4 py-2 text-sm font-medium text-white hover:bg-[var(--teal-strong)]">Open WhatsApp</a>
        </>
      }
    >
      <div className="space-y-3">
        <div role="group" aria-label="Message" className="flex flex-wrap gap-1.5">
          {(Object.keys(HEP_MESSAGE_KINDS) as HepMessageKind[]).map((k) => (
            <button key={k} type="button" aria-pressed={kind === k} className={filterChip(kind === k)} onClick={() => setKind(k)}>{HEP_MESSAGE_KINDS[k]}</button>
          ))}
        </div>
        <textarea className={inputCls} rows={7} aria-label="Message text" value={text} onChange={(e) => setText(e.target.value)} />
        <div className="flex items-center gap-3">
          <Button type="button" className="text-sm font-medium text-[var(--teal)]" onClick={() => void navigator.clipboard.writeText(text).then(() => setCopied(true)).catch(() => {})}>{copied ? 'Copied ✓' : 'Copy message'}</Button>
          {!phone && <span className="text-hint text-[var(--muted)]">No phone number on file: WhatsApp will ask who to send it to.</span>}
        </div>
        <p className="text-hint text-[var(--muted)]">The message has your clinic name and the page link only. It never contains the PIN.</p>
      </div>
    </SheetDialog>
  );
}
