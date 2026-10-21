import { useEffect, useState } from 'react';
import { useClinic } from '@/app/clinicContext';
import { type Clinic, type UUID } from '@/domain/types';
import { Field, inputCls, SectionCard, InfoTip } from '@/components/ui';
import { useClinicSectionForm, SectionSaveBar, SetOnceEditButton, BoolToggle } from './settingsShared';

type PatientCommsFields = Pick<Clinic, 'enablePatientComms' | 'googleReviewUrl' | 'bookingSlug'>;

// Lowercase alphanumeric + hyphens, no leading/trailing/doubled hyphen —
// the DB only enforces uniqueness, so this is the one place the "clean
// URL segment" shape is actually checked.
const BOOKING_SLUG_PATTERN = /^[a-z0-9]+(-[a-z0-9]+)*$/;

/**
 * Patient Communications, Slice 1-5 — module on/off, the Google review
 * URL (Slice 3), and the public booking slug (Slice 5). Per
 * HANDOFF-patient-comms.md's "one chip, not scattered" instruction this
 * is its own section rather than a checkbox bolted onto Clinic profile's
 * "Optional modules" grid; the message-template/WhatsApp-number fields
 * the full spec describes arrive with later slices, not here.
 */
export function PatientCommsSection({ onDirtyChange: _onDirtyChange }: { onDirtyChange: (dirty: boolean) => void }) {
  const clinic = useClinic();
  const { form, set, save, cancel, dirty, saved, busy, error } =
    useClinicSectionForm<PatientCommsFields>(
      (c) => ({
        enablePatientComms: c.enablePatientComms ?? false,
        googleReviewUrl: c.googleReviewUrl ?? null,
        bookingSlug: c.bookingSlug ?? null,
      }),
      _onDirtyChange
    );
  const [editing, setEditing] = useState(false);
  useEffect(() => {
    if (editing && saved && !dirty) setEditing(false);
  }, [editing, saved, dirty]);
  const [slugCopied, setSlugCopied] = useState(false);
  const bookingUrl = form.bookingSlug ? `${window.location.origin}/book/${form.bookingSlug}` : '';
  const slugInvalid = !!form.bookingSlug && !BOOKING_SLUG_PATTERN.test(form.bookingSlug as string);

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
        title="Booking page"
        action={editing ? undefined : <SetOnceEditButton label="Edit booking page" onClick={() => setEditing(true)} />}
      >
        <fieldset disabled={!editing} className="contents">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Field
              label={
                <>
                  Feedback
                  <InfoTip text="Turn on to let staff ask a patient for feedback after a visit. Each request creates a one-time link to a public feedback form, shared via WhatsApp — no patient login or Business API needed." />
                </>
              }
            >
              <BoolToggle
                value={form.enablePatientComms ?? false}
                onChange={(v) => set({ enablePatientComms: v })}
              />
            </Field>
            <Field
              label={
                <>
                  Google review link
                  <InfoTip text="Your clinic's Google review page. Set it to unlock a 'Leave a Google review' prompt for patients who rate 5 stars, plus an 'Ask for a Google review' action for staff on those same responses — or any visit at all, via the row menu. Leave blank to skip Google review nudges entirely." />
                </>
              }
            >
              <input
                type="url"
                className={inputCls}
                placeholder="https://g.page/r/…/review"
                value={form.googleReviewUrl ?? ''}
                onChange={(e) => set({ googleReviewUrl: e.target.value.trim() || null })}
              />
            </Field>
            <Field
              label={
                <>
                  Booking link
                  <InfoTip text="A short web address patients use to request an appointment — safe to put on Google, your website, or social media. Front desk confirms each request into a scheduled appointment; there's no live slot picker yet. Leave blank to keep public booking off." />
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
                <div className="flex items-center justify-between gap-3 rounded-[10px] border border-[var(--border)] bg-[var(--paper)] px-3 py-2.5">
                  <span className="truncate font-mono text-xs text-[var(--ink)]">{bookingUrl}</span>
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
        </fieldset>
        {editing && (
          <SectionSaveBar
            dirty={dirty}
            saved={saved}
            busy={busy}
            onSave={() => void save()}
            onCancel={() => {
              cancel();
              setEditing(false);
            }}
            error={slugInvalid ? 'Fix the booking link before saving.' : error}
            saveDisabled={slugInvalid}
          />
        )}
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
