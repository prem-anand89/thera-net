// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, renderHook, waitFor } from '@testing-library/react';

const state = { isAdmin: true, revenueSplit: true, therapists: [{ active: true }, { active: true }] as { active: boolean }[] };

vi.mock('dexie-react-hooks', async () => {
  const { useEffect, useState } = await import('react');
  return {
    useLiveQuery: <T,>(query: () => Promise<T>) => {
      const [value, setValue] = useState<T | undefined>(undefined);
      useEffect(() => {
        void query().then(setValue);
      }, []); // eslint-disable-line react-hooks/exhaustive-deps
      return value;
    },
  };
});
vi.mock('@/app/clinicContext', () => ({ useClinic: () => ({ id: 'c1' }) }));
vi.mock('@/app/useWorkspaceScope', () => ({ useWorkspaceScope: () => ({ isAdmin: state.isAdmin }) }));
vi.mock('@/app/useEntitlements', () => ({ useEntitlements: () => ({ can: () => state.revenueSplit }) }));
vi.mock('@/services', () => ({ repos: { therapists: { list: async () => state.therapists } } }));

import { useShowTherapistComparison } from './useShowTherapistComparison';

beforeEach(() => {
  state.isAdmin = true;
  state.revenueSplit = true;
  state.therapists = [{ active: true }, { active: true }];
});
afterEach(cleanup);

describe('useShowTherapistComparison', () => {
  it('a Clinic-plan admin with two active therapists sees it, with no setting', async () => {
    const { result } = renderHook(() => useShowTherapistComparison());
    await waitFor(() => expect(result.current).toBe(true));
  });

  it('counts only active therapists', async () => {
    state.therapists = [{ active: true }, { active: false }];
    const { result } = renderHook(() => useShowTherapistComparison());
    await new Promise((r) => setTimeout(r, 30));
    expect(result.current).toBe(false);
  });

  it('a plan without the split, or a therapist login, does not', async () => {
    state.revenueSplit = false;
    const a = renderHook(() => useShowTherapistComparison());
    await new Promise((r) => setTimeout(r, 30));
    expect(a.result.current).toBe(false);
    state.revenueSplit = true;
    state.isAdmin = false;
    const b = renderHook(() => useShowTherapistComparison());
    await new Promise((r) => setTimeout(r, 30));
    expect(b.result.current).toBe(false);
  });
});
