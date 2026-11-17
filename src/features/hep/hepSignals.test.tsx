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

  it('keeps the last known dot state when a background refresh fails temporarily', async () => {
    vi.useFakeTimers();
    try {
      listPainAlerts.mockResolvedValueOnce([
        { id: 'p1', status: 'active', painReviewedThrough: null, feedback: [{ painScore: 8, createdAt: '2026-11-15T10:00:00Z' }] },
      ]);
      const { result, unmount } = renderHook(() => useHepPainDot('c1', true));
      await act(async () => { await Promise.resolve(); });
      expect(result.current).toBe(true);

      listPainAlerts.mockRejectedValueOnce(new Error('blip'));
      await act(async () => {
        await vi.advanceTimersByTimeAsync(5 * 60_000);
        await Promise.resolve();
      });
      expect(listPainAlerts).toHaveBeenCalledTimes(2);
      expect(result.current).toBe(true);
      unmount();
    } finally {
      vi.useRealTimers();
    }
  });
  it('shares a single query across multiple callers (e.g. Shell + MorePage)', async () => {
    listPainAlerts.mockResolvedValue([
      { id: 'p1', status: 'active', painReviewedThrough: null, feedback: [{ painScore: 8, createdAt: '2026-11-15T10:00:00Z' }] },
    ]);
    const shell = renderHook(() => useHepPainDot('c1', true));
    render(<MorePage />);

    await waitFor(() => expect(shell.result.current).toBe(true));
    expect(screen.getByRole('link', { name: /HEP.*pain report waiting/ })).toBeInTheDocument();
    expect(listPainAlerts).toHaveBeenCalledTimes(1);

    listPainAlerts.mockResolvedValue([]);
    act(() => { notifyPainReviewed('pt-1'); });
    await waitFor(() => expect(shell.result.current).toBe(false));
    expect(listPainAlerts).toHaveBeenCalledTimes(2);
    expect(screen.queryByRole('link', { name: /pain report waiting/ })).toBeNull();
  });

  it('re-checks on focus/visibility (throttled to 60s) and polls every 5 minutes while visible and online', async () => {
    vi.useFakeTimers();
    try {
      let visibility: DocumentVisibilityState = 'visible';
      Object.defineProperty(document, 'visibilityState', {
        configurable: true,
        get: () => visibility,
      });

      listPainAlerts.mockResolvedValue([]);
      const { result, unmount } = renderHook(() => useHepPainDot('c1', true));
      await act(async () => { await Promise.resolve(); });
      expect(listPainAlerts).toHaveBeenCalledTimes(1);
      expect(result.current).toBe(false);

      // Focus within 60s is throttled
      await act(async () => {
        await vi.advanceTimersByTimeAsync(30_000);
        window.dispatchEvent(new Event('focus'));
        await Promise.resolve();
      });
      expect(listPainAlerts).toHaveBeenCalledTimes(1);

      // After 60s total, focus refreshes cleanly
      listPainAlerts.mockResolvedValueOnce([
        { id: 'p1', status: 'active', painReviewedThrough: null, feedback: [{ painScore: 9, createdAt: '2026-11-15T10:00:00Z' }] },
      ]);
      await act(async () => {
        await vi.advanceTimersByTimeAsync(30_000);
        window.dispatchEvent(new Event('focus'));
        await Promise.resolve();
      });
      expect(listPainAlerts).toHaveBeenCalledTimes(2);
      expect(result.current).toBe(true);

      // visibilitychange to visible is throttled within 60s, allowed after 60s
      await act(async () => {
        visibility = 'hidden';
        document.dispatchEvent(new Event('visibilitychange'));
        await vi.advanceTimersByTimeAsync(60_000);
        visibility = 'visible';
        listPainAlerts.mockResolvedValueOnce([]);
        document.dispatchEvent(new Event('visibilitychange'));
        await Promise.resolve();
      });
      expect(listPainAlerts).toHaveBeenCalledTimes(3);
      expect(result.current).toBe(false);

      // 5-minute poll skips when hidden
      await act(async () => {
        visibility = 'hidden';
        await vi.advanceTimersByTimeAsync(5 * 60_000);
        await Promise.resolve();
      });
      expect(listPainAlerts).toHaveBeenCalledTimes(3);

      // 5-minute poll runs when visible + online
      listPainAlerts.mockResolvedValueOnce([
        { id: 'p1', status: 'active', painReviewedThrough: null, feedback: [{ painScore: 8, createdAt: '2026-11-15T10:00:00Z' }] },
      ]);
      await act(async () => {
        visibility = 'visible';
        await vi.advanceTimersByTimeAsync(5 * 60_000);
        await Promise.resolve();
      });
      expect(listPainAlerts).toHaveBeenCalledTimes(4);
      expect(result.current).toBe(true);

      unmount();
    } finally {
      Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' });
      vi.useRealTimers();
    }
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

  it('shows HEP as Coming soon (disabled) in DesktopNav when hepComingSoon is true', () => {
    const nav = filterNavItems('therapist');
    render(<DesktopNav nav={nav} pathname="/workspace" pendingRequestsCount={0} hepPainDot={false} hepComingSoon />);
    expect(screen.queryByRole('link', { name: /HEP/ })).toBeNull();
    const disabled = screen.getByLabelText('HEP (Coming soon)');
    expect(disabled).toHaveAttribute('aria-disabled', 'true');
    expect(screen.getByText('Coming soon')).toBeInTheDocument();
  });

  it('shows HEP as Coming soon in MorePage for clinical staff when gated off, and hides it for front desk', () => {
    perms = { canEditSettings: false, canUseExercises: false, isAdmin: false, role: 'therapist' };
    const { rerender } = render(<MorePage />);
    expect(screen.queryByRole('link', { name: /HEP/ })).toBeNull();
    expect(screen.getByText('HEP')).toBeInTheDocument();
    expect(screen.getByText('Coming soon')).toBeInTheDocument();

    perms = { canEditSettings: false, canUseExercises: false, isAdmin: false, role: 'front_desk' };
    rerender(<MorePage />);
    expect(screen.queryByText('HEP')).toBeNull();
    expect(screen.queryByText('Coming soon')).toBeNull();
  });
});
