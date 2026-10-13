// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { Therapist } from '@/domain/types';
import type { MySchedule } from '@/features/me/useMySchedule';

let myTherapist: Therapist | undefined;
let mySchedule: MySchedule | undefined = undefined;
vi.mock('@tanstack/react-router', () => ({
  Link: ({ children, to, ...rest }: { children: React.ReactNode; to: string }) => (
    <a href={to} {...rest}>{children}</a>
  ),
}));
vi.mock('./clinicContext', () => ({ useClinic: () => ({ id: 'c1', bookingStartHour: 9, bookingEndHour: 17 }) }));
vi.mock('@/features/me/useMyTherapist', () => ({ useMyTherapist: () => myTherapist }));
vi.mock('@/features/me/useMySchedule', () => ({ useMySchedule: () => mySchedule }));
vi.mock('@/features/setup/SetupProgressBar', () => ({ SetupProgressBar: () => null }));
vi.mock('@/features/notifications/useInstallState', () => ({
  useInstallState: () => ({ standalone: true, iosSafari: false, canPromptInstall: false, promptInstall: vi.fn() }),
}));
vi.mock('@/features/notifications/InstallPrompt', () => ({ InstallPrompt: () => null }));
vi.mock('@/features/me/MyAccountSheet', () => ({ MyAccountSheet: () => null }));
vi.mock('@/features/me/MyNotificationsSheet', () => ({ MyNotificationsSheet: () => null }));
vi.mock('@/components/schedule/ShiftRequestSheet', () => ({ ShiftRequestSheet: () => null }));
vi.mock('@/components/ChangePasswordDialog', () => ({ ChangePasswordDialog: () => null }));
vi.mock('@/components/HelpFeedbackDialog', () => ({ HelpFeedbackDialog: () => null }));
vi.mock('@/lib/supabase', () => ({ publicTherapistPhotoUrl: () => null }));
vi.mock('./signOut', () => ({ signOutSafely: vi.fn() }));

import { AccountMenu } from './AccountMenu';
import type { ClinicRole } from './useClinicRole';

function openMenu(role: ClinicRole) {
  render(
    <AccountMenu
      displayName="Ritu"
      fallbackName="ritu"
      role={role}
      setDisplayName={async () => {}}
      clinicId="c1"
      hasPasswordIdentity
    />
  );
  fireEvent.click(screen.getByRole('button', { name: 'Account' }));
}

afterEach(() => {
  cleanup();
  myTherapist = undefined;
  mySchedule = undefined;
  localStorage.clear();
});

describe('AccountMenu rows by role', () => {
  it('gives every role My account and Notifications, and only admins Settings', () => {
    openMenu('front_desk');
    expect(screen.getByRole('menuitem', { name: /my account/i })).toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: 'Notifications' })).toBeInTheDocument();
    expect(screen.queryByRole('menuitem', { name: 'Settings' })).not.toBeInTheDocument();
    expect(screen.queryByRole('menuitem', { name: 'My working hours' })).not.toBeInTheDocument();
  });

  it('shows Settings for an admin', () => {
    openMenu('admin');
    expect(screen.getByRole('menuitem', { name: 'Settings' })).toBeInTheDocument();
  });

  it('shows My working hours only for a linked therapist', () => {
    myTherapist = { id: 't1', clinicId: 'c1', name: 'Ritu', active: true, userId: 'u1', updatedAt: '' };
    openMenu('therapist');
    expect(screen.getByRole('menuitem', { name: /my working hours/i })).toBeInTheDocument();
    expect(screen.queryByRole('menuitem', { name: 'Settings' })).not.toBeInTheDocument();
  });
});

describe('My working hours subtitle and dot', () => {
  it('renders subtitle from schedule summary', () => {
    myTherapist = { id: 't1', clinicId: 'c1', name: 'Ritu', active: true, userId: 'u1', updatedAt: '' };
    mySchedule = {
      headline: 'General Shift (Mon–Fri)',
      summary: 'Mon–Fri 9–5',
      weekList: [],
      pending: null,
      declined: null,
      lastChange: null,
    };
    openMenu('therapist');
    expect(screen.getByText('Mon–Fri 9–5')).toBeInTheDocument();
    expect(screen.queryByTestId('hours-updated-dot')).not.toBeInTheDocument();
  });

  it('renders "Request pending" as subtitle when a pending request exists', () => {
    myTherapist = { id: 't1', clinicId: 'c1', name: 'Ritu', active: true, userId: 'u1', updatedAt: '' };
    mySchedule = {
      headline: 'General Shift (Mon–Fri)',
      summary: 'Mon–Fri 9–5',
      weekList: [],
      pending: { id: 'p1', title: 'Morning Shift', sentAt: '2026-10-12' },
      declined: null,
      lastChange: null,
    };
    openMenu('therapist');
    expect(screen.getByText('Request pending')).toBeInTheDocument();
  });

  it('shows Updated dot when lastChange is newer than seen timestamp, and clears upon opening', () => {
    myTherapist = { id: 't1', clinicId: 'c1', name: 'Ritu', active: true, userId: 'u1', updatedAt: '' };
    mySchedule = {
      headline: 'General Shift (Mon–Fri)',
      summary: 'Mon–Fri 9–5',
      weekList: [],
      pending: null,
      declined: null,
      lastChange: { at: '2026-10-13T10:00:00Z', text: 'Changed by your clinic admin on 13 Oct 2026' },
    };
    localStorage.setItem('myHoursSeen:t1', '2026-10-10T00:00:00Z');
    openMenu('therapist');
    expect(screen.getByTestId('hours-updated-dot')).toBeInTheDocument();

    // Click "My working hours" to open sheet
    fireEvent.click(screen.getByRole('menuitem', { name: /my working hours/i }));
    expect(localStorage.getItem('myHoursSeen:t1')).toBe('2026-10-13T10:00:00Z');
  });

  it('renders without error when localStorage throws', () => {
    myTherapist = { id: 't1', clinicId: 'c1', name: 'Ritu', active: true, userId: 'u1', updatedAt: '' };
    mySchedule = {
      headline: 'General Shift (Mon–Fri)',
      summary: 'Mon–Fri 9–5',
      weekList: [],
      pending: null,
      declined: null,
      lastChange: { at: '2026-10-13T10:00:00Z', text: 'Changed by your clinic admin on 13 Oct 2026' },
    };
    const getItemSpy = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('SecurityError: localStorage is disabled');
    });
    const setItemSpy = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('QuotaExceededError');
    });

    openMenu('therapist');
    expect(screen.getByRole('menuitem', { name: /my working hours/i })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('menuitem', { name: /my working hours/i }));

    getItemSpy.mockRestore();
    setItemSpy.mockRestore();
  });
});

describe('Refresh app', () => {
  it('reloads the page when clicked', async () => {
    const reload = vi.fn();
    vi.stubGlobal('location', { ...window.location, reload });
    openMenu('admin');
    fireEvent.click(screen.getByRole('button', { name: 'Refresh app' }));
    await vi.waitFor(() => expect(reload).toHaveBeenCalled());
    vi.unstubAllGlobals();
  });
});
