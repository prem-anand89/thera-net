import type { ReactNode } from 'react';

/**
 * App-wide replacements for native `alert()` / `confirm()`: `notify` shows a
 * dismissable notice, `askConfirm` returns a promise for a styled confirm. Both
 * work from non-React code (pdfShare, service callbacks). `NoticeHost`, mounted
 * once in main.tsx, renders them.
 */

export interface Notice {
  id: number;
  kind: 'error' | 'info';
  message: string;
}

export interface ConfirmRequest {
  id: number;
  title: string;
  message: ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  destructive?: boolean;
  typeToConfirm?: { placeholder: string; isMatch: (typed: string) => boolean };
  resolve: (ok: boolean) => void;
}

let nextId = 1;
let notices: Notice[] = [];
let confirms: ConfirmRequest[] = [];
const subscribers = new Set<() => void>();
const emit = () => subscribers.forEach((fn) => fn());

export const noticeStore = {
  subscribe(fn: () => void) {
    subscribers.add(fn);
    return () => {
      subscribers.delete(fn);
    };
  },
  notices: () => notices,
  confirms: () => confirms,
  dismiss(id: number) {
    notices = notices.filter((n) => n.id !== id);
    emit();
  },
  settleConfirm(id: number, ok: boolean) {
    const req = confirms.find((c) => c.id === id);
    confirms = confirms.filter((c) => c.id !== id);
    emit();
    req?.resolve(ok);
  },
  reset() {
    notices = [];
    confirms.forEach((c) => c.resolve(false));
    confirms = [];
    emit();
  },
};

function push(kind: Notice['kind'], message: string) {
  notices = [...notices, { id: nextId++, kind, message }];
  emit();
}

export const notify = {
  error: (message: string) => push('error', message),
  info: (message: string) => push('info', message),
};

export function askConfirm(options: Omit<ConfirmRequest, 'id' | 'resolve'>): Promise<boolean> {
  return new Promise((resolve) => {
    confirms = [...confirms, { ...options, id: nextId++, resolve }];
    emit();
  });
}
