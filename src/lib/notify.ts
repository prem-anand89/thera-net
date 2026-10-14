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
  /** How many times this same message was raised while it was on screen. */
  count: number;
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

/** At most this many notices are on screen; the oldest is dropped first. */
export const MAX_NOTICES = 3;

function push(kind: Notice['kind'], message: string) {
  // The same message again (a repeated failure): count it instead of stacking copies.
  const existing = notices.find((n) => n.kind === kind && n.message === message);
  if (existing) {
    notices = notices.map((n) => (n.id === existing.id ? { ...n, count: n.count + 1 } : n));
  } else {
    notices = [...notices, { id: nextId++, kind, message, count: 1 }].slice(-MAX_NOTICES);
  }
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
