import { useState } from 'react';

/** Copies an address to the clipboard. A missing or refused clipboard leaves the label as it was. */
export function CopyAddressButton({ address, className }: { address: string; className?: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      className={
        className ??
        'min-h-9 rounded-lg border border-[var(--teal)] bg-[var(--surface)] px-3 text-xs font-medium text-[var(--teal-strong)]'
      }
      onClick={() => {
        const write = navigator.clipboard?.writeText(address);
        if (!write) return;
        write.then(
          () => setCopied(true),
          () => setCopied(false)
        );
      }}
    >
      {copied ? 'Address copied ✓' : 'Copy address'}
    </button>
  );
}
