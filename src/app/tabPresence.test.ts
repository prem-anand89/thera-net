// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { answerTabPresence, otherTabsOpen } from './tabPresence';

let instances: FakeChannel[] = [];
class FakeChannel {
  onmessage: ((e: MessageEvent) => void) | null = null;
  closed = false;
  constructor() {
    instances.push(this);
  }
  postMessage(data: unknown) {
    for (const c of instances) {
      if (c !== this && !c.closed) setTimeout(() => c.onmessage?.({ data } as MessageEvent), 0);
    }
  }
  close() {
    this.closed = true;
  }
}

describe('tabPresence', () => {
  beforeEach(() => {
    instances = [];
    vi.stubGlobal('BroadcastChannel', FakeChannel);
  });
  afterEach(() => vi.unstubAllGlobals());

  it('is true when another tab is answering', async () => {
    answerTabPresence(); // the "other tab"
    expect(await otherTabsOpen(100)).toBe(true);
  });

  it('is false when nobody answers', async () => {
    expect(await otherTabsOpen(30)).toBe(false);
  });

  it('counts as "another tab open" when BroadcastChannel is unavailable (be careful)', async () => {
    vi.stubGlobal('BroadcastChannel', undefined);
    expect(await otherTabsOpen(10)).toBe(true);
    expect(() => answerTabPresence()).not.toThrow();
  });
});
