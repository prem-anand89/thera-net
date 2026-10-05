import { useState } from 'react';
import { Link } from '@tanstack/react-router';
import { signOutSafely } from './signOut';
import { CLINIC_ROLE_LABELS, type ClinicRole } from './useClinicRole';
import { ChangePasswordDialog } from '@/components/ChangePasswordDialog';
import { WorkingHoursSheet } from '@/components/schedule/WorkingHoursSheet';
import { InstallPrompt } from '@/features/notifications/InstallPrompt';
import { useInstallState } from '@/features/notifications/useInstallState';
import { MyAccountSheet } from '@/features/me/MyAccountSheet';
import { MyNotificationsSheet } from '@/features/me/MyNotificationsSheet';
import { useMyTherapist } from '@/features/me/useMyTherapist';
import { useClinic } from './clinicContext';
import { bookingService } from '@/services';
import { publicTherapistPhotoUrl } from '@/lib/supabase';
import { HelpFeedbackDialog } from '@/components/HelpFeedbackDialog';
import { IconBell, IconCalendar, IconSettings } from '@/components/NavIcons';
import { SetupProgressBar } from '@/features/setup/SetupProgressBar';
import { BrandMark } from '@/components/BrandMark';
import { initialsFor } from './accountInitials';

const rowCls =
  'flex min-h-11 w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-sm text-[var(--ink)] hover:bg-[var(--paper)]';
const rowIcon = 'h-4 w-4 shrink-0 text-[var(--muted)]';

function Avatar({ name, photoUrl, size }: { name: string; photoUrl: string | null; size: 'sm' | 'lg' }) {
  const dims = size === 'lg' ? 'h-10 w-10 text-sm' : 'h-8 w-8 text-xs';
  if (photoUrl) {
    return <img src={photoUrl} alt="" className={`${dims} shrink-0 rounded-full border border-[var(--border)] object-cover`} />;
  }
  return (
    <span
      aria-hidden="true"
      className={`${dims} flex shrink-0 items-center justify-center rounded-full bg-[var(--teal)] font-semibold text-white`}
    >
      {initialsFor(name)}
    </span>
  );
}

/**
 * The one account-corner menu. Everything about *you* lives here, for every
 * role — My account (profile + security), working hours (a linked
 * therapist), notifications, install — while Settings stays clinic-wide and
 * admin-only. A bottom sheet on phones, a dropdown from `sm:` up. Switching
 * or adding clinics lives in the header's clinic pill (`ClinicSwitcher`).
 */
export function AccountMenu({
  active = false,
  displayName,
  fallbackName,
  role,
  setDisplayName,
  clinicId,
  hasPasswordIdentity,
}: {
  /** True on Settings/Setup, which are reached from this menu on larger screens. */
  active?: boolean;
  displayName: string | null;
  fallbackName: string;
  role: ClinicRole;
  setDisplayName: (name: string) => Promise<void>;
  clinicId: string;
  /** False for a Google-only account with no email/password identity yet —
   *  relabels the password action from "Change" to "Set". */
  hasPasswordIdentity: boolean;
}) {
  const clinic = useClinic();
  const [open, setOpen] = useState(false);
  const [accountOpen, setAccountOpen] = useState(false);
  const [notificationsOpen, setNotificationsOpen] = useState(false);
  const [hoursOpen, setHoursOpen] = useState(false);
  const [changingPassword, setChangingPassword] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const name = displayName ?? fallbackName;
  const roleLabel = role !== 'unknown' ? CLINIC_ROLE_LABELS[role] : '';
  const myTherapist = useMyTherapist(clinicId);
  const photoUrl = myTherapist?.photoPath ? publicTherapistPhotoUrl(myTherapist.photoPath) : null;
  const install = useInstallState();
  const showInstall = !install.standalone && (install.canPromptInstall || install.iosSafari);

  function closeMenu() {
    setOpen(false);
  }
  function openSheet(set: (value: boolean) => void) {
    closeMenu();
    set(true);
  }

  return (
    <div className="relative">
      <button
        type="button"
        className={`flex items-center gap-2 rounded-full p-0.5 hover:bg-[var(--paper)] sm:rounded-md sm:px-1.5 sm:py-1 ${
          active ? 'sm:bg-[var(--teal-light)] sm:ring-1 sm:ring-[var(--teal)]/40' : ''
        }`}
        aria-label="Account"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
      >
        <Avatar name={name} photoUrl={photoUrl} size="sm" />
        <span className="hidden max-w-[9rem] truncate text-xs font-medium text-[var(--ink)] desktop:inline">
          {name}
        </span>
      </button>

      {open && (
        <>
          <div className="fixed inset-0 z-10 bg-[var(--ink)]/30 sm:bg-transparent" onClick={closeMenu} />
          <div
            role="menu"
            className="fixed inset-x-0 bottom-0 z-20 max-h-[85vh] overflow-y-auto rounded-t-[20px] border border-[var(--border)] bg-[var(--surface)] pb-[env(safe-area-inset-bottom)] shadow-lg sm:absolute sm:inset-x-auto sm:bottom-auto sm:right-0 sm:top-full sm:mt-2 sm:max-h-none sm:w-72 sm:overflow-hidden sm:rounded-xl sm:pb-0"
          >
            <div className="bg-[var(--paper)] px-3 py-3">
              <div className="flex items-center gap-2.5">
                <Avatar name={name} photoUrl={photoUrl} size="lg" />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-[var(--ink)]">{name}</p>
                  {roleLabel && <p className="text-xs text-[var(--muted)]">{roleLabel}</p>}
                </div>
              </div>
              {role === 'admin' && (
                <div className="mt-2.5" onClick={closeMenu}>
                  <SetupProgressBar clinicId={clinicId} />
                </div>
              )}
            </div>

            <div className="border-t border-[var(--border)] px-2 py-2">
              <button type="button" role="menuitem" className={rowCls} onClick={() => openSheet(setAccountOpen)}>
                <span className="min-w-0 flex-1">
                  <span className="block">My account</span>
                  <span className="block text-xs text-[var(--muted)]">Profile, password</span>
                </span>
              </button>
              {myTherapist && (
                <button type="button" role="menuitem" className={rowCls} onClick={() => openSheet(setHoursOpen)}>
                  <IconCalendar className={rowIcon} />
                  My working hours
                </button>
              )}
              <button type="button" role="menuitem" className={rowCls} onClick={() => openSheet(setNotificationsOpen)}>
                <IconBell className={rowIcon} />
                Notifications
              </button>
              {role === 'admin' && (
                <Link to="/settings" role="menuitem" onClick={closeMenu} className={rowCls}>
                  <IconSettings className={rowIcon} />
                  Settings
                </Link>
              )}
            </div>

            <div className="border-t border-[var(--border)] px-2 py-2">
              {showInstall && (
                <div className="px-2.5 py-1.5">
                  <InstallPrompt />
                </div>
              )}
              <button type="button" role="menuitem" className={rowCls} onClick={() => openSheet(setHelpOpen)}>
                Help &amp; feedback
              </button>
            </div>

            <div className="border-t border-[var(--border)] bg-[var(--paper)] px-2 py-2">
              <button
                type="button"
                role="menuitem"
                className="flex min-h-11 w-full items-center rounded-lg px-2.5 py-2 text-left text-sm font-medium text-[var(--rust)] hover:bg-[var(--rust-light)]"
                onClick={() => void signOutSafely()}
              >
                Sign out
              </button>
            </div>
            <div className="flex items-center justify-center gap-1.5 border-t border-[var(--border)] px-3 py-2 text-[11px] text-[var(--muted)]">
              <BrandMark size={14} decorative />
              <span>Thera.Net v{__APP_VERSION__}</span>
            </div>
          </div>
        </>
      )}

      <MyAccountSheet
        open={accountOpen}
        onClose={() => setAccountOpen(false)}
        clinicId={clinicId}
        displayName={displayName}
        fallbackName={fallbackName}
        setDisplayName={setDisplayName}
        therapist={myTherapist}
        hasPasswordIdentity={hasPasswordIdentity}
        onChangePassword={() => {
          setAccountOpen(false);
          setChangingPassword(true);
        }}
      />
      <MyNotificationsSheet
        open={notificationsOpen}
        onClose={() => setNotificationsOpen(false)}
        role={role}
        therapist={myTherapist}
      />
      {myTherapist && (
        <WorkingHoursSheet
          open={hoursOpen}
          therapistName={myTherapist.name}
          value={myTherapist.workingHours}
          clinic={{
            startHour: clinic.bookingStartHour ?? 9,
            endHour: clinic.bookingEndHour ?? 17,
            closedWeekdays: clinic.closedWeekdays,
          }}
          onSave={(hours) => bookingService.setWorkingHours(myTherapist.id, hours)}
          onClose={() => setHoursOpen(false)}
        />
      )}
      {changingPassword && (
        <ChangePasswordDialog
          isFirstPassword={!hasPasswordIdentity}
          onClose={() => setChangingPassword(false)}
        />
      )}
      <HelpFeedbackDialog isOpen={helpOpen} onClose={() => setHelpOpen(false)} />
    </div>
  );
}
