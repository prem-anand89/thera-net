/// <reference lib="webworker" />
import { precacheAndRoute, cleanupOutdatedCaches } from 'workbox-precaching';

declare const self: ServiceWorkerGlobalScope & {
  __WB_MANIFEST: Array<{ url: string; revision: string | null }>;
};

precacheAndRoute(self.__WB_MANIFEST);
cleanupOutdatedCaches();
self.skipWaiting();
self.clients.claim();

interface PushData {
  title: string;
  body: string;
  tag: string;
  url: string;
}

self.addEventListener('push', (event) => {
  const data = (event.data?.json() ?? {}) as Partial<PushData>;
  event.waitUntil(
    self.registration.showNotification(data.title ?? 'Thera.Net', {
      body: data.body ?? '',
      tag: data.tag ?? 'thera-net',
      icon: '/favicon-32.png',
      data: { url: data.url ?? '/' },
    })
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const target = new URL((event.notification.data?.url as string) ?? '/', self.location.origin).href;
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(async (clients) => {
      const existing = clients.find((c): c is WindowClient => 'focus' in c);
      if (existing) {
        await existing.focus();
        await existing.navigate(target);
        return;
      }
      await self.clients.openWindow(target);
    })
  );
});
