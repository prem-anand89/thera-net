import { useEffect, useRef, useState } from 'react';
import { Panel, ConfirmDialog, Field, ErrorNote, inputCls, btnPrimary, btnSecondary } from '@/components/ui';
import { useSession } from '@/app/useSession';
import { repos } from '@/services';
import { getSupabase, publicTherapistPhotoUrl } from '@/lib/supabase';
import { resizeImageToBlob } from '@/lib/resizeImage';
import { toFriendlyMessage } from '@/lib/errors';
import { initialsFor } from '@/app/accountInitials';
import type { Therapist } from '@/domain/types';

export function MyAccountSheet({
  open,
  onClose,
  clinicId,
  displayName,
  fallbackName,
  setDisplayName,
  therapist,
  hasPasswordIdentity,
  onChangePassword,
}: {
  open: boolean;
  onClose: () => void;
  clinicId: string;
  displayName: string | null;
  fallbackName: string;
  setDisplayName: (name: string) => Promise<void>;
  therapist: Therapist | undefined;
  hasPasswordIdentity: boolean;
  onChangePassword: () => void;
}) {
  const { session } = useSession();
  const [name, setName] = useState('');
  const [invoiceName, setInvoiceName] = useState('');
  const [registrationNo, setRegistrationNo] = useState('');
  const [phone, setPhone] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [confirmOthers, setConfirmOthers] = useState(false);
  const [othersMessage, setOthersMessage] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;
    setName(displayName ?? '');
    setInvoiceName(therapist?.name ?? '');
    setRegistrationNo(therapist?.registrationNo ?? '');
    setPhone(therapist?.phone ?? '');
    setError(null);
    setSaved(false);
    setOthersMessage(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- reset only when opened
  }, [open]);

  async function saveProfile() {
    if (therapist && !invoiceName.trim()) {
      setError('Add the name that should print on invoices.');
      return;
    }
    setBusy(true);
    setError(null);
    setSaved(false);
    try {
      if (name.trim() !== (displayName ?? '')) await setDisplayName(name.trim());
      if (therapist) {
        await repos.therapists.put({
          ...therapist,
          name: invoiceName.trim(),
          registrationNo: registrationNo.trim() || null,
          phone: phone.trim() || null,
          updatedAt: new Date().toISOString(),
        });
      }
      setSaved(true);
    } catch (e) {
      setError(toFriendlyMessage(e));
    } finally {
      setBusy(false);
    }
  }

  async function uploadPhoto(file: File) {
    if (!therapist) return;
    setError(null);
    const supabase = getSupabase();
    if (!supabase || !navigator.onLine) {
      setError('Photo upload needs a connection.');
      return;
    }
    try {
      const resized = await resizeImageToBlob(file, 256);
      const path = `${clinicId}/therapist-${therapist.id}-${Date.now()}.jpg`;
      const { error: uploadError } = await supabase.storage
        .from('clinic-assets')
        .upload(path, resized, { contentType: 'image/jpeg' });
      if (uploadError) {
        setError(`Upload failed: ${toFriendlyMessage(uploadError)}`);
        return;
      }
      await repos.therapists.put({ ...therapist, photoPath: path, updatedAt: new Date().toISOString() });
    } catch (e) {
      setError(toFriendlyMessage(e));
    }
  }

  async function signOutOthers() {
    setConfirmOthers(false);
    const supabase = getSupabase();
    if (!supabase) return;
    const { error: signOutError } = await supabase.auth.signOut({ scope: 'others' });
    setOthersMessage(
      signOutError ? `Could not sign out other devices: ${toFriendlyMessage(signOutError)}` : 'Signed out of your other devices.'
    );
  }

  const photoUrl = therapist?.photoPath ? publicTherapistPhotoUrl(therapist.photoPath) : null;

  return (
    <Panel open={open} onClose={onClose} title="My account">
      <div className="space-y-6">
        <section className="space-y-3" aria-labelledby="my-profile-heading">
          <h3 id="my-profile-heading" className="text-sm font-semibold text-[var(--ink)]">
            Profile
          </h3>
          {therapist && (
            <div className="flex items-center gap-3">
              {photoUrl ? (
                <img src={photoUrl} alt="" className="h-14 w-14 rounded-full border border-[var(--border)] object-cover" />
              ) : (
                <span
                  aria-hidden
                  className="flex h-14 w-14 items-center justify-center rounded-full bg-[var(--teal)] text-lg font-semibold text-white"
                >
                  {initialsFor(therapist.name)}
                </span>
              )}
              <div>
                <input
                  ref={fileRef}
                  type="file"
                  accept="image/*"
                  className="sr-only"
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file) void uploadPhoto(file);
                    e.target.value = '';
                  }}
                />
                <button type="button" className={btnSecondary} onClick={() => fileRef.current?.click()}>
                  {photoUrl ? 'Change photo' : 'Add a photo'}
                </button>
              </div>
            </div>
          )}
          <Field label="Your name">
            <input
              className={inputCls}
              value={name}
              placeholder={fallbackName}
              autoComplete="name"
              onChange={(e) => setName(e.target.value)}
            />
          </Field>
          {therapist && (
            <>
              <Field label="Name on invoices *">
                <input className={inputCls} value={invoiceName} onChange={(e) => setInvoiceName(e.target.value)} />
              </Field>
              <div className="grid gap-3 tab:grid-cols-2">
                <Field label="Registration no.">
                  <input
                    className={inputCls}
                    placeholder="State council ID (optional)"
                    value={registrationNo}
                    onChange={(e) => setRegistrationNo(e.target.value)}
                  />
                </Field>
                <Field label="Phone">
                  <input
                    className={inputCls}
                    inputMode="tel"
                    autoComplete="tel"
                    placeholder="+91 …"
                    value={phone}
                    onChange={(e) => setPhone(e.target.value)}
                  />
                </Field>
              </div>
            </>
          )}
          <Field label="Email">
            <input className={`${inputCls} bg-[var(--paper)]`} value={session?.user?.email ?? ''} readOnly />
          </Field>
          <ErrorNote message={error} />
          <div className="flex items-center gap-3">
            <button type="button" className={btnPrimary} disabled={busy} onClick={() => void saveProfile()}>
              {busy ? 'Saving…' : 'Save profile'}
            </button>
            {saved && <span className="text-sm text-[var(--moss-strong)]">Profile saved</span>}
          </div>
        </section>

        <section className="space-y-3 border-t border-[var(--border)] pt-5" aria-labelledby="my-security-heading">
          <h3 id="my-security-heading" className="text-sm font-semibold text-[var(--ink)]">
            Security
          </h3>
          <div className="flex flex-wrap gap-2">
            <button type="button" className={btnSecondary} onClick={onChangePassword}>
              {hasPasswordIdentity ? 'Change password' : 'Set a password'}
            </button>
            <button type="button" className={btnSecondary} onClick={() => setConfirmOthers(true)}>
              Sign out of other devices
            </button>
          </div>
          {othersMessage && <p className="text-sm text-[var(--muted)]">{othersMessage}</p>}
        </section>
      </div>
      <ConfirmDialog
        open={confirmOthers}
        title="Sign out of other devices?"
        message="Every other phone or computer signed in to your account will need to sign in again. This device stays signed in."
        confirmLabel="Sign out other devices"
        onConfirm={() => void signOutOthers()}
        onCancel={() => setConfirmOthers(false)}
      />
    </Panel>
  );
}
