import { useState } from 'react';
import { notify } from '@/lib/notify';
import { btnSecondary } from '@/components/ui';
import { collectUnsyncedRows } from './unsyncedWork';

/** Saves the data behind every queued change as a JSON file, so a stuck device never loses work for good. */
export function DownloadUnsyncedButton() {
  const [busy, setBusy] = useState(false);
  async function download() {
    setBusy(true);
    try {
      const rows = await collectUnsyncedRows();
      const blob = new Blob([JSON.stringify({ exportedAt: new Date().toISOString(), rows }, null, 2)], {
        type: 'application/json',
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `thera-net-unsynced-${new Date().toISOString().slice(0, 10)}.json`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 10_000);
    } catch {
      notify.error('Could not prepare the download.');
    } finally {
      setBusy(false);
    }
  }
  return (
    <button type="button" className={btnSecondary} disabled={busy} onClick={() => void download()}>
      {busy ? 'Preparing…' : 'Download unsynced changes'}
    </button>
  );
}
