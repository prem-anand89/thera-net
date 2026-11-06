import { useCallback, useEffect, useRef, useState, type RefObject } from 'react';
import { canShareFiles, downloadFile, renderElementToPdf, shareBillFile } from '@/lib/pdfShare';

export type BillSharePhase = 'closed' | 'preparing' | 'ready' | 'downloaded' | 'failed';

/**
 * Sharing a bill as a real PDF. Building the PDF takes seconds, and browsers refuse the share sheet that long after a
 * tap, so: on a device that can share files the PDF is prepared while the page is idle and one tap sends it. Otherwise
 * the first tap prepares it and a second, fresh tap sends it. A desktop downloads it instead.
 *
 * `freshnessKey` must change whenever anything printed on the bill changes: a prepared PDF is only ever used while its
 * key still matches, so a bill changed since it was prepared can't be sent.
 */
export function useBillShare({
  contentRef,
  fileName,
  title,
  paper,
  freshnessKey,
  ready,
}: {
  contentRef: RefObject<HTMLElement | null>;
  fileName: string;
  title: string;
  paper: 'A4' | 'A5';
  freshnessKey: string;
  /** False until the page shows the final bill (payments and status loaded). */
  ready: boolean;
}) {
  const [phase, setPhase] = useState<BillSharePhase>('closed');
  const prepared = useRef<{ key: string; file: File } | null>(null);
  const inFlight = useRef<{ key: string; promise: Promise<File> } | null>(null);
  const keyRef = useRef(freshnessKey);
  keyRef.current = freshnessKey;

  const prepare = useCallback(async (): Promise<File> => {
    const key = keyRef.current;
    if (prepared.current?.key === key) return prepared.current.file;
    if (inFlight.current?.key === key) return inFlight.current.promise;
    if (!contentRef.current) throw new Error('The bill is not on the page yet.');
    const promise = renderElementToPdf(contentRef.current, fileName, paper).then((file) => {
      prepared.current = { key, file };
      return file;
    });
    inFlight.current = { key, promise };
    try {
      return await promise;
    } finally {
      if (inFlight.current?.key === key) inFlight.current = null;
    }
  }, [contentRef, fileName, paper]);

  // Only on devices that can use it, and only once the page is quiet: this work blocks the page while it runs.
  useEffect(() => {
    if (!ready || !canShareFiles()) return;
    const timer = setTimeout(() => {
      const run = () => void prepare().catch(() => undefined);
      if ('requestIdleCallback' in window) window.requestIdleCallback(run, { timeout: 4000 });
      else run();
    }, 1500);
    return () => clearTimeout(timer);
  }, [ready, freshnessKey, prepare]);

  const prepareThenOffer = useCallback(async () => {
    setPhase('preparing');
    try {
      const file = await prepare();
      if (canShareFiles()) {
        setPhase('ready');
      } else {
        downloadFile(file);
        setPhase('downloaded');
      }
    } catch (e) {
      console.warn('Could not prepare the bill PDF:', e);
      setPhase('failed');
    }
  }, [prepare]);

  /** The Share button, and the dialog's Send PDF button: both run straight after a tap. */
  const send = useCallback(async () => {
    const current = prepared.current;
    if (!current || current.key !== keyRef.current || !canShareFiles()) {
      await prepareThenOffer();
      return;
    }
    const outcome = await shareBillFile(current.file, title);
    if (outcome === 'shared' || outcome === 'cancelled') setPhase('closed');
    else setPhase(outcome === 'needs-tap' ? 'ready' : 'failed');
  }, [prepareThenOffer, title]);

  // The bill changed while the dialog was open: what it offers to send is out of date.
  useEffect(() => {
    if ((phase === 'ready' || phase === 'downloaded') && prepared.current?.key !== freshnessKey) {
      void prepareThenOffer();
    }
  }, [freshnessKey, phase, prepareThenOffer]);

  return {
    phase,
    send,
    download: () => {
      if (prepared.current) downloadFile(prepared.current.file);
    },
    close: () => setPhase('closed'),
  };
}
