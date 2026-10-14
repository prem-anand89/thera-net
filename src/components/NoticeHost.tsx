import { useEffect, useState, useSyncExternalStore } from 'react';
import { ConfirmDialog } from '@/components/ui';
import { noticeStore, type Notice } from '@/lib/notify';

const AUTO_DISMISS_MS = { error: 30_000, info: 5_000 } as const;

function NoticeItem({ notice }: { notice: Notice }) {
  // Hovering or focusing a notice pauses its auto-dismiss, so it can be read and copied.
  const [paused, setPaused] = useState(false);
  useEffect(() => {
    if (paused) return;
    const id = window.setTimeout(() => noticeStore.dismiss(notice.id), AUTO_DISMISS_MS[notice.kind]);
    return () => window.clearTimeout(id);
    // `count` restarts the timer when the same message is raised again.
  }, [notice.id, notice.kind, notice.count, paused]);
  const error = notice.kind === 'error';
  return (
    <div
      role={error ? 'alert' : 'status'}
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      onFocus={() => setPaused(true)}
      onBlur={() => setPaused(false)}
      className={`pointer-events-auto flex items-start gap-3 rounded-xl border px-4 py-3 text-sm shadow-lg ${
        error
          ? 'border-[var(--rust)] bg-[var(--rust-light)] text-[var(--rust)]'
          : 'border-[var(--border)] bg-[var(--surface)] text-[var(--ink)]'
      }`}
    >
      <span className="min-w-0 flex-1">
        {notice.message}
        {notice.count > 1 && <span className="ml-1.5 rounded-full bg-black/10 px-1.5 text-xs font-medium">×{notice.count}</span>}
      </span>
      <button
        type="button"
        aria-label="Dismiss"
        className="-my-1 -mr-2 min-h-9 min-w-9 shrink-0 rounded-lg text-lg leading-none hover:bg-black/5"
        onClick={() => noticeStore.dismiss(notice.id)}
      >
        ×
      </button>
    </div>
  );
}

/** Renders `notify` notices and `askConfirm` dialogs; mounted once in main.tsx. */
export function NoticeHost() {
  const notices = useSyncExternalStore(noticeStore.subscribe, noticeStore.notices, noticeStore.notices);
  const confirms = useSyncExternalStore(noticeStore.subscribe, noticeStore.confirms, noticeStore.confirms);
  const current = confirms[0];
  return (
    <>
      <div className="no-print pointer-events-none fixed inset-x-3 top-[calc(env(safe-area-inset-top)+4rem)] z-[70] mx-auto flex max-w-md flex-col gap-2 sm:left-auto sm:right-4 sm:mx-0">
        {notices.map((n) => (
          <NoticeItem key={n.id} notice={n} />
        ))}
      </div>
      {current && (
        <ConfirmDialog
          key={current.id}
          open
          title={current.title}
          message={current.message}
          confirmLabel={current.confirmLabel}
          cancelLabel={current.cancelLabel}
          destructive={current.destructive}
          typeToConfirm={current.typeToConfirm}
          onConfirm={() => noticeStore.settleConfirm(current.id, true)}
          onCancel={() => noticeStore.settleConfirm(current.id, false)}
        />
      )}
    </>
  );
}
