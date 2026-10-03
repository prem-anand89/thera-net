// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';

const deleteEq = vi.fn().mockResolvedValue({ error: null });
vi.mock('@/lib/supabase', () => ({
  getSupabase: () => ({ from: () => ({ delete: () => ({ eq: deleteEq }) }) }),
}));

import { disablePushForThisDevice, pushState } from './pushSubscription';

afterEach(() => {
  vi.restoreAllMocks();
  deleteEq.mockClear();
});

describe('pushState', () => {
  it('reports unsupported when PushManager is missing', async () => {
    Object.defineProperty(window, 'PushManager', { value: undefined, configurable: true });
    expect(await pushState()).toBe('unsupported');
  });

  it('reports denied when the browser has denied permission', async () => {
    Object.defineProperty(window, 'PushManager', { value: function () {}, configurable: true });
    Object.defineProperty(window, 'Notification', { value: { permission: 'denied' }, configurable: true });
    Object.defineProperty(navigator, 'serviceWorker', { value: {}, configurable: true });
    expect(await pushState()).toBe('denied');
  });
});

describe('disablePushForThisDevice', () => {
  it('deletes the row for this endpoint and unsubscribes the browser', async () => {
    const unsubscribe = vi.fn().mockResolvedValue(true);
    Object.defineProperty(navigator, 'serviceWorker', {
      value: {
        ready: Promise.resolve({
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
