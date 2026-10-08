// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';

const deleteEq = vi.fn().mockResolvedValue({ error: null });
let maybeSingleResult: { data: { endpoint: string } | null } = { data: { endpoint: 'https://push.example/abc' } };
const maybeSingle = vi.fn(() => Promise.resolve(maybeSingleResult));
vi.mock('@/lib/supabase', () => ({
  getSupabase: () => ({
    from: () => ({
      delete: () => ({ eq: deleteEq }),
      select: () => ({ eq: () => ({ maybeSingle }) }),
    }),
  }),
}));

import { disablePushForThisDevice, pushState } from './pushSubscription';

afterEach(() => {
  vi.restoreAllMocks();
  deleteEq.mockClear();
  maybeSingle.mockClear();
  maybeSingleResult = { data: { endpoint: 'https://push.example/abc' } };
});

function mockGrantedWithSubscription(unsubscribe = vi.fn()) {
  Object.defineProperty(window, 'PushManager', { value: function () {}, configurable: true });
  Object.defineProperty(window, 'Notification', { value: { permission: 'granted' }, configurable: true });
  Object.defineProperty(window, 'matchMedia', { value: () => ({ matches: false }), configurable: true });
  Object.defineProperty(navigator, 'serviceWorker', {
    value: {
      getRegistration: async () => ({
        pushManager: {
          getSubscription: async () => ({ endpoint: 'https://push.example/abc', unsubscribe }),
        },
      }),
    },
    configurable: true,
  });
}

describe('pushState', () => {
  it('reports unsupported when PushManager is missing', async () => {
    Object.defineProperty(window, 'PushManager', { value: undefined, configurable: true });
    expect(await pushState()).toBe('unsupported');
  });

  it('reports denied when the browser has denied permission', async () => {
    Object.defineProperty(window, 'PushManager', { value: function () {}, configurable: true });
    Object.defineProperty(window, 'Notification', { value: { permission: 'denied' }, configurable: true });
    Object.defineProperty(navigator, 'serviceWorker', {
      value: { getRegistration: async () => undefined },
      configurable: true,
    });
    // Not installed and no registration: denied must still win over needs-install.
    Object.defineProperty(window, 'matchMedia', {
      value: () => ({ matches: false }),
      configurable: true,
    });
    expect(await pushState()).toBe('denied');
  });
});

describe('pushState without a service worker', () => {
  it('reports needs-install instead of hanging when no worker is registered', async () => {
    Object.defineProperty(window, 'PushManager', { value: function () {}, configurable: true });
    Object.defineProperty(window, 'Notification', { value: { permission: 'granted' }, configurable: true });
    Object.defineProperty(navigator, 'serviceWorker', {
      value: { getRegistration: async () => undefined },
      configurable: true,
    });
    Object.defineProperty(window, 'matchMedia', {
      value: () => ({ matches: false }),
      configurable: true,
    });
    expect(await pushState()).toBe('needs-install');
  });
});

describe('pushState ownership check (shared/kiosk device)', () => {
  it('reports "on" when the local subscription still belongs to the current user', async () => {
    mockGrantedWithSubscription();
    maybeSingleResult = { data: { endpoint: 'https://push.example/abc' } };
    expect(await pushState()).toBe('on');
  });

  it('reports "default", not stale "on", once another user on this device has taken over the endpoint', async () => {
    mockGrantedWithSubscription();
    // RLS scopes select to the caller's own rows, so a reassigned endpoint
    // simply returns no row rather than an error.
    maybeSingleResult = { data: null };
    expect(await pushState()).toBe('default');
  });
});

describe('disablePushForThisDevice', () => {
  it('deletes the row for this endpoint and unsubscribes the browser', async () => {
    const unsubscribe = vi.fn().mockResolvedValue(true);
    Object.defineProperty(navigator, 'serviceWorker', {
      value: {
        getRegistration: async () => ({
          pushManager: { getSubscription: async () => ({ endpoint: 'https://push.example/abc', unsubscribe }) },
        }),
      },
      configurable: true,
    });
    await disablePushForThisDevice();
    expect(deleteEq).toHaveBeenCalledWith('endpoint', 'https://push.example/abc');
    expect(unsubscribe).toHaveBeenCalled();
  });
});
