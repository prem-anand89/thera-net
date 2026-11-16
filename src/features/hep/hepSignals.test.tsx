// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { act, cleanup, render, renderHook, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DesktopNav, filterNavItems } from '@/app/Shell';
import { MorePage } from '@/features/more/MorePage';
import { useHepPainDot } from './hepSignals';
import { notifyPainReviewed } from './useHomeProgramDot';

const listPainAlerts = vi.fn();
let perms = { canEditSettings: false, canUseExercises: true, isAdmin: false, role: 'therapist' };

vi.mock('@/services/hepService', async (orig) => ({
  ...(await orig<typeof import('@/services/hepService')>()),
  hepService: {
    listPainAlerts: (...a: unknown[]) => listPainAlerts(...a),
  },
}));
vi.mock('@/app/usePermissions', () => ({ usePermissions: () => perms }));
vi.mock('@/app/clinicContext', () => ({ useClinic: () => ({ id: 'c1', name: 'Sunrise', timezone: 'UTC' }) }));
vi.mock('@tanstack/react-router', () => ({
  Link: ({ children, to, activeProps: _activeProps, ...rest }: { children: React.ReactNode; to: string; activeProps?: unknown } & Record<string, unknown>) => (
    <a href={to} {...rest}>{children}</a>
  ),
}));

beforeEach(() => {
  listPainAlerts.mockReset().mockResolvedValue([]);
  perms = { canEditSettings: false, canUseExercises: true, isAdmin: false, role: 'therapist' };
  Object.defineProperty(navigator, 'onLine', { value: true, configurable: true });
});
afterEach(cleanup);

describe('useHepPainDot', () => {
  it('returns true when there is an unreviewed high-pain report, and clears when hep:pain-reviewed fires', async () => {
    listPainAlerts.mockResolvedValueOnce([
      { id: 'p1', status: 'active', painReviewedThrough: null, feedback: [{ painScore: 8, createdAt: '2026-11-15T10:00:00Z' }] },
    ]);
    const { result } = renderHook(() => useHepPainDot('c1', true));
    await waitFor(() => expect(result.current).toBe(true));
    expect(listPainAlerts).toHaveBeenCalledTimes(1);

    listPainAlerts.mockResolvedValueOnce([
      { id: 'p1', status: 'active', painReviewedThrough: '2026-11-15T11:00:00Z', feedback: [{ painScore: 8, createdAt: '2026-11-15T10:00:00Z' }] },
    ]);
    act(() => { notifyPainReviewed('pt-1'); });
    await waitFor(() => expect(result.current).toBe(false));
    expect(listPainAlerts).toHaveBeenCalledTimes(2);
  });

  it('skips querying when disabled, offline, or clinicId is missing, and fails silently on errors', async () => {
    const off = renderHook(() => useHepPainDot('c1', false));
    expect(off.result.current).toBe(false);
    expect(listPainAlerts).not.toHaveBeenCalled();

    Object.defineProperty(navigator, 'onLine', { value: false, configurable: true });
    const offline = renderHook(() => useHepPainDot('c1', true));
    expect(offline.result.current).toBe(false);
    expect(listPainAlerts).not.toHaveBeenCalled();

    Object.defineProperty(navigator, 'onLine', { value: true, configurable: true });
    listPainAlerts.mockRejectedValueOnce(new Error('network error'));
    const err = renderHook(() => useHepPainDot('c1', true));
    await waitFor(() => expect(listPainAlerts).toHaveBeenCalledTimes(1));
    expect(err.result.current).toBe(false);
  });
});

describe('HEP pain dot in main nav and MorePage', () => {
  it('shows the pain dot on the HEP item in DesktopNav only when hepPainDot is true', () => {
    const nav = filterNavItems('therapist');
    const { rerender } = render(<DesktopNav nav={nav} pathname="/workspace" pendingRequestsCount={0} hepPainDot={false} />);
    expect(screen.getByRole('link', { name: 'HEP' })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'HEP, pain report waiting' })).toBeNull();

    rerender(<DesktopNav nav={nav} pathname="/workspace" pendingRequestsCount={0} hepPainDot />);
    expect(screen.getByRole('link', { name: 'HEP, pain report waiting' })).toBeInTheDocument();
  });

  it('shows the pain dot on MorePage HEP entry when unreviewed high pain exists', async () => {
    listPainAlerts.mockResolvedValue([
      { id: 'p1', status: 'active', painReviewedThrough: null, feedback: [{ painScore: 7, createdAt: '2026-11-15T10:00:00Z' }] },
    ]);
    render(<MorePage />);
    const link = await screen.findByRole('link', { name: /HEP.*pain report waiting/ });
    expect(link).toHaveAttribute('href', '/hep');
  });
});
