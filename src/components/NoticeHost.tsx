import { useEffect, useSyncExternalStore } from 'react';
import { ConfirmDialog } from '@/components/ui';
import { noticeStore, type Notice } from './notify';

const AUTO_DISMISS_MS = { error: 10_000, info: 5_000 } as const;

function NoticeItem({ notice }: { notice: Notice }) {
  useEffect(() => {
    const id = window.setTimeout(() => noticeStore.dismiss(notice.id), AUTO_DISMISS_MS[notice.kind]);
    return () => window.clearTimeout(id);
  }, [notice.id, notice.kind]);
  const error = notice.kind === 'error';
  return (
    <div
      role={error ? 'alert' : 'status'}
      className={`pointer-events-auto flex items-start gap-3 rounded-xl border px-4 py-3 text-sm shadow-lg ${
        error
          ? 'border-[var(--rust)] bg-[var(--rust-light)] text-[var(--rust)]'
          : 'border-[var(--border)] bg-[var(--surface)] text-[var(--ink)]'
      }`}
    >
      <span className="min-w-0 flex-1">{notice.message}</span>
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
