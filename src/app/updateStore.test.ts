// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';
import {
  SNOOZE_MS,
  STICKY_AFTER_MS,
  MIN_CHECK_GAP_MS,
  bannerVisible,
  canApplyInBackground,
  isBusyDocument,
  isSticky,
  shouldCheckForUpdate,
  updateStore,
} from './updateStore';

const T0 = 1_000_000;

describe('update banner rules', () => {
  beforeEach(() => updateStore.reset());

  it('is hidden until an update is waiting', () => {
    expect(bannerVisible(updateStore.get(), T0)).toBe(false);
    updateStore.markWaiting(T0);
    expect(bannerVisible(updateStore.get(), T0)).toBe(true);
  });

  it('Later snoozes for 4 hours, then the banner returns', () => {
    updateStore.markWaiting(T0);
    updateStore.snooze(T0);
    expect(bannerVisible(updateStore.get(), T0 + SNOOZE_MS - 1)).toBe(false);
    expect(bannerVisible(updateStore.get(), T0 + SNOOZE_MS)).toBe(true);
  });

  it('becomes sticky after 8 hours and ignores a snooze', () => {
    updateStore.markWaiting(T0);
    updateStore.snooze(T0 + STICKY_AFTER_MS - 1000);
    expect(isSticky(updateStore.get(), T0 + STICKY_AFTER_MS - 1)).toBe(false);
    expect(isSticky(updateStore.get(), T0 + STICKY_AFTER_MS)).toBe(true);
    expect(bannerVisible(updateStore.get(), T0 + STICKY_AFTER_MS)).toBe(true);
  });

  it('keeps the first waiting time when marked again', () => {
    updateStore.markWaiting(T0);
    updateStore.markWaiting(T0 + 5000);
    expect(updateStore.get().waitingSince).toBe(T0);
  });
});

describe('shouldCheckForUpdate', () => {
  const base = { now: T0 + MIN_CHECK_GAP_MS, lastCheck: T0, visible: true, online: true };
  it('checks when visible, online and the gap has passed', () => {
    expect(shouldCheckForUpdate(base)).toBe(true);
  });
  it('throttles, and skips when hidden or offline', () => {
    expect(shouldCheckForUpdate({ ...base, now: T0 + MIN_CHECK_GAP_MS - 1 })).toBe(false);
    expect(shouldCheckForUpdate({ ...base, visible: false })).toBe(false);
    expect(shouldCheckForUpdate({ ...base, online: false })).toBe(false);
  });
});

describe('background apply', () => {
  it('only when hidden, fully synced and nothing open', () => {
    expect(canApplyInBackground({ hidden: true, pendingSync: 0, busy: false })).toBe(true);
    expect(canApplyInBackground({ hidden: false, pendingSync: 0, busy: false })).toBe(false);
    expect(canApplyInBackground({ hidden: true, pendingSync: 2, busy: false })).toBe(false);
    expect(canApplyInBackground({ hidden: true, pendingSync: 0, busy: true })).toBe(false);
  });
});

describe('isBusyDocument', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });
  it('is false on an empty page', () => {
    expect(isBusyDocument(document)).toBe(false);
  });
  it('is true while a dialog is open', () => {
    document.body.innerHTML = '<div role="dialog" aria-modal="true"></div>';
    expect(isBusyDocument(document)).toBe(true);
  });
  it('is true while a text field with content has focus', () => {
    document.body.innerHTML = '<input id="a" value="Ananya" />';
    (document.getElementById('a') as HTMLInputElement).focus();
    expect(isBusyDocument(document)).toBe(true);
  });
  it('is false for a focused empty field', () => {
    document.body.innerHTML = '<input id="a" value="" />';
    (document.getElementById('a') as HTMLInputElement).focus();
    expect(isBusyDocument(document)).toBe(false);
  });
});
