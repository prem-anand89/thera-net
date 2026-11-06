import { useDialogBehavior } from '@/components/dialogBehavior';
import { btnPrimary, btnSecondary, ErrorNote } from '@/components/ui';
import type { BillSharePhase } from './useBillShare';

/** The steps of sharing a bill, for when one tap can't do it (see `useBillShare`). */
export function ShareBillDialog({
  phase,
  patientName,
  patientPhone,
  onSend,
  onDownload,
  onOpenChat,
  onSendTextOnly,
  onClose,
}: {
  phase: Exclude<BillSharePhase, 'closed'>;
  patientName: string;
  patientPhone: string | null;
  onSend: () => void;
  onDownload: () => void;
  onOpenChat: () => void;
  onSendTextOnly: () => void;
  onClose: () => void;
}) {
  const dialogRef = useDialogBehavior<HTMLDivElement>(true, onClose);
  const recipient = patientPhone ? `${patientName} · ${patientPhone}` : patientName;
  return (
    <div className="no-print fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div ref={dialogRef} role="dialog" aria-modal="true" aria-labelledby="share-bill-title" className="modal-shell w-full max-w-sm">
        <div className="modal-header">
          <h2 id="share-bill-title">Share bill</h2>
          <button type="button" className="modal-close" aria-label="Close" onClick={onClose}>
            ✕
          </button>
        </div>
        <div className="modal-body space-y-3 p-4 text-sm text-[var(--ink)]">
          <p className="text-[var(--muted)]">For {recipient}</p>
          {phase === 'preparing' && <p role="status">Preparing the bill…</p>}
          {phase === 'ready' && (
            <>
              <p>The bill is ready. Choose WhatsApp, then pick {patientName}.</p>
              <button type="button" className={`${btnPrimary} w-full`} onClick={onSend}>
                Send PDF
              </button>
            </>
          )}
          {phase === 'downloaded' && (
            <>
              <p>The bill was downloaded. Open the chat, then attach the file.</p>
              <button type="button" className={`${btnPrimary} w-full`} onClick={onOpenChat}>
                Open WhatsApp chat
              </button>
              <button type="button" className={`${btnSecondary} w-full`} onClick={onDownload}>
                Download again
              </button>
            </>
          )}
          {phase === 'failed' && (
            <>
              <ErrorNote message="The bill PDF could not be shared. Try again, or send a message without the bill." />
              <button type="button" className={`${btnPrimary} w-full`} onClick={onSend}>
                Try again
              </button>
              <button type="button" className={`${btnSecondary} w-full`} onClick={onSendTextOnly}>
                Send message without the bill
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
