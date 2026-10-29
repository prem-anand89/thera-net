import { COUNTRY_CODES } from '@/domain/countryCodes';
import { clinicCountryCode, clinicTimezone, timezoneHint, timezoneOptions } from '@/domain/clinicRegion';
import { PhoneField } from '@/components/PhoneField';
import { useEffect, useMemo, useState } from 'react';
import { visitService } from '@/services';
import { getSupabase, publicLogoUrl } from '@/lib/supabase';
import { type Clinic, type PaymentMethod } from '@/domain/types';
import { paymentMethodLabel, paymentMethodOptions, partnerName } from '@/domain/paymentMethods';
import { Field, inputCls, SectionCard, InfoTip } from '@/components/ui';
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
  | 'clinicType'
  | 'hasPartner'
  | 'partnerHospitalName'
  | 'partnerHospitalLogoPath'
  | 'signaturePath'

  | 'lastSplitChangeAt'
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
        clinicType: c.clinicType,
        hasPartner: c.hasPartner,
        partnerHospitalName: c.partnerHospitalName,
        partnerHospitalLogoPath: c.partnerHospitalLogoPath,
        signaturePath: c.signaturePath,
      }),
      onDirtyChange
    );
  const [editing, setEditing] = useState(false);
  useEffect(() => {
    if (editing && saved && !dirty) setEditing(false);
  }, [editing, saved, dirty]);
  const logoPreviewUrl = publicLogoUrl(form.logoPath);
  const partnerLogoPreviewUrl = publicLogoUrl(form.partnerHospitalLogoPath);
  const signaturePreviewUrl = publicLogoUrl(form.signaturePath);
  const [recomputeMsg, setRecomputeMsg] = useState<string | null>(null);

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

  async function uploadPartnerLogo(file: File) {
    setError(null);
    const supabase = getSupabase();
    if (!supabase || !navigator.onLine) {
      setError('Logo upload needs a connection.');
      return;
    }
    const path = `${clinic.id}/partner-logo-${Date.now()}.${file.name.split('.').pop()}`;
    const { error: uploadError } = await supabase.storage.from('clinic-assets').upload(path, file);
    if (uploadError) {
      setError(`Upload failed: ${toFriendlyMessage(uploadError)}`);
      return;
    }
    await saveFieldNow({ partnerHospitalLogoPath: path } as Partial<ProfileFields>);
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
    setRecomputeMsg(null);
    const splitAffected = form.clinicType !== clinic.clinicType;
    const ok = await save();
    if (ok && splitAffected) {
      await saveFieldNow({ lastSplitChangeAt: new Date().toISOString() });
      try {
        const { updated } = await visitService.recomputeUninvoicedSplits(clinic.id);
        setRecomputeMsg(
          updated > 0
            ? `Applied the updated split to ${updated} already-logged, not-yet-invoiced visit${updated === 1 ? '' : 's'}.`
            : null
        );
      } catch (e) {
        setError(toFriendlyMessage(e));
      }
    }
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
                    <span className="rounded-full bg-[var(--surface)] border border-[var(--border)] px-2.5 py-0.5 text-[11px] font-medium text-[var(--muted)]">
                      {form.clinicType === 'individual' ? 'Single Therapist' : 'Multiple Therapists'}
                    </span>
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

              {(clinic.hasPartner || signaturePreviewUrl) && (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6 pt-4 border-t border-[var(--border)]">
                  {clinic.hasPartner && clinic.partnerHospitalName && (
                    <div className="flex items-center gap-3">
                      {partnerLogoPreviewUrl && (
                        <img src={partnerLogoPreviewUrl} className="h-10 w-10 object-contain rounded border border-[var(--border)] p-1 bg-white" alt="Partner Logo" />
                      )}
                      <div>
                        <div className="text-[11px] font-semibold text-[var(--muted)]">Partner Organization</div>
                        <div className="text-[var(--ink)] font-medium">{clinic.partnerHospitalName}</div>
                      </div>
                    </div>
                  )}
                  {signaturePreviewUrl && (
                    <div className="flex items-center gap-3 md:border-l md:border-[var(--border)] md:pl-6">
                      <img src={signaturePreviewUrl} className="h-10 w-20 object-contain rounded border border-[var(--border)] p-1 bg-white" alt="Signature" />
                      <div>
                        <div className="text-[11px] font-semibold text-[var(--muted)]">Authorized Signature</div>
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
                    <label className="cursor-pointer text-[11px] font-semibold text-[var(--teal)] hover:underline">
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
                        <label className="block text-[11px] font-semibold text-[var(--muted)] mb-1.5">Clinic Name</label>
                        <input 
                          className={inputCls} 
                          value={form.name} 
                          onChange={(e) => set({ name: e.target.value })} 
                          placeholder="Your Clinic Name" 
                        />
                      </div>
                      <div className="w-40">
                        <label className="block text-[11px] font-semibold text-[var(--muted)] mb-1.5">Therapist Setup</label>
                        <select 
                          className={inputCls} 
                          value={form.clinicType ?? 'multiple'} 
                          onChange={(e) => set({ clinicType: e.target.value as Clinic['clinicType'] })}
                        >
                          <option value="individual">Single Therapist</option>
                          <option value="multiple">Multiple Therapists</option>
                        </select>
                      </div>
                    </div>
                    
                    <div>
                      <label className="block text-[11px] font-semibold text-[var(--muted)] mb-1.5">Address</label>
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
                        <label className="block text-[11px] font-semibold text-[var(--muted)] mb-1.5">Phone</label>
                        <PhoneField
                          value={form.phone ?? ''}
                          onChange={(phone) => set({ phone: phone || null })}
                          ariaLabel="Clinic phone"
                        />
                      </div>
                      <div className="flex-1 min-w-[180px]">
                        <label className="block text-[11px] font-semibold text-[var(--muted)] mb-1.5">Email</label>
                        <input 
                          className={inputCls} 
                          value={form.email ?? ''} 
                          onChange={(e) => set({ email: e.target.value || null })} 
                          placeholder="Email address" 
                        />
                      </div>
                      <div className="w-28">
                        <label className="block text-[11px] font-semibold text-[var(--muted)] mb-1.5 flex items-center gap-1">
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

                <div className="grid grid-cols-1 md:grid-cols-2 gap-8 pt-6 border-t border-[var(--border)]">
                  {/* Partner Column */}
                  <div>
                    <div className="flex items-center gap-2 mb-4">
                      <input 
                        type="checkbox" 
                        id="hasPartner" 
                        checked={form.hasPartner ?? false} 
                        onChange={(e) => set({ hasPartner: e.target.checked })} 
                        className="rounded border-[var(--border)] text-[var(--teal)] focus:ring-[var(--teal)]" 
                      />
                      <label htmlFor="hasPartner" className="text-sm font-medium text-[var(--ink)]">Has Partner Organization</label>
                    </div>
                    {form.hasPartner && (
                      <div className="flex flex-col sm:flex-row gap-4 items-start bg-[var(--surface)] p-3 rounded-lg border border-[var(--border)]">
                        <div className="shrink-0 flex flex-col items-center gap-2">
                          {partnerLogoPreviewUrl ? (
                            <img 
                              src={partnerLogoPreviewUrl} 
                              alt="Partner logo" 
                              className="h-14 w-14 object-contain rounded border border-[var(--border)] bg-white p-1 shadow-sm" 
                            />
                          ) : (
                            <div className="h-14 w-14 rounded bg-white border border-[var(--border)] shadow-sm flex items-center justify-center text-[var(--muted)] text-[10px]">
                              None
                            </div>
                          )}
                          <label className="cursor-pointer text-[10px] font-semibold text-[var(--teal)] hover:underline">
                            Upload logo
                            <input 
                              type="file" 
                              accept="image/*" 
                              className="hidden" 
                              onChange={(e) => e.target.files?.[0] && void uploadPartnerLogo(e.target.files[0])} 
                            />
                          </label>
                        </div>
                        <div className="flex-1 w-full">
                          <label className="block text-[11px] font-semibold text-[var(--muted)] mb-1.5">Partner Name</label>
                          <input 
                            className={inputCls} 
                            value={form.partnerHospitalName ?? ''} 
                            onChange={(e) => set({ partnerHospitalName: e.target.value || null })} 
                            placeholder="e.g. City Hospital" 
                          />
                        </div>
                      </div>
                    )}
                  </div>

                  {/* Signature Column */}
                  <div>
                    <label className="block text-[11px] font-semibold text-[var(--muted)] mb-2">Authorized Signature</label>
                    <p className="text-[11px] text-[var(--muted)] mb-4 leading-relaxed">
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
                        <div className="h-16 w-32 rounded bg-white border border-[var(--border)] shadow-sm flex items-center justify-center text-[var(--muted)] text-[10px]">
                          No signature
                        </div>
                      )}
                      <label className="cursor-pointer text-[11px] font-semibold text-[var(--teal)] hover:underline">
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

              {recomputeMsg && <p className="mt-4 text-xs text-[var(--moss)]">{recomputeMsg}</p>}
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
            partnerHospitalName: clinic.partnerHospitalName
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
              <span className="mt-1 block text-[11px] text-[var(--muted)]">{timezoneHint(form.timezone ?? 'Asia/Kolkata')}</span>
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
  | 'staffBookingBufferHours'
  | 'closedWeekdays'
  | 'slotDurationMinutes'
  | 'startStepMinutes'
>;

export function ClinicHoursSection({ onDirtyChange }: { onDirtyChange: (dirty: boolean) => void }) {
  const { form, set, save, cancel, dirty, saved, busy, error } =
    useClinicSectionForm<ClinicHoursFields>(
      (c) => ({
        bookingStartHour: c.bookingStartHour ?? 9,
        bookingEndHour: c.bookingEndHour ?? 17,
        staffBookingBufferHours: c.staffBookingBufferHours ?? 3,
        closedWeekdays: c.closedWeekdays ?? [],
        slotDurationMinutes: c.slotDurationMinutes ?? 30,
        startStepMinutes: c.startStepMinutes ?? null,
      }),
      onDirtyChange
    );
  const [editing, setEditing] = useState(false);
  useEffect(() => {
    if (editing && saved && !dirty) setEditing(false);
  }, [editing, saved, dirty]);

  return (
    <div className="mt-6">
      <SectionCard
        id="settings-card-booking-hours"
        title="Hours & closures"
        action={editing ? undefined : <SetOnceEditButton label="Edit hours & closures" onClick={() => setEditing(true)} />}
      >
        <fieldset disabled={!editing} className="contents">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field
              label={
                <>
                  Clinic operating hours
                  <InfoTip text="The earliest and latest times your clinic is open for appointments and therapist shifts." />
                </>
              }
            >
              <div className="flex items-center gap-2">
                <select
                  className={inputCls}
                  value={form.bookingStartHour ?? 9}
                  onChange={(e) => set({ bookingStartHour: parseInt(e.target.value, 10) })}
                >
                  {Array.from({ length: 24 }).map((_, i) => (
                    <option key={`start-${i}`} value={i}>
                      {i === 0 ? '12:00 AM' : i < 12 ? `${i}:00 AM` : i === 12 ? '12:00 PM' : `${i - 12}:00 PM`}
                    </option>
                  ))}
                </select>
                <span className="text-xs text-[var(--muted)]">to</span>
                <select
                  className={inputCls}
                  value={form.bookingEndHour ?? 17}
                  onChange={(e) => set({ bookingEndHour: parseInt(e.target.value, 10) })}
                >
                  {Array.from({ length: 24 }).map((_, i) => (
                    <option key={`end-${i}`} value={i}>
                      {i === 0 ? '12:00 AM' : i < 12 ? `${i}:00 AM` : i === 12 ? '12:00 PM' : `${i - 12}:00 PM`}
                    </option>
                  ))}
                </select>
              </div>
            </Field>

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
              label={
                <>
                  Start times every
                  <InfoTip text="How often staff can start an appointment on the schedule and in the booking sheet, e.g. every 15 minutes with 60-minute appointments. Online booking for patients keeps the appointment duration." />
                </>
              }
              htmlFor="clinic-start-step"
            >
              <select
                id="clinic-start-step"
                className={inputCls}
                value={form.startStepMinutes ?? ''}
                onChange={(e) => set({ startStepMinutes: e.target.value ? Number(e.target.value) : null })}
              >
                <option value="">Same as duration ({form.slotDurationMinutes ?? 30} min)</option>
                <option value={15}>15 minutes</option>
                <option value={30}>30 minutes</option>
              </select>
              {!form.startStepMinutes && (form.slotDurationMinutes ?? 30) >= 60 && (
                <p className="mt-1.5 flex flex-wrap items-center gap-x-2 text-xs text-[var(--amber)]" data-testid="start-step-hint">
                  With {form.slotDurationMinutes}-minute appointments, times start on the hour, so a break or an appointment that ends at :30 leaves
                  half an hour nobody can book.
                  <button type="button" className="font-medium text-[var(--teal)] underline" onClick={() => set({ startStepMinutes: 30 })}>
                    Use 30 minutes
                  </button>
                </p>
              )}
            </Field>

            <div>
              <label htmlFor="staff-booking-buffer" className="mb-1 block text-xs font-medium text-[var(--muted)]">
                Staff booking buffer (hours)
              </label>
              <input
                id="staff-booking-buffer"
                type="number"
                min={0}
                max={12}
                step={1}
                inputMode="numeric"
                className={inputCls}
                value={form.staffBookingBufferHours ?? 3}
                onChange={(e) => {
                  const val = parseInt(e.target.value, 10);
                  if (Number.isNaN(val)) return;
                  set({ staffBookingBufferHours: clampBufferHours(val) });
                }}
              />
              <span className="mt-1 block text-[11px] text-[var(--muted)]">
                Staff can book up to this many hours before opening and after closing. 0 = clinic hours only. Patients on the public page are still limited to clinic hours.
              </span>
            </div>

            <div className="sm:col-span-2">
              <Field
                label={
                  <>
                    Weekly closed days
                    <InfoTip text="Select the regular recurring days of the week when the clinic is closed." />
                  </>
                }
              >
                <div className="flex flex-wrap gap-2 pt-1">
                  {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((day, idx) => {
                    const isClosed = form.closedWeekdays?.includes(idx);
                    return (
                      <button
                        key={idx}
                        type="button"
                        disabled={!editing}
                        className={`rounded-full border px-3 py-1 text-xs font-medium transition-colors ${
                          isClosed
                            ? 'bg-[var(--rust)] border-[var(--rust)] text-white shadow-sm'
                            : 'bg-white border-[var(--border)] text-[var(--ink)] hover:border-[var(--rust)]'
                        } ${!editing ? 'cursor-default opacity-85' : 'cursor-pointer'}`}
                        onClick={() => {
                          const current = form.closedWeekdays || [];
                          if (isClosed) {
                            set({ closedWeekdays: current.filter((d) => d !== idx) });
                          } else {
                            set({ closedWeekdays: [...current, idx].sort() });
                          }
                        }}
                      >
                        {day}
                      </button>
                    );
                  })}
                </div>
              </Field>
            </div>
          </div>
        </fieldset>
        <p className="mt-3 text-xs text-[var(--muted)]">
          Holidays, one-off closures, and individual therapist shift overrides are managed directly on the{' '}
          <span className="font-medium text-[var(--ink)]">Schedule</span> calendar.
        </p>
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

type PaymentsFields = Pick<Clinic, 'partnerCollects' | 'defaultPaymentMethod'>;

/**
 * What payment screens start with, and — for a clinic with a partner — who collects the patient's money.
 * On General (not Billing) so every plan reaches it.
 */
export function PaymentsSection({ onDirtyChange }: { onDirtyChange: (dirty: boolean) => void }) {
  const { clinic, form, set, save, cancel, dirty, saved, busy, error } = useClinicSectionForm<PaymentsFields>(
    (c) => ({ partnerCollects: c.partnerCollects ?? false, defaultPaymentMethod: c.defaultPaymentMethod ?? null }),
    onDirtyChange
  );
  const [editing, setEditing] = useState(false);
  useEffect(() => {
    if (editing && saved && !dirty) setEditing(false);
  }, [editing, saved, dirty]);
  const hasPartner = Boolean(clinic.hasPartner);
  const partnerCollects = hasPartner && Boolean(form.partnerCollects);
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
            {hasPartner && (
              <Field
                label={
                  <>
                    Who collects patient payments?
                    <InfoTip text="We do: patients pay the clinic and you settle the partner's share. The partner does: patients pay at the partner's counter and the partner settles with you. Either way you can change it on a single visit." />
                  </>
                }
              >
                <BoolToggle
                  value={partnerCollects}
                  onChange={(v) => set({ partnerCollects: v })}
                  offLabel="We do"
                  onLabel={`${name} does`}
                />
              </Field>
            )}
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
