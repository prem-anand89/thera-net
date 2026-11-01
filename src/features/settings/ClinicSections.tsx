import { OperatingHoursEditor } from './OperatingHoursEditor';
import { COUNTRY_CODES } from '@/domain/countryCodes';
import { clinicCountryCode, clinicTimezone, timezoneHint, timezoneOptions } from '@/domain/clinicRegion';
import { PhoneField } from '@/components/PhoneField';
import { useEffect, useMemo, useState } from 'react';
import { getSupabase, publicLogoUrl } from '@/lib/supabase';
import { type Clinic, type PaymentMethod } from '@/domain/types';
import { paymentMethodLabel, paymentMethodOptions, partnerName } from '@/domain/paymentMethods';
import { Field, inputCls, SectionCard, InfoTip } from '@/components/ui';
import { OpenDaysStrip } from './OpenDaysStrip';
import { withOpenDays } from '@/domain/operatingHours';
import { LetterheadPreview } from './LetterheadPreview';
import { clampBufferHours } from './shiftUtils';
import { toFriendlyMessage } from '@/lib/errors';
import { useClinicSectionForm, SectionSaveBar, SetOnceEditButton, BoolToggle } from './settingsShared';

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
  const { clinic, form, set, save, cancel, saveFieldNow, dirty, saved, busy, error, setError } =
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
  const [editing, setEditing] = useState(false);
  useEffect(() => {
    if (editing && saved && !dirty) setEditing(false);
  }, [editing, saved, dirty]);
  const logoPreviewUrl = publicLogoUrl(form.logoPath);
  // Partner name and logo are edited in Billing → Partner & split; the letterhead preview shows the saved ones.
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
          action={
            !editing && (
              <button
                type="button"
                className="text-xs font-semibold text-[var(--teal)] hover:underline"
                onClick={() => setEditing(true)}
              >
                Edit clinic profile
              </button>
            )
          }
        >
          {!editing ? (
            <div className="space-y-6">
              <div className="flex flex-col sm:flex-row gap-6 items-start">
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
                <div className="flex-1 space-y-3 w-full">
                  <div className="flex flex-wrap items-baseline gap-3">
                    <h3 className="text-xl font-semibold text-[var(--ink)]">{form.name || 'Your Clinic Name'}</h3>
                  </div>
                  
                  {form.address && (
                    <div className="flex items-start gap-2 text-sm text-[var(--muted)]">
                      <svg className="w-4 h-4 shrink-0 mt-0.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"></path><circle cx="12" cy="10" r="3"></circle></svg>
                      <p className="whitespace-pre-line">{form.address}</p>
                    </div>
                  )}
                  
                  <div className="flex flex-wrap gap-x-6 gap-y-2 mt-4 pt-4 border-t border-[var(--border)] text-sm">
                    {form.phone && (
                      <div className="flex items-center gap-2 text-[var(--muted)]">
                        <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z"></path></svg>
                        <span className="text-[var(--ink)] font-medium">{form.phone}</span>
                      </div>
                    )}
                    {form.email && (
                      <div className="flex items-center gap-2 text-[var(--muted)]">
                        <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"></path><polyline points="22,6 12,13 2,6"></polyline></svg>
                        <span className="text-[var(--ink)] font-medium">{form.email}</span>
                      </div>
                    )}
                    <div className="flex items-center gap-2 text-[var(--muted)] ml-auto">
                      <span>Patient ID Prefix:</span>
                      <span className="font-mono text-xs font-semibold text-[var(--ink)] bg-[var(--paper)] border border-[var(--border)] px-1.5 py-0.5 rounded shadow-sm">{form.walkInMrnoPrefix || 'W'}</span>
                    </div>
                  </div>
                </div>
              </div>

              {signaturePreviewUrl && (
                <div className="pt-4 border-t border-[var(--border)]">
                  {signaturePreviewUrl && (
                    <div className="flex items-center gap-3">
                      <img src={signaturePreviewUrl} className="h-10 w-20 object-contain rounded border border-[var(--border)] p-1 bg-white" alt="Signature" />
                      <div>
                        <div className="text-hint font-semibold text-[var(--muted)]">Authorized Signature</div>
                        <div className="text-[var(--ink)] font-medium">Included on invoices</div>
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          ) : (
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
          )}


          {editing && (
            <SectionSaveBar
              dirty={dirty}
              saved={saved}
              busy={busy}
              onSave={() => void saveProfile()}
              onCancel={() => {
                cancel();
                setEditing(false);
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

type ClinicRegionFields = Pick<Clinic, 'timezone' | 'defaultCountryCode' | 'agendaEnabled' | 'agendaHour'>;

/** Time zone and phone country code: what every server-sent time and every new phone number starts from. */
/** Evening hours offered for the agenda email (clinic time). */
const AGENDA_HOURS = [16, 17, 18, 19, 20, 21, 22];

const hourLabel = (hour: number) => `${hour % 12 === 0 ? 12 : hour % 12}:00 ${hour < 12 ? 'am' : 'pm'}`;

export function ClinicRegionSection({ onDirtyChange }: { onDirtyChange: (dirty: boolean) => void }) {
  const { form, set, save, cancel, dirty, saved, busy, error } = useClinicSectionForm<ClinicRegionFields>(
    (c) => ({ timezone: clinicTimezone(c), defaultCountryCode: clinicCountryCode(c), agendaEnabled: c.agendaEnabled !== false, agendaHour: c.agendaHour ?? 20 }),
    onDirtyChange
  );
  const [editing, setEditing] = useState(false);
  useEffect(() => {
    if (editing && saved && !dirty) setEditing(false);
  }, [editing, saved, dirty]);
  const zones = useMemo(() => {
    const all = timezoneOptions();
    return form.timezone && !all.includes(form.timezone) ? [form.timezone, ...all] : all;
  }, [form.timezone]);

  return (
    <div className="mt-6">
      <SectionCard
        id="settings-card-region"
        title="Region and agenda"
        action={editing ? undefined : <SetOnceEditButton label="Edit region" onClick={() => setEditing(true)} />}
      >
        <fieldset disabled={!editing} className="contents">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
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
          </div>
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
  const { form, set, save, cancel, dirty, saved, busy, error, setError } =
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
  const [editing, setEditing] = useState(false);
  // What is wrong with the hours as typed (a second session that starts before the first ends, ...): Save refuses until it is fixed.
  const [hoursProblem, setHoursProblem] = useState<string | null>(null);
  useEffect(() => {
    if (editing && saved && !dirty) setEditing(false);
  }, [editing, saved, dirty]);
  async function saveHours() {
    if (hoursProblem) {
      setError(hoursProblem);
      return;
    }
    await save();
  }

  return (
    <div className="mt-6">
      <SectionCard
        id="settings-card-booking-hours"
        title="Hours & closures"
        action={editing ? undefined : <SetOnceEditButton label="Edit hours & closures" onClick={() => setEditing(true)} />}
      >
        <fieldset disabled={!editing} className="contents">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="sm:col-span-2">
              <p className="mb-1 text-xs font-medium text-[var(--muted)]">
                Open days
                <InfoTip text="The days the clinic is open every week. Holidays and one-off closures are set on the Schedule." />
              </p>
              <OpenDaysStrip closedWeekdays={form.closedWeekdays ?? []} disabled={!editing} onChange={(closedWeekdays) =>
                  set({ closedWeekdays, ...(form.operatingHours ? { operatingHours: withOpenDays(form.operatingHours, closedWeekdays) } : {}) })
                }
              />
            </div>

            <div className="sm:col-span-2">
              <OperatingHoursEditor
                editing={editing}
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
        {editing && (
          <SectionSaveBar
            dirty={dirty}
            saved={saved}
            busy={busy}
            onSave={() => void saveHours()}
            onCancel={() => {
              cancel();
              setHoursProblem(null);
              setEditing(false);
            }}
            error={error}
          />
        )}
      </SectionCard>
    </div>
  );
}

type ClinicalDocsFields = Pick<Clinic, 'clinicalDocsEnabled'>;

/** Clinical notes on visits. Not billing-shaped: it lives on General so a plan without invoicing can still reach it. */
export function ClinicalDocsSection({ onDirtyChange }: { onDirtyChange: (dirty: boolean) => void }) {
  const { form, set, save, cancel, dirty, saved, busy, error } = useClinicSectionForm<ClinicalDocsFields>(
    (c) => ({ clinicalDocsEnabled: c.clinicalDocsEnabled ?? false }),
    onDirtyChange
  );
  const [editing, setEditing] = useState(false);
  useEffect(() => {
    if (editing && saved && !dirty) setEditing(false);
  }, [editing, saved, dirty]);

  return (
    <div className="mt-6">
      <SectionCard
        id="settings-card-clinical-docs"
        title="Clinical notes"
        action={editing ? undefined : <SetOnceEditButton label="Edit clinical notes" onClick={() => setEditing(true)} />}
      >
        <fieldset disabled={!editing} className="contents">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field
              label={
                <>
                  Clinical documentation module
                  <InfoTip text="Enables clinical notes for visits. When off, therapists can still access notes from a patient's profile, but visit workflows won't prompt for them." />
                </>
              }
            >
              <BoolToggle value={form.clinicalDocsEnabled ?? false} onChange={(v) => set({ clinicalDocsEnabled: v })} />
            </Field>
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
            error={error}
          />
        )}
      </SectionCard>
    </div>
  );
}

type PaymentsFields = Pick<Clinic, 'defaultPaymentMethod'>;

/**
 * What payment screens start with. Who collects patient payments, for a clinic with a partner, is set in
 * Billing → Partner & split; here it only locks the default to "Collected by {partner}" when the partner collects.
 * On General (not Billing) so every plan reaches it.
 */
export function PaymentsSection({ onDirtyChange }: { onDirtyChange: (dirty: boolean) => void }) {
  const { clinic, form, set, save, cancel, dirty, saved, busy, error } = useClinicSectionForm<PaymentsFields>(
    (c) => ({ defaultPaymentMethod: c.defaultPaymentMethod ?? null }),
    onDirtyChange
  );
  const [editing, setEditing] = useState(false);
  useEffect(() => {
    if (editing && saved && !dirty) setEditing(false);
  }, [editing, saved, dirty]);
  const hasPartner = Boolean(clinic.hasPartner);
  const partnerCollects = hasPartner && Boolean(clinic.partnerCollects);
  const options = paymentMethodOptions(clinic);
  const name = partnerName(clinic);

  return (
    <div className="mt-6">
      <SectionCard
        id="settings-card-payments"
        title="Payments"
        action={editing ? undefined : <SetOnceEditButton label="Edit payments" onClick={() => setEditing(true)} />}
      >
        <fieldset disabled={!editing} className="contents">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field
              label={
                <>
                  Default payment method
                  <InfoTip text="What New Visit, Take payment and Record advance start with. Staff can still pick another method on any payment." />
                </>
              }
            >
              <select
                className={inputCls}
                disabled={partnerCollects}
                value={partnerCollects ? 'partner' : (form.defaultPaymentMethod ?? '')}
                onChange={(e) => set({ defaultPaymentMethod: (e.target.value || null) as PaymentMethod | null })}
              >
                {partnerCollects ? (
                  <option value="partner">{paymentMethodLabel('partner', clinic)}</option>
                ) : (
                  <>
                    <option value="">Last one used on this device</option>
                    {options.map((o) => (
                      <option key={o.value} value={o.value}>
                        {o.label}
                      </option>
                    ))}
                  </>
                )}
              </select>
              {partnerCollects && (
                <p className="mt-1 text-hint text-[var(--muted)]">
                  {name} collects patient payments. Change that in Billing → Partner &amp; split.
                </p>
              )}
            </Field>
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
            error={error}
          />
        )}
      </SectionCard>
    </div>
  );
}
