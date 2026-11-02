import { OperatingHoursEditor } from './OperatingHoursEditor';
import { COUNTRY_CODES } from '@/domain/countryCodes';
import { clinicCountryCode, clinicTimezone, regionSummary, timezoneHint, timezoneOptions } from '@/domain/clinicRegion';
import { MONTH_NAMES } from '@/domain/fiscalYear';
import { PhoneField } from '@/components/PhoneField';
import { useMemo, useState } from 'react';
import { getSupabase, publicLogoUrl } from '@/lib/supabase';
import { type Clinic } from '@/domain/types';
import { Field, inputCls, SectionCard, InfoTip } from '@/components/ui';
import { OpenDaysStrip } from './OpenDaysStrip';
import { withOpenDays } from '@/domain/operatingHours';
import { LetterheadPreview } from './LetterheadPreview';
import { clampBufferHours } from './shiftUtils';
import { toFriendlyMessage } from '@/lib/errors';
import { isValidUpiVpa } from '@/domain/upiPay';
import { useClinicSectionForm, SectionSaveBar, BoolToggle } from './settingsShared';

type ProfileFields = Pick<
  Clinic,
  | 'name'
  | 'address'
  | 'phone'
  | 'email'
  | 'walkInMrnoPrefix'
  | 'logoPath'
  | 'signaturePath'

>;

export function ClinicProfileSection({ onDirtyChange }: { onDirtyChange: (dirty: boolean) => void }) {
  const { clinic, form, set, save, cancel, saveFieldNow, dirty, saved, busy, error, setError, showSaveBar } =
    useClinicSectionForm<ProfileFields>(
      (c) => ({
        name: c.name,
        address: c.address,
        phone: c.phone,
        email: c.email,
        walkInMrnoPrefix: c.walkInMrnoPrefix,
        logoPath: c.logoPath,
        signaturePath: c.signaturePath,
      }),
      onDirtyChange
    );
  const logoPreviewUrl = publicLogoUrl(form.logoPath);
  // Partner name and logo are edited in Payments & billing → Partner & split; the letterhead preview shows the saved ones.
  const partnerLogoPreviewUrl = clinic.hasPartner ? publicLogoUrl(clinic.partnerHospitalLogoPath) : null;
  const signaturePreviewUrl = publicLogoUrl(form.signaturePath);

  async function uploadLogo(file: File) {
    setError(null);
    const supabase = getSupabase();
    if (!supabase || !navigator.onLine) {
      setError('Logo upload needs a connection.');
      return;
    }
    const path = `${clinic.id}/logo-${Date.now()}.${file.name.split('.').pop()}`;
    const { error: uploadError } = await supabase.storage.from('clinic-assets').upload(path, file);
    if (uploadError) {
      setError(`Upload failed: ${toFriendlyMessage(uploadError)}`);
      return;
    }
    await saveFieldNow({ logoPath: path } as Partial<ProfileFields>);
  }

  async function uploadSignature(file: File) {
    setError(null);
    const supabase = getSupabase();
    if (!supabase || !navigator.onLine) {
      setError('Signature upload needs a connection.');
      return;
    }
    const path = `${clinic.id}/signature-${Date.now()}.${file.name.split('.').pop()}`;
    const { error: uploadError } = await supabase.storage.from('clinic-assets').upload(path, file);
    if (uploadError) {
      setError(`Upload failed: ${toFriendlyMessage(uploadError)}`);
      return;
    }
    await saveFieldNow({ signaturePath: path } as Partial<ProfileFields>);
  }

  async function saveProfile() {
    await save();
  }

  return (
    // Both columns pin to row 1 explicitly (same reasoning as
    // PatientProfilePage.tsx's identical grid): without `desktop:row-start-1`
    // on both, grid auto-placement would put the side column (first in DOM,
    // at col-start-2) in row 1, then drop the main column to row 2.
    <div className="grid grid-cols-1 gap-6 desktop:grid-cols-[minmax(0,1fr)_16rem] desktop:items-start">
      <div className="order-1 min-w-0 space-y-6 desktop:order-none desktop:col-start-1 desktop:row-start-1">
        <SectionCard
          id="settings-card-general-profile"
          title="Clinic profile"
        >
            <fieldset disabled={busy} className="contents">
              <div className="space-y-6">
                <div className="flex flex-col sm:flex-row gap-6 items-start">
                  <div className="shrink-0 flex flex-col items-center gap-2">
                    {logoPreviewUrl ? (
                      <img 
                        src={logoPreviewUrl} 
                        alt="Clinic logo" 
                        className="h-20 w-20 object-contain rounded-xl border border-[var(--border)] bg-white p-2 shadow-sm" 
                      />
                    ) : (
                      <div className="h-20 w-20 rounded-xl bg-[var(--surface)] border border-[var(--border)] shadow-sm flex items-center justify-center text-[var(--muted)]">
                        <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"></path><polyline points="9 22 9 12 15 12 15 22"></polyline></svg>
                      </div>
                    )}
                    <label className="cursor-pointer text-xs font-semibold text-[var(--teal)] hover:underline">
                      Upload logo
                      <input 
                        type="file" 
                        accept="image/*" 
                        className="hidden" 
                        onChange={(e) => e.target.files?.[0] && void uploadLogo(e.target.files[0])} 
                      />
                    </label>
                  </div>

                  <div className="flex-1 w-full space-y-4">
                    <div className="flex flex-wrap gap-4">
                      <div className="flex-1 min-w-[200px]">
                        <label className="block text-label font-medium text-[var(--muted)] mb-1.5">Clinic Name</label>
                        <input 
                          className={inputCls} 
                          value={form.name} 
                          onChange={(e) => set({ name: e.target.value })} 
                          placeholder="Your Clinic Name" 
                        />
                      </div>
                    </div>
                    
                    <div>
                      <label className="block text-label font-medium text-[var(--muted)] mb-1.5">Address</label>
                      <textarea 
                        className={`${inputCls} resize-none min-h-[72px]`} 
                        rows={3} 
                        placeholder={'Street\nCity, State — PIN'} 
                        value={form.address ?? ''} 
                        onChange={(e) => set({ address: e.target.value || null })} 
                      />
                    </div>

                    <div className="flex flex-wrap gap-4 pt-1">
                      <div className="flex-1 min-w-[140px]">
                        <label className="block text-label font-medium text-[var(--muted)] mb-1.5">Phone</label>
                        <PhoneField
                          value={form.phone ?? ''}
                          onChange={(phone) => set({ phone: phone || null })}
                          ariaLabel="Clinic phone"
                        />
                      </div>
                      <div className="flex-1 min-w-[180px]">
                        <label className="block text-label font-medium text-[var(--muted)] mb-1.5">Email</label>
                        <input 
                          className={inputCls} 
                          value={form.email ?? ''} 
                          onChange={(e) => set({ email: e.target.value || null })} 
                          placeholder="Email address" 
                        />
                      </div>
                      <div className="w-28">
                        <label className="block text-label font-medium text-[var(--muted)] mb-1.5 flex items-center gap-1">
                          Patient ID Prefix
                          <InfoTip text="Used for auto-generated Patient IDs when a walk-in has no existing ID (format: PREFIXYY-0001). Defaults to 'W'." />
                        </label>
                        <input 
                          className={inputCls} 
                          value={form.walkInMrnoPrefix ?? ''} 
                          onChange={(e) => set({ walkInMrnoPrefix: e.target.value.toUpperCase() || null })} 
                          placeholder="W" 
                        />
                      </div>
                    </div>
                  </div>
                </div>

                <div className="pt-6 border-t border-[var(--border)]">
                  {/* Signature Column */}
                  <div>
                    <label className="block text-label font-medium text-[var(--muted)] mb-2">Authorized Signature</label>
                    <p className="text-hint text-[var(--muted)] mb-4 leading-relaxed">
                      A one-time uploaded signature image, printed on every invoice in place of the blank "Authorised signature" line.
                    </p>
                    <div className="flex flex-col items-start gap-2">
                      {signaturePreviewUrl ? (
                        <img 
                          src={signaturePreviewUrl} 
                          alt="Signature" 
                          className="h-16 w-32 object-contain rounded border border-[var(--border)] bg-white p-1 shadow-sm" 
                        />
                      ) : (
                        <div className="h-16 w-32 rounded bg-white border border-[var(--border)] shadow-sm flex items-center justify-center text-[var(--muted)] text-caption">
                          No signature
                        </div>
                      )}
                      <label className="cursor-pointer text-xs font-semibold text-[var(--teal)] hover:underline">
                        Upload signature
                        <input 
                          type="file" 
                          accept="image/*" 
                          className="hidden" 
                          onChange={(e) => e.target.files?.[0] && void uploadSignature(e.target.files[0])} 
                        />
                      </label>
                    </div>
                  </div>
                </div>
              </div>

            </fieldset>

          {showSaveBar && (
            <SectionSaveBar
              dirty={dirty}
              saved={saved}
              busy={busy}
              onSave={() => void saveProfile()}
              onCancel={() => {
                cancel();
              }}
              error={error}
            />
          )}
        </SectionCard>
      </div>

      {/* One mounted instance — stacks inline below the form on mobile,
          sits as a sticky sidebar on desktop, via the grid order/placement
          above rather than mounting (and re-rendering, and double-fetching
          images for) two separate copies. */}
      <div className="order-2 desktop:order-none desktop:sticky desktop:top-20 desktop:col-start-2 desktop:row-start-1 desktop:w-[16rem] desktop:shrink-0">
        <LetterheadPreview
          draft={{
            name: form.name,
            address: form.address,
            phone: form.phone,
            email: form.email,
            gstNo: clinic.gstNo,
            partnerHospitalName: clinic.hasPartner ? clinic.partnerHospitalName : null
          }}
          logoUrl={logoPreviewUrl}
          partnerLogoUrl={partnerLogoPreviewUrl}
        />
      </div>
    </div>
  );
}

type ClinicRegionFields = Pick<Clinic, 'timezone' | 'defaultCountryCode' | 'fyStartMonth' | 'agendaEnabled' | 'agendaHour'>;

/** Time zone and phone country code: what every server-sent time and every new phone number starts from. */
/** Evening hours offered for the agenda email (clinic time). */
const AGENDA_HOURS = [16, 17, 18, 19, 20, 21, 22];

const hourLabel = (hour: number) => `${hour % 12 === 0 ? 12 : hour % 12}:00 ${hour < 12 ? 'am' : 'pm'}`;

export function ClinicRegionSection({ onDirtyChange }: { onDirtyChange: (dirty: boolean) => void }) {
  const { clinic, form, set, save, cancel, dirty, saved, busy, error, showSaveBar } = useClinicSectionForm<ClinicRegionFields>(
    (c) => ({
      timezone: clinicTimezone(c),
      defaultCountryCode: clinicCountryCode(c),
      fyStartMonth: c.fyStartMonth,
      agendaEnabled: c.agendaEnabled !== false,
      agendaHour: c.agendaHour ?? 20,
    }),
    onDirtyChange
  );
  const zones = useMemo(() => {
    const all = timezoneOptions();
    return form.timezone && !all.includes(form.timezone) ? [form.timezone, ...all] : all;
  }, [form.timezone]);
  // The region is one line of text until someone wants to change it. A disclosure, not a lock: nothing is disabled.
  const [open, setOpen] = useState(false);
  const expanded = open || dirty;
  const country = COUNTRY_CODES.find((c) => c.code === (form.defaultCountryCode ?? '+91'));
  const summary = regionSummary({
    country: country?.code ? `${country.name} (${country.code})` : 'Other country',
    timezone: form.timezone ?? 'Asia/Kolkata',
    fyStartMonth: form.fyStartMonth,
  });

  return (
    <div>
      <SectionCard
        id="settings-card-region"
        title="Region and agenda"
      >
        <fieldset disabled={busy} className="contents">
          <div className="flex items-start justify-between gap-3">
            <p className="text-sm text-[var(--ink)]" data-testid="region-summary">
              {summary}
            </p>
            {!dirty && (
              <button type="button" className="min-h-8 shrink-0 rounded-md px-2 text-xs font-semibold text-[var(--teal)] hover:bg-[var(--paper)]" aria-expanded={expanded} onClick={() => setOpen((v) => !v)}>
                {expanded ? 'Done' : 'Change'}
              </button>
            )}
          </div>
          {expanded && (
          <div className="mt-3 grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field
              label={
                <>
                  Time zone
                  <InfoTip text="Emails, push notifications, the daily agenda and your public booking page show times in this zone." />
                </>
              }
              htmlFor="clinic-timezone"
            >
              <select
                id="clinic-timezone"
                className={inputCls}
                value={form.timezone ?? 'Asia/Kolkata'}
                onChange={(e) => set({ timezone: e.target.value })}
              >
                {zones.map((zone) => (
                  <option key={zone} value={zone}>
                    {zone}
                  </option>
                ))}
              </select>
              <span className="mt-1 block text-hint text-[var(--muted)]">{timezoneHint(form.timezone ?? 'Asia/Kolkata')}</span>
            </Field>
            <Field
              label={
                <>
                  Phone country code
                  <InfoTip text="New phone numbers start with this code. Each number can still use another." />
                </>
              }
              htmlFor="clinic-country-code"
            >
              <select
                id="clinic-country-code"
                className={inputCls}
                value={form.defaultCountryCode ?? '+91'}
                onChange={(e) => set({ defaultCountryCode: e.target.value })}
              >
                {COUNTRY_CODES.filter((c) => c.code).map((c) => (
                  <option key={c.code} value={c.code}>
                    {c.flag} {c.name} {c.code}
                  </option>
                ))}
              </select>
            </Field>
            <Field
              label={
                <>
                  Financial year starts in
                  <InfoTip text="Invoice numbers restart each financial year (for example BM/26-27/0001). April is the usual choice in India." />
                </>
              }
              htmlFor="clinic-fy-start"
              hint={form.fyStartMonth !== clinic.fyStartMonth ? 'Applies to invoices issued from now on. Invoices already issued keep their numbers.' : undefined}
            >
              <select
                id="clinic-fy-start"
                className={inputCls}
                value={form.fyStartMonth}
                onChange={(e) => set({ fyStartMonth: Number(e.target.value) })}
              >
                {MONTH_NAMES.map((label, i) => (
                  <option key={label} value={i + 1}>
                    {label}
                  </option>
                ))}
              </select>
            </Field>
          </div>
          )}
          <label className="mt-4 flex min-h-11 cursor-pointer items-center justify-between gap-3">
            <span>
              <span className="block text-sm font-medium text-[var(--ink)]">Daily agenda email</span>
              <span className="block text-xs text-[var(--muted)]">
                Each therapist with a login gets tomorrow's appointments in one email, with a calendar file.
              </span>
            </span>
            <input
              type="checkbox"
              role="switch"
              aria-label="Daily agenda email"
              className="h-5 w-5 shrink-0 accent-[var(--teal)]"
              checked={form.agendaEnabled !== false}
              onChange={(e) => set({ agendaEnabled: e.target.checked })}
            />
          </label>
          {form.agendaEnabled !== false && (
            <Field label="Send at" htmlFor="clinic-agenda-hour">
              <select
                id="clinic-agenda-hour"
                className={`${inputCls} sm:max-w-[10rem]`}
                value={form.agendaHour ?? 20}
                onChange={(e) => set({ agendaHour: Number(e.target.value) })}
              >
                {[...new Set([...AGENDA_HOURS, form.agendaHour ?? 20])].sort((a, b) => a - b).map((hour) => (
                  <option key={hour} value={hour}>
                    {hourLabel(hour)}
                  </option>
                ))}
              </select>
            </Field>
          )}
        </fieldset>
        {showSaveBar && (
          <SectionSaveBar
            dirty={dirty}
            saved={saved}
            busy={busy}
            onSave={() => void save()}
            onCancel={() => {
              cancel();
            }}
            error={error}
          />
        )}
      </SectionCard>
    </div>
  );
}

type ClinicHoursFields = Pick<
  Clinic,
  | 'bookingStartHour'
  | 'bookingEndHour'
  | 'operatingHours'
  | 'staffBookingBufferHours'
  | 'closedWeekdays'
  | 'slotDurationMinutes'
>;

export function ClinicHoursSection({ onDirtyChange }: { onDirtyChange: (dirty: boolean) => void }) {
  const { form, set, save, cancel, dirty, saved, busy, error, setError, showSaveBar } =
    useClinicSectionForm<ClinicHoursFields>(
      (c) => ({
        bookingStartHour: c.bookingStartHour ?? 9,
        bookingEndHour: c.bookingEndHour ?? 17,
        // Only present once the clinic has set some (or the editor changes it): a clinic row saved before the
        // operating_hours migration is applied must not start sending a column the database does not have yet.
        ...(c.operatingHours ? { operatingHours: c.operatingHours } : {}),
        staffBookingBufferHours: c.staffBookingBufferHours ?? 3,
        closedWeekdays: c.closedWeekdays ?? [],
        slotDurationMinutes: c.slotDurationMinutes ?? 30,
      }),
      onDirtyChange
    );
  // What is wrong with the hours as typed (a second session that starts before the first ends, ...): Save refuses until it is fixed.
  const [hoursProblem, setHoursProblem] = useState<string | null>(null);
  async function saveHours() {
    if (hoursProblem) {
      setError(hoursProblem);
      return;
    }
    await save();
  }

  return (
    <div>
      <SectionCard
        id="settings-card-booking-hours"
        title="Hours & closures"
      >
        <fieldset disabled={busy} className="contents">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="sm:col-span-2">
              <p className="mb-1 text-xs font-medium text-[var(--muted)]">
                Open days
                <InfoTip text="The days the clinic is open every week. Holidays and one-off closures are set on the Schedule." />
              </p>
              <OpenDaysStrip closedWeekdays={form.closedWeekdays ?? []} disabled={busy} onChange={(closedWeekdays) =>
                  set({ closedWeekdays, ...(form.operatingHours ? { operatingHours: withOpenDays(form.operatingHours, closedWeekdays) } : {}) })
                }
              />
            </div>

            <div className="sm:col-span-2">
              <OperatingHoursEditor
                bufferHours={form.staffBookingBufferHours ?? 3}
                operatingHours={form.operatingHours}
                startHour={form.bookingStartHour ?? 9}
                endHour={form.bookingEndHour ?? 17}
                closedWeekdays={form.closedWeekdays ?? []}
                onChange={(change, problem) => {
                  setHoursProblem(problem);
                  set(change);
                }}
              />
            </div>

            <p className="sm:col-span-2 border-t border-[var(--border)] pt-4 text-sm font-semibold text-[var(--ink)]">
              Appointments
            </p>

            <Field
              label={
                <>
                  Default appointment duration
                  <InfoTip text="The length of a standard appointment. Online booking offers patients start times at this interval." />
                </>
              }
            >
              <select
                className={inputCls}
                value={form.slotDurationMinutes ?? 30}
                onChange={(e) => set({ slotDurationMinutes: Number(e.target.value) })}
              >
                <option value={15}>15 minutes</option>
                <option value={30}>30 minutes</option>
                <option value={45}>45 minutes</option>
                <option value={60}>60 minutes</option>
              </select>
            </Field>

            <Field
              label="Staff can book outside opening hours"
              htmlFor="staff-booking-buffer"
              hint="For early or late appointments that staff add. Patients booking online only see opening hours."
            >
              <select
                id="staff-booking-buffer"
                className={inputCls}
                value={form.staffBookingBufferHours ?? 3}
                onChange={(e) => set({ staffBookingBufferHours: clampBufferHours(Number(e.target.value)) })}
              >
                {[...new Set([0, 1, 2, 3, 4, 5, 6, form.staffBookingBufferHours ?? 3])]
                  .sort((x, y) => x - y)
                  .map((hours) => (
                    <option key={hours} value={hours}>
                      {hours === 0 ? 'No, opening hours only' : `Up to ${hours} hour${hours === 1 ? '' : 's'} before opening and after closing`}
                    </option>
                  ))}
              </select>
            </Field>

          </div>
        </fieldset>
        <p className="mt-3 text-xs text-[var(--muted)]">
          Holidays, one-off closures and a therapist's own hours are set on the{' '}
          <span className="font-medium text-[var(--ink)]">Schedule</span>.
        </p>
        {showSaveBar && (
          <SectionSaveBar
            dirty={dirty}
            saved={saved}
            busy={busy}
            onSave={() => void saveHours()}
            onCancel={() => {
              cancel();
              setHoursProblem(null);
            }}
            error={error}
          />
        )}
      </SectionCard>
    </div>
  );
}

type AfterVisitFields = Pick<Clinic, 'clinicalDocsEnabled' | 'enablePatientComms' | 'googleReviewUrl'>;

/** One switch row: label and what it does on the left, the switch on the right (the same row as "Daily agenda email"). */
function SwitchRow({ label, hint, checked, onChange }: { label: string; hint: string; checked: boolean; onChange: (next: boolean) => void }) {
  return (
    <label className="flex min-h-11 cursor-pointer items-center justify-between gap-3">
      <span>
        <span className="block text-sm font-medium text-[var(--ink)]">{label}</span>
        <span className="block text-xs text-[var(--muted)]">{hint}</span>
      </span>
      <input
        type="checkbox"
        role="switch"
        aria-label={label}
        className="h-5 w-5 shrink-0 accent-[var(--teal)]"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
      />
    </label>
  );
}

/**
 * What staff are offered right after logging a visit: a prompt for the clinical note, and a feedback request (with the
 * clinic's Google review link). Both sit here, on General, so a plan without invoicing reaches them too.
 */
export function AfterVisitSection({ onDirtyChange }: { onDirtyChange: (dirty: boolean) => void }) {
  const { form, set, save, cancel, dirty, saved, busy, error, showSaveBar } = useClinicSectionForm<AfterVisitFields>(
    (c) => ({
      clinicalDocsEnabled: c.clinicalDocsEnabled ?? false,
      enablePatientComms: c.enablePatientComms ?? false,
      googleReviewUrl: c.googleReviewUrl ?? null,
    }),
    onDirtyChange
  );

  return (
    <div>
      <SectionCard id="settings-card-after-visit" title="After a visit">
        <fieldset disabled={busy} className="contents">
          <div className="space-y-3">
            <SwitchRow
              label="Prompt for clinical notes after each visit"
              hint="When off, therapists can still open a patient's notes from their profile."
              checked={form.clinicalDocsEnabled ?? false}
              onChange={(v) => set({ clinicalDocsEnabled: v })}
            />
            <SwitchRow
              label="Ask patients for feedback"
              hint="Staff can send a one-time feedback link by WhatsApp. No patient login needed."
              checked={form.enablePatientComms ?? false}
              onChange={(v) => set({ enablePatientComms: v })}
            />
            {form.enablePatientComms && (
              <Field
                label={
                  <>
                    Google review link (optional)
                    <InfoTip text="Your clinic's Google review page. Set it to offer a 'Leave a Google review' prompt to patients who rate 5 stars, and an 'Ask for a Google review' action for staff. Leave blank to skip Google review nudges." />
                  </>
                }
                htmlFor="clinic-google-review"
              >
                <input
                  id="clinic-google-review"
                  type="url"
                  className={inputCls}
                  placeholder="https://g.page/r/…/review"
                  value={form.googleReviewUrl ?? ''}
                  onChange={(e) => set({ googleReviewUrl: e.target.value.trim() || null })}
                />
              </Field>
            )}
          </div>
        </fieldset>
        {showSaveBar && (
          <SectionSaveBar dirty={dirty} saved={saved} busy={busy} onSave={() => void save()} onCancel={cancel} error={error} />
        )}
      </SectionCard>
    </div>
  );
}

type PaymentsFields = Pick<Clinic, 'upiVpa' | 'upiPayeeName' | 'upiQrPath' | 'upiQrEnabled'>;

/**
 * How the clinic collects by UPI: show-QR switch, UPI ID, payee name, QR image. New visit and Take payment show a Scan to
 * pay sheet from it, and Lite can collect by UPI, so it is on every plan. (There is no default payment method setting:
 * payment screens start from "Collected by {partner}" when the partner collects, else the method this device used last,
 * else UPI. Who collects is set in Payments & billing → Partner & split.)
 */
export function PaymentsSection({ onDirtyChange }: { onDirtyChange: (dirty: boolean) => void }) {
  const { clinic, form, set, save, cancel, saveFieldNow, dirty, saved, busy, error, setError, showSaveBar } = useClinicSectionForm<PaymentsFields>(
    (c) => ({
      upiVpa: c.upiVpa ?? '',
      upiPayeeName: c.upiPayeeName ?? '',
      upiQrPath: c.upiQrPath ?? null,
      upiQrEnabled: c.upiQrEnabled ?? false,
    }),
    onDirtyChange
  );
  const qrPreviewUrl = publicLogoUrl(form.upiQrPath);

  async function uploadUpiQr(file: File) {
    setError(null);
    const supabase = getSupabase();
    if (!supabase || !navigator.onLine) {
      setError('QR upload needs a connection.');
      return;
    }
    const path = `${clinic.id}/upi-qr-${Date.now()}.${file.name.split('.').pop()}`;
    const { error: uploadError } = await supabase.storage.from('clinic-assets').upload(path, file);
    if (uploadError) {
      setError(`Upload failed: ${toFriendlyMessage(uploadError)}`);
      return;
    }
    await saveFieldNow({ upiQrPath: path } as Partial<PaymentsFields>);
  }

  async function savePayments() {
    const vpa = (form.upiVpa ?? '').trim();
    if (form.upiQrEnabled && vpa && !isValidUpiVpa(vpa)) {
      setError('Enter a valid UPI ID (e.g. clinic@okaxis) or turn UPI QR off.');
      return;
    }
    if (form.upiQrEnabled && !vpa && !form.upiQrPath) {
      setError('Add a UPI ID or upload a QR image before turning UPI QR on.');
      return;
    }
    await save();
  }

  return (
    <div>
      <SectionCard
        id="settings-card-payments"
        title="Payments"
      >
        <fieldset disabled={busy} className="contents">
          <p className="mb-3 text-xs text-[var(--muted)]">
            One clinic UPI for the front desk. When the payment method is UPI, staff can show a QR the patient scans. A UPI ID
            builds a QR with the visit amount and Patient ID in the note; an uploaded image is the fallback.
          </p>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field
              label={
                <>
                  Show UPI QR at collection
                  <InfoTip text="When on, New visit and Take payment show a Scan to pay sheet if the method is UPI." />
                </>
              }
            >
              <BoolToggle value={form.upiQrEnabled ?? false} onChange={(v) => set({ upiQrEnabled: v })} />
            </Field>
            {form.upiQrEnabled && (
              <>
                <Field label="UPI ID (VPA)">
                  <input
                    className={inputCls}
                    placeholder="clinic@okaxis"
                    value={form.upiVpa ?? ''}
                    onChange={(e) => set({ upiVpa: e.target.value })}
                    autoComplete="off"
                  />
                </Field>
                <Field
                  label={
                    <>
                      Payee name
                      <InfoTip text="Shown in the patient's UPI app. Leave blank to use the clinic name." />
                    </>
                  }
                >
                  <input
                    className={inputCls}
                    placeholder={clinic.name}
                    value={form.upiPayeeName ?? ''}
                    onChange={(e) => set({ upiPayeeName: e.target.value })}
                  />
                </Field>
                <Field label="QR image (optional)">
                  <input
                    type="file"
                    accept="image/*"
                    className={inputCls}
                    onChange={(e) => e.target.files?.[0] && void uploadUpiQr(e.target.files[0])}
                  />
                  {qrPreviewUrl && <img src={qrPreviewUrl} alt="Uploaded clinic UPI QR" className="mt-2 h-24 w-24 object-contain" />}
                </Field>
              </>
            )}
          </div>
        </fieldset>
        {showSaveBar && (
          <SectionSaveBar
            dirty={dirty}
            saved={saved}
            busy={busy}
            onSave={() => void savePayments()}
            onCancel={() => {
              cancel();
            }}
            error={error}
          />
        )}
      </SectionCard>
    </div>
  );
}
