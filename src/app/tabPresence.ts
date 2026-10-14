/**
 * Is another Thera.Net tab or window open on this device? A service-worker
 * switch (skipWaiting + clients.claim) takes over every tab, so one tab may only
 * do it unprompted when it is the only one: another tab can hold unsaved input
 * that a reload would lose. Tabs answer each other over a BroadcastChannel.
 */
const CHANNEL = 'theranet-tabs';
const REPLY_WAIT_MS = 300;

/** Starts answering "anyone else here?" from other tabs. Call once per page. */
export function answerTabPresence(): void {
  if (typeof BroadcastChannel === 'undefined') return;
  const channel = new BroadcastChannel(CHANNEL);
  channel.onmessage = (event: MessageEvent) => {
    if (event.data === 'who-is-there') channel.postMessage('here');
  };
}

/** Resolves true if any other tab answers within a short wait. Unknown (no BroadcastChannel) counts as "yes": be careful. */
export function otherTabsOpen(waitMs = REPLY_WAIT_MS): Promise<boolean> {
  if (typeof BroadcastChannel === 'undefined') return Promise.resolve(true);
  return new Promise((resolve) => {
    const channel = new BroadcastChannel(CHANNEL);
    const done = (answer: boolean) => {
      window.clearTimeout(timer);
      channel.close();
      resolve(answer);
    };
    const timer = window.setTimeout(() => done(false), waitMs);
    channel.onmessage = (event: MessageEvent) => {
      if (event.data === 'here') done(true);
    };
    channel.postMessage('who-is-there');
  });
}
