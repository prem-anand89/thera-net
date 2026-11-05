import { useState } from 'react';
import { useClinic } from '@/app/clinicContext';
import { type Clinic, type UUID } from '@/domain/types';
import { ConfirmDialog, Field, inputCls, SectionCard, InfoTip } from '@/components/ui';
import { useClinicSectionForm, SectionSaveBar, SwitchRow } from './settingsShared';

type PatientCommsFields = Pick<Clinic, 'bookingSlug' | 'onlineBookingEnabled'>;

// Lowercase alphanumeric + hyphens, no leading/trailing/doubled hyphen —
// the DB only enforces uniqueness, so this is the one place the "clean
// URL segment" shape is actually checked.
const BOOKING_SLUG_PATTERN = /^[a-z0-9]+(-[a-z0-9]+)*$/;

/**
 * The public booking page: its own on/off switch and the booking link (slug) patients use to request an appointment,
 * plus the optional WhatsApp Business sub-block. Switching off keeps the link, so switching back on restores it. The feedback switch and Google review link now live in General → After a visit.
 */
export function PatientCommsSection({ onDirtyChange: _onDirtyChange }: { onDirtyChange: (dirty: boolean) => void }) {
  const clinic = useClinic();
  const { form, set, save, cancel, dirty, saved, busy, error, showSaveBar } =
    useClinicSectionForm<PatientCommsFields>(
      (c) => ({
        bookingSlug: c.bookingSlug ?? null,
        onlineBookingEnabled: c.onlineBookingEnabled ?? false,
      }),
      _onDirtyChange
    );
  const [slugCopied, setSlugCopied] = useState(false);
  // Changing or clearing a link that already exists breaks the old one for anyone who has it, so it asks first.
  // Setting a link for the first time just saves.
  const [confirmingLink, setConfirmingLink] = useState(false);
  const bookingOn = form.onlineBookingEnabled ?? false;
  const turningOff = Boolean(clinic.onlineBookingEnabled) && !bookingOn;
  const linkChanges = bookingOn && Boolean(clinic.bookingSlug) && (form.bookingSlug ?? null) !== clinic.bookingSlug;
  const bookingUrl = form.bookingSlug ? `${window.location.origin}/book/${form.bookingSlug}` : '';
  const slugInvalid = bookingOn && !!form.bookingSlug && !BOOKING_SLUG_PATTERN.test(form.bookingSlug as string);
  const slugMissing = bookingOn && !form.bookingSlug;

  async function copyBookingUrl() {
    if (!bookingUrl) return;
    try {
      await navigator.clipboard.writeText(bookingUrl);
      setSlugCopied(true);
      setTimeout(() => setSlugCopied(false), 1500);
    } catch {
      setSlugCopied(false);
    }
  }

  return (
    <>
      <SectionCard
        id="settings-card-booking-online"
        title="Online booking page"
      >
        <fieldset disabled={busy} className="contents">
          <SwitchRow
            label="Let patients book online"
            hint="Patients can request an appointment from your booking link. You confirm each request."
            checked={bookingOn}
            onChange={(v) => set({ onlineBookingEnabled: v })}
          />
          {bookingOn && (
          <div className="mt-3 grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field
              label={
                <>
                  Booking link
                  <InfoTip text="A short web address patients use to request an appointment — safe to put on Google, your website, or social media. Front desk confirms each request into a scheduled appointment; there's no live slot picker yet." />
                </>
              }
            >
              <input
                type="text"
                className={inputCls}
                placeholder="my-clinic-name"
                value={form.bookingSlug ?? ''}
                onChange={(e) => set({ bookingSlug: e.target.value.toLowerCase().trim() || null })}
              />
              {slugInvalid && (
                <p className="mt-1 text-xs text-[var(--rust)]">
                  Lowercase letters, numbers, and hyphens only — no spaces.
                </p>
              )}
            </Field>
            {bookingUrl && !slugInvalid && (
              <div className="sm:col-span-2">
                <span className="mb-1 block text-xs font-medium text-[var(--muted)]">
                  Your booking link
                </span>
                <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2 rounded-[10px] border border-[var(--border)] bg-[var(--paper)] px-3 py-2.5">
                  <span className="min-w-0 break-all font-mono text-xs text-[var(--ink)]">{bookingUrl}</span>
                  <button
                    type="button"
                    className="whitespace-nowrap rounded-full border border-[var(--border)] bg-[var(--surface)] px-2.5 py-1 text-xs font-medium text-[var(--teal)] hover:bg-[var(--paper)]"
                    onClick={() => void copyBookingUrl()}
                  >
                    {slugCopied ? 'Copied!' : 'Copy link'}
                  </button>
                </div>
              </div>
            )}
          </div>
          )}
        </fieldset>
        {showSaveBar && (
          <SectionSaveBar
            dirty={dirty}
            saved={saved}
            busy={busy}
            onSave={() => (linkChanges || turningOff ? setConfirmingLink(true) : void save())}
            onCancel={() => {
              cancel();
            }}
            error={slugInvalid ? 'Fix the booking link before saving.' : slugMissing ? 'Add a booking link, or turn online booking off.' : error}
            saveDisabled={slugInvalid || slugMissing}
          />
        )}
        <ConfirmDialog
          open={confirmingLink}
          title={turningOff ? 'Turn off online booking?' : 'Change the booking link?'}
          message={
            turningOff
              ? 'Anyone using your link will see that the page is not available. Requests you already have stay on Workspace.'
              : 'Anyone using the old link will no longer reach your booking page.'
          }
          confirmLabel={turningOff ? 'Turn off' : 'Change link'}
          onCancel={() => setConfirmingLink(false)}
          onConfirm={() => {
            setConfirmingLink(false);
            void save();
          }}
        />
      </SectionCard>
      <WhatsAppBusinessSubsection clinicId={clinic.id} />
    </>
  );
}

/**
 * Patient Communications, Phase 9 — Meta credentials for automated sends.
 * Patient-facing sends (feedback, booking, reminders) always use wa.me
 * today. Credentials are stored here for a future automated Business API
 * path and are not called from feedback or booking actions.
 *
 * A standalone mini-form, not part of `PatientCommsFields`/
 * `useClinicSectionForm` — `clinic_whatsapp_config` is a separate table
 * with write-only semantics (the access token never round-trips back to
 * the client), so it doesn't fit the "read the clinic row, diff, save"
 * shape that hook is built for.
 */
function WhatsAppBusinessSubsection({ clinicId: _clinicId }: { clinicId: UUID }) {
  // HIDDEN: The Meta API integration is currently too complex for average users to setup (requires Meta Business Verification). 
  // We are hiding this UI to prevent confusion and sticking to wa.me deep links.
  return null;
}
