// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { renderHook, waitFor, cleanup, act } from '@testing-library/react';
import { useState, useEffect } from 'react';
import type { ClinicPlan } from '@/domain/types';

const metaStore = new Map<string, { key: string; value: string }>();
const listeners = new Set<() => void>();

vi.mock('@/lib/db', () => ({
  db: {
    meta: {
      get: vi.fn(async (key: string) => metaStore.get(key)),
      put: vi.fn(async (entry: { key: string; value: string }) => {
        metaStore.set(entry.key, entry);
        listeners.forEach((l) => l());
      }),
      clear: vi.fn(async () => {
        metaStore.clear();
        listeners.forEach((l) => l());
      }),
    },
  },
}));

vi.mock('dexie-react-hooks', () => ({
  useLiveQuery: <T,>(fn: () => Promise<T> | T): T | undefined => {
    const [val, setVal] = useState<T | undefined>(undefined);
    useEffect(() => {
      let active = true;
      const run = () => {
        Promise.resolve(fn())
          .then((res) => {
            if (active) setVal(res);
          })
          .catch(() => {});
      };
      run();
      listeners.add(run);
      return () => {
        active = false;
        listeners.delete(run);
      };
    }, []); // eslint-disable-line react-hooks/exhaustive-deps
    return val;
  },
}));

vi.mock('./useSession', () => ({
  useSession: () => ({ session: { user: { id: 'u1' } } }),
}));

vi.mock('@/repositories/local', () => ({
  repos: {
    visits: {
      list: vi.fn().mockResolvedValue([]),
    },
  },
}));

let mockSupabasePlanRow: Record<string, unknown> | null = null;
let mockSupabaseError: Error | null = null;
const channelSpy = vi.fn();

vi.mock('@/lib/supabase', () => ({
  getSupabase: () => ({
    channel: channelSpy,
    from: (table: string) => {
      if (table === 'clinic_plans') {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: async () => {
                if (mockSupabaseError) throw mockSupabaseError;
                return { data: mockSupabasePlanRow, error: null };
              },
            }),
          }),
        };
      }
      if (table === 'clinic_members') {
        return {
          select: () => ({
            eq: async () => ({ count: 1, error: null }),
          }),
        };
      }
      if (table === 'platform_config') {
        return {
          select: () => ({
            maybeSingle: async () => ({
              data: { tier_enforcement_enabled: true },
              error: null,
            }),
          }),
        };
      }
      return {};
    },
  }),
}));

import { useEntitlements } from './useEntitlements';
import { db } from '@/lib/db';

describe('useEntitlements', () => {
  beforeEach(() => {
    metaStore.clear();
    listeners.clear();
    mockSupabasePlanRow = null;
    mockSupabaseError = null;
    channelSpy.mockClear();
  });

  afterEach(() => {
    cleanup();
  });

  it('the hook never calls supabase.channel', async () => {
    mockSupabasePlanRow = {
      clinic_id: 'c1',
      plan_tier: 'solo',
      status: 'active',
      max_members: 1,
      visit_cap_per_month: 200,
    };

    const { result } = renderHook(() => useEntitlements('c1'));
    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(channelSpy).not.toHaveBeenCalled();
  });

  it('renders with the fetched plan, then a newer cached plan arriving in db.meta changes tier', async () => {
    mockSupabasePlanRow = {
      clinic_id: 'c1',
      plan_tier: 'solo',
      status: 'active',
      max_members: 1,
      visit_cap_per_month: 200,
    };

    const { result } = renderHook(() => useEntitlements('c1'));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.tier).toBe('solo');

    // Newer cached plan arrives in db.meta (e.g. from sync engine realtime event)
    const updatedPlan: ClinicPlan = {
      clinicId: 'c1',
      planTier: 'clinic_plus',
      status: 'active',
      maxMembers: 10,
      visitCapPerMonth: null,
      maxRosterTherapists: 10,
      updatedAt: new Date().toISOString(),
    };

    await act(async () => {
      await db.meta.put({
        key: 'plan:c1',
        value: JSON.stringify(updatedPlan),
      });
    });

    await waitFor(() => expect(result.current.tier).toBe('clinic_plus'));
    expect(result.current.maxMembers).toBe(10);
  });

  it('with a failed fetch and a cached plan, tier is the cached one; with neither, it is fail-closed lite', async () => {
    // 1. With neither
    mockSupabaseError = new Error('Network failure');
    const { result: failResult } = renderHook(() => useEntitlements('c1'));
    await waitFor(() => expect(failResult.current.loading).toBe(false));
    expect(failResult.current.tier).toBe('lite');
    cleanup();

    // 2. With cached plan and failed fetch
    const cachedPlan: ClinicPlan = {
      clinicId: 'c2',
      planTier: 'clinic',
      status: 'active',
      maxMembers: 5,
      visitCapPerMonth: null,
      maxRosterTherapists: 3,
      updatedAt: new Date().toISOString(),
    };
    metaStore.set('plan:c2', {
      key: 'plan:c2',
      value: JSON.stringify(cachedPlan),
    });

    mockSupabaseError = new Error('Network failure');
    const { result: cachedResult } = renderHook(() => useEntitlements('c2'));
    await waitFor(() => expect(cachedResult.current.loading).toBe(false));
    expect(cachedResult.current.tier).toBe('clinic');
  });
});

