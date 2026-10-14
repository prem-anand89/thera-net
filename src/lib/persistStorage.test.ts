import { afterEach, describe, expect, it, vi } from 'vitest';
import { requestPersistentStorage } from './persistStorage';

function stubStorage(storage: unknown) {
  vi.stubGlobal('navigator', { storage });
}

describe('requestPersistentStorage', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('requests persistence when not yet persisted', async () => {
    const persist = vi.fn().mockResolvedValue(true);
    stubStorage({ persisted: async () => false, persist });
    expect(await requestPersistentStorage()).toBe(true);
    expect(persist).toHaveBeenCalledTimes(1);
  });

  it('does not ask again when already persisted', async () => {
    const persist = vi.fn();
    stubStorage({ persisted: async () => true, persist });
    expect(await requestPersistentStorage()).toBe(true);
    expect(persist).not.toHaveBeenCalled();
  });

  it('returns false when unsupported or when it throws', async () => {
    stubStorage(undefined);
    expect(await requestPersistentStorage()).toBe(false);
    stubStorage({ persisted: async () => false, persist: async () => { throw new Error('denied'); } });
    expect(await requestPersistentStorage()).toBe(false);
  });
});
