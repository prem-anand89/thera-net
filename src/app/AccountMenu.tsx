import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from '@tanstack/react-router';
import { signOutSafely } from './signOut';
import { checkForUpdateAndReload } from './registerServiceWorker';
import { CLINIC_ROLE_LABELS, type ClinicRole } from './useClinicRole';
import { setActiveClinic } from '@/app/useActiveClinic';
import { syncEngine } from '@/sync/engine';
import { ChangePasswordDialog } from '@/components/ChangePasswordDialog';
import { ShiftRequestSheet } from '@/components/schedule/ShiftRequestSheet';
import { InstallPrompt } from '@/features/notifications/InstallPrompt';
import { useInstallState } from '@/features/notifications/useInstallState';
import { MyAccountSheet } from '@/features/me/MyAccountSheet';
import { MyNotificationsSheet } from '@/features/me/MyNotificationsSheet';
import { useMyTherapist } from '@/features/me/useMyTherapist';
import { useMySchedule } from '@/features/me/useMySchedule';
import { useClinic } from './clinicContext';
import { publicTherapistPhotoUrl } from '@/lib/supabase';
import { HelpFeedbackDialog } from '@/components/HelpFeedbackDialog';
import { IconBell, IconCalendar, IconSettings, IconUser } from '@/components/NavIcons';
import { SetupProgressBar } from '@/features/setup/SetupProgressBar';
import { BrandMark } from '@/components/BrandMark';
import { AddClinicDialog } from '@/components/AddClinicDialog';
import { initialsFor } from './accountInitials';
import type { Clinic } from '@/domain/types';

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

function ClinicAvatar({ name, logoUrl }: { name: string; logoUrl: string | null | undefined }) {
  if (logoUrl) {
    return (
      <span className="flex h-5 w-5 shrink-0 items-center justify-center overflow-hidden rounded-full border border-[var(--border)] bg-white">
        <img src={logoUrl} alt="" className="h-full w-full object-contain p-0.5" />
      </span>
    );
  }
  return (
    <span
      aria-hidden
      className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-[var(--ink)] text-[10px] font-semibold text-white"
    >
      {name.trim().charAt(0).toUpperCase() || '?'}
    </span>
  );
}

/**
 * The unified account and clinic hub. Houses personal profile, working hours,
 * notifications, and clinic settings & switching for admins and multi-clinic staff.
 */
export function AccountMenu({
  active = false,
  displayName,
  fallbackName,
  role,
  setDisplayName,
  clinicId,
  clinics = [],
  logoUrl,
  hasPasswordIdentity,
}: {
  /** True on Settings/Setup, which are reached from this menu on larger screens. */
  active?: boolean;
  displayName: string | null;
  fallbackName: string;
  role: ClinicRole;
  setDisplayName: (name: string) => Promise<void>;
  clinicId: string;
  clinics?: Clinic[];
  logoUrl?: string | null;
  /** False for a Google-only account with no email/password identity yet —
   *  relabels the password action from "Change" to "Set". */
  hasPasswordIdentity: boolean;
}) {
  const clinic = useClinic();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [accountOpen, setAccountOpen] = useState(false);
  const [notificationsOpen, setNotificationsOpen] = useState(false);
  const [hoursOpen, setHoursOpen] = useState(false);
  const [changingPassword, setChangingPassword] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const [addingClinic, setAddingClinic] = useState(false);

  const name = displayName ?? fallbackName;
  const roleLabel = role !== 'unknown' ? CLINIC_ROLE_LABELS[role] : '';
  const myTherapist = useMyTherapist(clinicId);
  const mySchedule = useMySchedule(
    myTherapist?.id ?? '',
    clinicId,
    myTherapist?.workingHours ?? null
  );
  const photoUrl = myTherapist?.photoPath ? publicTherapistPhotoUrl(myTherapist.photoPath) : null;
  const install = useInstallState();
  const showInstall = !install.standalone && (install.canPromptInstall || install.iosSafari);

  const sortedClinics = useMemo(() => {
    return [...clinics].sort((a, b) => a.name.localeCompare(b.name));
  }, [clinics]);

  const [seenAt, setSeenAt] = useState<string | null>(null);
  const myTherapistId = myTherapist?.id;
  useEffect(() => {
    if (!myTherapistId) return;
    try {
      setSeenAt(localStorage.getItem(`myHoursSeen:${myTherapistId}`));
    } catch {
      setSeenAt(null);
    }
  }, [myTherapistId]);

  const lastChangeAt = mySchedule?.lastChange?.at ?? null;
  const hasUpdatedDot = Boolean(lastChangeAt && (!seenAt || seenAt < lastChangeAt));
  const hoursSubtitle = mySchedule?.pending ? 'Request pending' : mySchedule?.summary ?? null;

  function closeMenu() {
    setOpen(false);
  }
  function openSheet(set: (value: boolean) => void) {
    closeMenu();
    set(true);
  }
  function openHoursSheet() {
    if (myTherapist && lastChangeAt) {
      try {
        localStorage.setItem(`myHoursSeen:${myTherapist.id}`, lastChangeAt);
      } catch {
        // ignore storage unavailable
      }
      setSeenAt(lastChangeAt);
    }
    openSheet(setHoursOpen);
  }

  async function switchToClinic(id: string) {
    closeMenu();
    if (id === clinic.id) return;
    await setActiveClinic(id);
    void navigate({ to: '/workspace' });
  }

  async function refreshApp() {
    await checkForUpdateAndReload();
  }

  return (
    <div className="relative">
      <button
        type="button"
        className={`flex items-center gap-2 rounded-full p-0.5 hover:bg-[var(--paper)] sm:rounded-md sm:px-1.5 sm:py-1 ${active ? 'sm:bg-[var(--teal-light)] sm:ring-1 sm:ring-[var(--teal)]/40' : ''
          }`}
        aria-label="Account"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
      >
        <Avatar name={name} photoUrl={photoUrl} size="sm" />
        <div className="hidden max-w-[9rem] text-left desktop:block">
          <span className="block truncate text-xs font-semibold text-[var(--ink)]">
            {name}
          </span>
          <span className="block truncate text-[10px] text-[var(--muted)]">
            {clinic.name}
          </span>
        </div>
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

              {/* Active clinic badge */}
              <div className="mt-2.5 flex items-center gap-1.5 rounded-lg border border-[var(--border)] bg-[var(--surface)] px-2.5 py-1.5 text-xs text-[var(--ink)]">
                <ClinicAvatar name={clinic.name} logoUrl={logoUrl} />
                <span className="truncate font-medium">{clinic.name}</span>
              </div>

              {role === 'admin' && (
                <div className="mt-2.5" onClick={closeMenu}>
                  <SetupProgressBar clinicId={clinicId} />
                </div>
              )}
            </div>

            {/* Clinic administration & switching */}
            {(role === 'admin' || clinics.length > 1) && (
              <div className="border-t border-[var(--border)] px-2 py-2">
                {role === 'admin' && (
                  <Link
                    to="/settings"
                    role="menuitem"
                    className={rowCls}
                    onClick={closeMenu}
                  >
                    <IconSettings className={rowIcon} />
                    <span className="min-w-0 flex-1 text-left">
                      <span className="block font-medium leading-tight">Clinic settings</span>
                      <span className="mt-0.5 block text-xs text-[var(--muted)]">
                        Profile, places, team, billing
                      </span>
                    </span>
                  </Link>
                )}

                {clinics.length > 1 && (
                  <div className="mt-1 pt-1 border-t border-[var(--border)]">
                    <p className="px-2.5 pb-1 pt-1 text-[10px] font-semibold uppercase tracking-wide text-[var(--muted)]">
                      Switch clinic
                    </p>
                    {sortedClinics.map((c) => (
                      <button
                        key={c.id}
                        type="button"
                        role="menuitemradio"
                        aria-checked={c.id === clinic.id}
                        onClick={() => void switchToClinic(c.id)}
                        className={`flex min-h-9 w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-sm ${c.id === clinic.id
                            ? 'bg-[var(--teal-light)] font-semibold text-[var(--teal-strong)]'
                            : 'text-[var(--ink)] hover:bg-[var(--paper)]'
                          }`}
                      >
                        <span className="w-4 shrink-0 text-xs" aria-hidden>
                          {c.id === clinic.id ? '✓' : ''}
                        </span>
                        <span className="truncate">{c.name}</span>
                      </button>
                    ))}
                  </div>
                )}

                {role === 'admin' && (
                  <button
                    type="button"
                    role="menuitem"
                    className={rowCls}
                    onClick={() => {
                      closeMenu();
                      setAddingClinic(true);
                    }}
                  >
                    <span className="w-4 shrink-0 text-center font-bold text-[var(--teal)]" aria-hidden>
                      +
                    </span>
                    <span className="min-w-0 flex-1 text-left">Add another clinic</span>
                  </button>
                )}
              </div>
            )}

            <div className="border-t border-[var(--border)] px-2 py-2">
              <button type="button" role="menuitem" className={rowCls} onClick={() => openSheet(setAccountOpen)}>
                <IconUser className={rowIcon} />
                <span className="min-w-0 flex-1 text-left">
                  <span className="block leading-tight">My account</span>
                  <span className="mt-0.5 block text-xs text-[var(--muted)]">Profile, password</span>
                </span>
              </button>
              {myTherapist && (
                <button type="button" role="menuitem" className={rowCls} onClick={openHoursSheet}>
                  <IconCalendar className={rowIcon} />
                  <span className="min-w-0 flex-1 text-left">
                    <span className="flex items-center gap-1.5 leading-tight">
                      <span>My working hours</span>
                      {hasUpdatedDot && (
                        <span
                          data-testid="hours-updated-dot"
                          className="h-2 w-2 rounded-full bg-[var(--teal)] shrink-0"
                          title="Updated"
                          aria-label="Updated"
                        />
                      )}
                    </span>
                    {hoursSubtitle && (
                      <span className="mt-0.5 block truncate text-xs text-[var(--muted)]">
                        {hoursSubtitle}
                      </span>
                    )}
                  </span>
                </button>
              )}
              <button type="button" role="menuitem" className={rowCls} onClick={() => openSheet(setNotificationsOpen)}>
                <IconBell className={rowIcon} />
                Notifications
              </button>
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
            <div className="flex items-center justify-center gap-2 border-t border-[var(--border)] px-3 py-2 text-[11px] text-[var(--muted)]">
              <BrandMark size={14} decorative />
              <span>Thera.Net v{__APP_VERSION__} · {__APP_BUILD__}</span>
              <span aria-hidden>·</span>
              <button type="button" className="font-medium text-[var(--teal)] hover:underline" onClick={() => void refreshApp()}>
                Refresh app
              </button>
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
        <ShiftRequestSheet
          open={hoursOpen}
          therapistId={myTherapist.id}
          therapistName={myTherapist.name}
          clinicId={clinicId}
          currentWorkingHours={myTherapist.workingHours ?? null}
          clinic={{
            startHour: clinic.bookingStartHour ?? 9,
            endHour: clinic.bookingEndHour ?? 17,
            operating: clinic.operatingHours ?? null,
            closedWeekdays: clinic.closedWeekdays,
          }}
          onClose={() => setHoursOpen(false)}
        />
      )}
      {changingPassword && (
        <ChangePasswordDialog
          isFirstPassword={!hasPasswordIdentity}
          onClose={() => setChangingPassword(false)}
        />
      )}
      {addingClinic && (
        <AddClinicDialog
          onClose={() => setAddingClinic(false)}
          onCreated={() => {
            setAddingClinic(false);
            void syncEngine.schedule(0);
            void navigate({ to: '/workspace' });
          }}
        />
      )}
      <HelpFeedbackDialog isOpen={helpOpen} onClose={() => setHelpOpen(false)} />
    </div>
  );
}
