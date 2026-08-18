import { useEffect, useState } from 'react';
import QRCode from 'qrcode';
import { useClinic } from '@/app/clinicContext';
import { formatINR } from '@/domain/money';
import type { Paise } from '@/domain/money';
import {
  buildUpiNote,
  buildUpiPayUri,
  clinicCanShowUpiQr,
  clinicUpiPayeeName,
  isValidUpiVpa,
} from '@/domain/upiPay';
import { publicLogoUrl } from '@/lib/supabase';
import { btnSecondary } from '@/components/ui';

export function ShowUpiQrButton({
  amountPaise,
  mrno,
  visitDate,
  patientName,
}: {
  amountPaise: Paise;
  mrno: string;
  visitDate: string;
  patientName?: string | null;
}) {
  const clinic = useClinic();
  const [open, setOpen] = useState(false);

  if (!clinicCanShowUpiQr(clinic) || amountPaise <= 0) return null;

  return (
    <>
      <button
        type="button"
        className="mt-2 text-xs font-medium text-[var(--teal)] hover:underline"
        onClick={() => setOpen(true)}
      >
        Show UPI QR
      </button>
      {open && (
        <UpiQrModal
          amountPaise={amountPaise}
          mrno={mrno}
          visitDate={visitDate}
          patientName={patientName}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  );
}

function UpiQrModal({
  amountPaise,
  mrno,
  visitDate,
  patientName,
  onClose,
}: {
  amountPaise: Paise;
  mrno: string;
  visitDate: string;
  patientName?: string | null;
  onClose: () => void;
}) {
  const clinic = useClinic();
  const vpa = clinic.upiVpa?.trim() ?? '';
  const hasVpa = isValidUpiVpa(vpa);
  const staticUrl = publicLogoUrl(clinic.upiQrPath);
  const [preferStatic, setPreferStatic] = useState(!hasVpa);
  const showStatic = preferStatic || !hasVpa;
  const note = buildUpiNote({ mrno, visitDate, patientName });
  const payee = clinicUpiPayeeName(clinic);
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null);
  const [qrError, setQrError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!hasVpa || showStatic) {
      setQrDataUrl(null);
      setQrError(null);
      return;
    }
    const uri = buildUpiPayUri({ vpa, payeeName: payee, amountPaise, note });
    let cancelled = false;
    void QRCode.toDataURL(uri, { width: 280, margin: 2, errorCorrectionLevel: 'M' })
      .then((url) => {
        if (!cancelled) setQrDataUrl(url);
      })
      .catch(() => {
        if (!cancelled) setQrError('Could not draw the QR code.');
      });
    return () => {
      cancelled = true;
    };
  }, [hasVpa, showStatic, vpa, payee, amountPaise, note]);

  async function copyVpa() {
    if (!vpa) return;
    try {
      await navigator.clipboard.writeText(vpa);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      setCopied(false);
    }
  }

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-[var(--ink)]/50 p-4">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="upi-qr-title"
        className="w-full max-w-sm space-y-4 rounded-[10px] bg-[var(--surface)] p-5"
      >
        <h2 id="upi-qr-title" className="font-display text-base font-semibold text-[var(--ink)]">
          Scan to pay
        </h2>
        <p className="font-num text-center text-2xl font-semibold text-[var(--ink)]">{formatINR(amountPaise)}</p>
        <p className="text-center text-sm text-[var(--muted)]">
          {payee}
          {mrno ? ` · ${mrno}` : ''}
        </p>

        <div className="flex justify-center rounded-lg border border-[var(--border)] bg-[var(--paper)] p-4">
          {showStatic && staticUrl ? (
            <img src={staticUrl} alt="Clinic UPI QR code" className="h-56 w-56 object-contain" />
          ) : showStatic ? (
            <p className="py-16 text-sm text-[var(--muted)]">Uploaded QR is unavailable offline.</p>
          ) : qrDataUrl ? (
            <img src={qrDataUrl} alt="UPI payment QR code" className="h-56 w-56" />
          ) : (
            <p className="py-16 text-sm text-[var(--muted)]">{qrError ?? 'Preparing QR…'}</p>
          )}
        </div>

        {showStatic && (
          <p className="text-xs text-[var(--muted)]">
            Ask the patient to enter {formatINR(amountPaise)} in their UPI app. Ref: {note || mrno || '—'}
          </p>
        )}
        {!showStatic && note && (
          <p className="text-xs text-[var(--muted)]">UPI note: {note}</p>
        )}

        {hasVpa && (
          <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
            <span className="font-num text-[var(--ink)]">{vpa}</span>
            <button type="button" className="font-medium text-[var(--teal)] hover:underline" onClick={() => void copyVpa()}>
              {copied ? 'Copied' : 'Copy UPI ID'}
            </button>
          </div>
        )}

        {hasVpa && staticUrl && (
          <button
            type="button"
            className="text-xs font-medium text-[var(--teal)] hover:underline"
            onClick={() => setPreferStatic((v) => !v)}
          >
            {showStatic ? 'Show amount QR' : 'Show uploaded clinic QR'}
          </button>
        )}

        <div className="flex justify-end">
          <button type="button" className={btnSecondary} onClick={onClose}>
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
