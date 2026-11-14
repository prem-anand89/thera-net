// A paper copy of the program for the patient: the clinic, the link, the PIN (only when it was just created or reset, the
// one moment it is known), and the exercises section by section with a picture, the steps and the dose. Rendered off
// screen and sent to the printer; nothing is stored. Uses the browser's print dialog (Save as PDF works too).
import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { useClinic } from '@/app/clinicContext';
import { EXERCISE_PHASE_LABELS } from '@/domain/hep';
import { describeDose } from '@/domain/hepDose';
import { hepMediaService } from '@/services/hepMediaService';
import type { HepItemInput } from '@/services/hepService';
import { groupItemsByPhase, itemDose } from './hepItems';

export interface PrintSheetProps {
  open: boolean;
  onClose: () => void;
  clinicName: string;
  patientName: string;
  programTitle: string;
  link: string;
  /** Shown only when given. */
  pin: string | null;
  items: HepItemInput[];
}

const PRINT_CSS = '.hep-print{display:none}@media print{body>*:not(.hep-print){display:none!important}.hep-print{display:block!important;color:#000;background:#fff;padding:0}.hep-print section{break-inside:avoid}}';

export function PrintSheet({ open, onClose, clinicName, patientName, programTitle, link, pin, items }: PrintSheetProps) {
  const clinic = useClinic();
  const [pictures, setPictures] = useState<Record<string, string>>({});

  useEffect(() => {
    if (!open) return;
    let live = true;
    const done = () => { if (live) onClose(); };
    (async () => {
      let urls: Record<string, string> = {};
      const keys = [...new Set(items.map((i) => i.mediaKeys[0]).filter((k): k is string => !!k))];
      try { urls = await hepMediaService.mintViewUrls(clinic.id, keys); } catch { /* print without pictures */ }
      if (!live) return;
      setPictures(urls);
      // Wait for the pictures to paint before the print dialog opens.
      await new Promise((r) => setTimeout(r, Object.keys(urls).length > 0 ? 600 : 50));
      if (!live) return;
      window.addEventListener('afterprint', done, { once: true });
      window.print();
    })();
    return () => { live = false; window.removeEventListener('afterprint', done); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  if (!open) return null;
  return createPortal(
    <div className="hep-print" aria-hidden="true">
      <style>{PRINT_CSS}</style>
      <h1 style={{ fontSize: '22pt', margin: 0 }}>{clinicName}</h1>
      <p style={{ fontSize: '14pt', margin: '4pt 0' }}>Home exercise program for {patientName}</p>
      <p style={{ fontSize: '12pt', margin: '0 0 10pt' }}>{programTitle}</p>
      <div style={{ border: '2pt solid #000', padding: '8pt', margin: '8pt 0' }}>
        <p style={{ margin: 0, fontSize: '11pt' }}>1. Open this link on your phone: <strong>{link}</strong></p>
        {pin && <p style={{ margin: '6pt 0 0', fontSize: '11pt' }}>2. Enter your PIN: <strong style={{ fontSize: '24pt', letterSpacing: '6pt' }}>{pin}</strong></p>}
        <p style={{ margin: '6pt 0 0', fontSize: '11pt' }}>{pin ? '3.' : '2.'} Tick “Remember this phone” so you are not asked again.</p>
        <p style={{ margin: '6pt 0 0', fontSize: '10pt' }}>Keep this sheet private. Share the link only with the person helping you.</p>
      </div>
      {groupItemsByPhase(items).map((s) => (
        <section key={s.phase} style={{ margin: '10pt 0' }}>
          <h2 style={{ fontSize: '14pt', borderBottom: '1pt solid #000', margin: '0 0 6pt' }}>{EXERCISE_PHASE_LABELS[s.phase]}</h2>
          {s.rows.map(({ item }, n) => (
            <div key={n} style={{ display: 'flex', gap: '10pt', margin: '0 0 8pt' }}>
              {item.mediaKeys[0] && pictures[item.mediaKeys[0]] && <img src={pictures[item.mediaKeys[0]]} alt="" style={{ width: '90pt', height: '90pt', objectFit: 'cover' }} />}
              <div>
                <p style={{ margin: 0, fontSize: '12pt', fontWeight: 700 }}>{item.title}{item.optional ? ' (optional)' : ''}</p>
                <p style={{ margin: '1pt 0', fontSize: '10.5pt' }}>{describeDose(itemDose(item))}</p>
                {item.instructions.trim() && <ol style={{ margin: '2pt 0 0 14pt', padding: 0, fontSize: '10pt' }}>{item.instructions.split('\n').filter((l) => l.trim()).map((l, i) => <li key={i}>{l}</li>)}</ol>}
                {item.stopIf.trim() && <p style={{ margin: '2pt 0 0', fontSize: '10pt' }}>Stop if: {item.stopIf}</p>}
                {item.specialInstructions?.trim() && <p style={{ margin: '2pt 0 0', fontSize: '10pt', fontStyle: 'italic' }}>{item.specialInstructions}</p>}
              </div>
            </div>
          ))}
        </section>
      ))}
    </div>,
    document.body,
  );
}
