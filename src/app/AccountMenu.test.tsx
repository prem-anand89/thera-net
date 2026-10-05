// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { Therapist } from '@/domain/types';

let myTherapist: Therapist | undefined;
vi.mock('@tanstack/react-router', () => ({
  Link: ({ children, to, ...rest }: { children: React.ReactNode; to: string }) => (
    <a href={to} {...rest}>{children}</a>
  ),
}));
vi.mock('./clinicContext', () => ({ useClinic: () => ({ id: 'c1', bookingStartHour: 9, bookingEndHour: 17 }) }));
vi.mock('@/features/me/useMyTherapist', () => ({ useMyTherapist: () => myTherapist }));
vi.mock('@/features/settings/FirstWeekChecklist', () => ({ useFirstWeekChecklistSummary: () => undefined }));
vi.mock('@/features/notifications/useInstallState', () => ({
  useInstallState: () => ({ standalone: true, iosSafari: false, canPromptInstall: false, promptInstall: vi.fn() }),
}));
vi.mock('@/features/notifications/InstallPrompt', () => ({ InstallPrompt: () => null }));
vi.mock('@/features/me/MyAccountSheet', () => ({ MyAccountSheet: () => null }));
vi.mock('@/features/me/MyNotificationsSheet', () => ({ MyNotificationsSheet: () => null }));
vi.mock('@/components/schedule/WorkingHoursSheet', () => ({ WorkingHoursSheet: () => null }));
vi.mock('@/components/ChangePasswordDialog', () => ({ ChangePasswordDialog: () => null }));
vi.mock('@/components/HelpFeedbackDialog', () => ({ HelpFeedbackDialog: () => null }));
vi.mock('@/services', () => ({ bookingService: { setWorkingHours: vi.fn() } }));
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
    expect(screen.getByRole('menuitem', { name: 'My working hours' })).toBeInTheDocument();
    expect(screen.queryByRole('menuitem', { name: 'Settings' })).not.toBeInTheDocument();
  });
});
