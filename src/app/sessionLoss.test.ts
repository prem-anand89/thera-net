import { describe, expect, it } from 'vitest';
import {
  consumeVoluntarySignOut,
  decideOnSessionStart,
  decideOnSignedOut,
  markVoluntarySignOut,
} from './sessionLoss';

describe('decideOnSignedOut', () => {
  it.each([
    { voluntary: true, outboxCount: 3, expected: 'clear' },
    { voluntary: true, outboxCount: 0, expected: 'clear' },
    { voluntary: false, outboxCount: 0, expected: 'clear' },
    { voluntary: false, outboxCount: 2, expected: 'keep' },
  ])('voluntary=$voluntary outbox=$outboxCount -> $expected', ({ expected, ...input }) => {
    expect(decideOnSignedOut(input)).toBe(expected);
  });
});

describe('decideOnSessionStart', () => {
  it.each([
    { lastUserId: null, userId: 'a', outboxCount: 5, expected: 'resume' },
    { lastUserId: 'a', userId: 'a', outboxCount: 5, expected: 'resume' },
    { lastUserId: 'a', userId: 'b', outboxCount: 0, expected: 'clear-then-resume' },
    { lastUserId: 'a', userId: 'b', outboxCount: 2, expected: 'confirm-discard' },
  ])('last=$lastUserId now=$userId outbox=$outboxCount -> $expected', ({ expected, ...input }) => {
    expect(decideOnSessionStart(input)).toBe(expected);
  });
});

describe('voluntary sign-out flag', () => {
  it('is read once, then resets', () => {
    expect(consumeVoluntarySignOut()).toBe(false);
    markVoluntarySignOut();
    expect(consumeVoluntarySignOut()).toBe(true);
    expect(consumeVoluntarySignOut()).toBe(false);
  });

  it('expires, so a sign-out that failed cannot make a later session loss look deliberate', () => {
    markVoluntarySignOut(1_000);
    expect(consumeVoluntarySignOut(1_000 + 20_000)).toBe(false);
  });
});
