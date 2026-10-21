import { assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts';
import { subscriptionsToRemove } from './delivery.ts';

Deno.test('404 and 410 are always removed', () => {
  assertEquals(subscriptionsToRemove([{ id: 'a', status: 404 }, { id: 'b', status: 410 }]), ['a', 'b']);
});

Deno.test('a 403 is removed when another subscription in the batch worked', () => {
  assertEquals(subscriptionsToRemove([{ id: 'a', status: 201 }, { id: 'b', status: 403 }]), ['b']);
});

Deno.test('a 403 on every send is kept: that points at our key, not the subscriptions', () => {
  assertEquals(subscriptionsToRemove([{ id: 'a', status: 403 }, { id: 'b', status: 403 }]), []);
});

Deno.test('other failures are kept', () => {
  assertEquals(subscriptionsToRemove([{ id: 'a', status: 201 }, { id: 'b', status: 500 }, { id: 'c', status: 429 }]), []);
});
