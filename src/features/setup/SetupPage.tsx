import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link } from '@tanstack/react-router';
import { useLiveQuery } from 'dexie-react-hooks';
import { repos, backupService, therapistService } from '@/services';
import type { BackupBundle, RestoreSummary } from '@/services/backupService';
import { useClinic } from '@/app/clinicContext';
import { usePermissions } from '@/app/usePermissions';
import { getSupabase } from '@/lib/supabase';
import { SUPABASE_URL } from '@/lib/env';
import { db } from '@/lib/db';
import { formatINR } from '@/domain/money';
import {
  clinicShareLabels,
  effectivePricePerSession,
  type CatalogItem,
  type Clinic,
  type Therapist,
} from '@/domain/types';
import type { TdsBasis } from '@/domain/split';
import {
  Field,
  inputCls,
  btnPrimary,
  btnSecondary,
  ErrorNote,
  RupeeInput,
  SectionCard,
  th,
  thNum,
  td,
  tdNum,
  InfoTip,
} from '@/components/ui';
import { toFriendlyMessage } from '@/lib/errors';

type SectionKey = 'profile' | 'billing' | 'partner' | 'team' | 'services' | 'features' | 'data';

/**
 * Grouped into the three jobs an admin actually comes here to do, rather
 * than one flat list of eight peers where "Clinic profile" and "Danger
 * zone" sat at the same level. Data and Danger zone also merged into one
 * "Data & maintenance" section — import, backup/restore, cache reset, and
 * wipe are all the same occasional-maintenance job, and splitting them
 * meant an admin looking for "restore a backup" had to guess which of two
 * adjacent tabs held it.
 */
const SECTION_GROUPS: { label: string; keys: SectionKey[] }[] = [
  { label: 'Clinic', keys: ['profile', 'billing', 'partner'] },
  { label: 'People & services', keys: ['team', 'services'] },
  { label: 'System', keys: ['features', 'data'] },
];

const SECTIONS: { key: SectionKey; label: string; description: string }[] = [
  { key: 'profile', label: 'Clinic profile', description: 'Name, address, contact info, logo, walk-in ID prefix.' },
  {
    key: 'billing',
    label: 'Billing & invoicing',
    description: 'Invoice numbering, GST/tax ID, fiscal year, who can bill.',
  },
  {
    key: 'partner',
    label: 'Partner & split',
    description: 'Revenue share with a partner hospital, therapist splits, TDS.',
  },
  { key: 'team', label: 'Team', description: 'Invite and manage logins, therapist roster.' },
  { key: 'services', label: 'Services', description: 'Catalog of billable services and package prices.' },
  { key: 'features', label: 'Features', description: 'Optional modules — Expected today, clinical notes, comparison chart.' },
  {
    key: 'data',
    label: 'Data & maintenance',
    description: 'Import historical visits, back up or restore, reset this device, wipe clinic data.',
  },
];

// Same two-lists-must-agree guard as the note editor's jump-nav.
if (SECTION_GROUPS.flatMap((g) => g.keys).length !== SECTIONS.length) {
  throw new Error('SECTION_GROUPS is out of sync with SECTIONS');
}

/** Only add/remove `key` if that actually changes membership — keeps the
 *  Set reference stable across no-op updates so dirty-tracking effects
 *  downstream don't re-fire needlessly. */
function toggleSet<T>(set: Set<T>, key: T, present: boolean): Set<T> {
  if (present === set.has(key)) return set;
  const next = new Set(set);
  if (present) next.add(key);
  else next.delete(key);
  return next;
}

export function SetupPage() {
  const { canEditSettings } = usePermissions();
  const [activeKey, setActiveKey] = useState<SectionKey>('profile');
  const [dirtyKeys, setDirtyKeys] = useState<Set<SectionKey>>(new Set());

  // Left-rail sections that edit the clinic row report their dirty state up
  // here, so switching tabs with unsaved changes can warn before discarding
  // them — the risk splitting one big form into independently-saved
  // sections actually introduces (there was nowhere to "navigate away to"
  // before). Team/Services/Data/Danger zone act immediately per row/button
  // and never register as dirty.
  const setProfileDirty = useCallback((d: boolean) => setDirtyKeys((s) => toggleSet(s, 'profile', d)), []);
  const setBillingDirty = useCallback((d: boolean) => setDirtyKeys((s) => toggleSet(s, 'billing', d)), []);
  const setPartnerDirty = useCallback((d: boolean) => setDirtyKeys((s) => toggleSet(s, 'partner', d)), []);
  const setFeaturesDirty = useCallback((d: boolean) => setDirtyKeys((s) => toggleSet(s, 'features', d)), []);

  function selectSection(key: SectionKey) {
    if (key === activeKey) return;
    if (
      dirtyKeys.has(activeKey) &&
      !confirm('This section has unsaved changes. Discard them and switch?')
    ) {
      return;
    }
    setActiveKey(key);
  }

  // Nav already hides the Settings link for non-admins (`Shell.tsx`); this
  // guard covers a direct URL hit (old bookmark, typed link) instead of
  // silently rendering the full clinic-configuration form. The real access
  // boundary is RLS on `clinics`/`therapists`/`service_catalog` — this is
  // just so a non-admin doesn't see a form that would fail to save.
  if (!canEditSettings) {
    return (
      <div className="space-y-4">
        <h1 className="font-display text-lg font-semibold text-[var(--ink)]">Settings</h1>
        <p className="text-sm text-[var(--muted)]">
          Settings are managed by your clinic admin.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <h1 className="font-display text-lg font-semibold text-[var(--ink)]">Settings</h1>

      <div className="tab:flex tab:items-start tab:gap-6">
        {/* Horizontal scroller at the top below tab: (Shell's own bottom
            tab bar owns the bottom of the viewport now — a second bar down
            there would compete with it), vertical rail at tab: and above.
            Group headings only render in that rail; the horizontal
            scroller stays a flat row, where headings would just eat scroll
            width. */}
        <nav className="mb-4 flex gap-1 overflow-x-auto tab:mb-0 tab:w-48 tab:shrink-0 tab:flex-col tab:gap-0.5 tab:overflow-visible">
          {SECTION_GROUPS.map((group) => (
            <div key={group.label} className="contents tab:mb-1.5 tab:block">
              <p className="hidden px-3 pb-1 pt-1.5 text-[10px] font-bold uppercase tracking-wider text-[var(--muted)]/70 tab:block">
                {group.label}
              </p>
              {group.keys.map((key) => {
                const s = SECTIONS.find((x) => x.key === key)!;
                return (
                  <button
                    key={s.key}
                    type="button"
                    onClick={() => selectSection(s.key)}
                    className={`shrink-0 whitespace-nowrap rounded-md px-3 py-2 text-left text-sm font-medium tab:block tab:w-full ${
                      activeKey === s.key
                        ? 'bg-[var(--teal-light)] text-[var(--teal)]'
                        : 'text-[var(--muted)] hover:bg-[var(--paper)]'
                    }`}
                  >
                    {s.label}
                    {dirtyKeys.has(s.key) && <span className="ml-1.5 text-[var(--rust)]">•</span>}
                  </button>
                );
              })}
            </div>
          ))}
        </nav>

        <div className="min-w-0 flex-1 space-y-6">
          {/* Tailwind v4's space-y-6 applies margin-bottom to this <p> (not
              margin-top to the next sibling, unlike v3) via a zero-specificity
              :where() rule — a same-element margin class here doesn't add to
              that, it overrides it outright. The old `-mb-2` therefore wasn't
              "8px less than the 24px default," it replaced the 24px with a
              literal -8px, pulling the card's border up into the text. */}
          <p className="mb-2 text-xs text-[var(--muted)]">
            {SECTIONS.find((s) => s.key === activeKey)?.description}
          </p>
          {activeKey === 'profile' && <ClinicProfileSection onDirtyChange={setProfileDirty} />}
          {activeKey === 'billing' && <BillingSection onDirtyChange={setBillingDirty} />}
          {activeKey === 'partner' && <PartnerSection onDirtyChange={setPartnerDirty} />}
          {activeKey === 'team' && <Therapists />}
          {activeKey === 'services' && <Catalog />}
          {activeKey === 'features' && <FeaturesSection onDirtyChange={setFeaturesDirty} />}
          {activeKey === 'data' && (
            <>
              <HistoricalData />
              <DataBackup />
              <DangerZone />
            </>
          )}
        </div>
      </div>
    </div>
  );
}

/**
 * Shared save mechanics for a section that edits a slice of the Clinic row.
 * Re-fetches the current row at save time and merges just this section's
 * fields into it, rather than writing back a form snapshot that could be
 * stale for fields another section owns — the Clinic row has no partial-
 * patch API, so a naive "write the whole form" save would silently revert
 * whatever another section saved in between.
 */
function useClinicSectionForm<F extends Partial<Clinic>>(
  pick: (clinic: Clinic) => F,
  onDirtyChange: (dirty: boolean) => void
) {
  const clinic = useClinic();
  const initial = useMemo(() => pick(clinic), [clinic]); // eslint-disable-line react-hooks/exhaustive-deps
  const [form, setForm] = useState<F>(initial);
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => setForm(initial), [initial]);

  const dirty = useMemo(() => JSON.stringify(form) !== JSON.stringify(initial), [form, initial]);
  // Cleanup clears the flag on unmount too — switching tabs away from a
  // dirty section (after confirming the discard) unmounts it, and without
  // this the rail's dot would keep showing dirty for a section that no
  // longer has any unsaved state to lose.
  useEffect(() => {
    onDirtyChange(dirty);
    return () => onDirtyChange(false);
  }, [dirty, onDirtyChange]);

  function set(patch: Partial<F>) {
    setSaved(false);
    setForm((f) => ({ ...f, ...patch }));
  }

  async function save() {
    setError(null);
    setBusy(true);
    try {
      const current = await repos.clinics.get(clinic.id);
      if (!current) throw new Error('Clinic not found');
      await repos.clinics.put({ ...current, ...form, updatedAt: new Date().toISOString() });
      setSaved(true);
    } catch (e) {
      setError(toFriendlyMessage(e));
    } finally {
      setBusy(false);
    }
  }

  function cancel() {
    setForm(initial);
    setError(null);
  }

  /** Writes one field immediately (e.g. after a logo upload finishes) and
   *  folds it into local state so the dirty check doesn't flag it as an
   *  unsaved edit — it's already persisted. */
  async function saveFieldNow(patch: Partial<F>) {
    const current = await repos.clinics.get(clinic.id);
    if (!current) return;
    await repos.clinics.put({ ...current, ...patch, updatedAt: new Date().toISOString() });
    setForm((f) => ({ ...f, ...patch }));
  }

  return { clinic, form, set, save, cancel, saveFieldNow, dirty, saved, busy, error, setError };
}

function SectionSaveBar({
  dirty,
  saved,
  busy,
  onSave,
  onCancel,
  error,
}: {
  dirty: boolean;
  saved: boolean;
  busy: boolean;
  onSave: () => void;
  onCancel: () => void;
  error: string | null;
}) {
  return (
    <>
      <div className="mt-4 flex items-center gap-3">
        <button className={btnPrimary} disabled={busy || !dirty} onClick={onSave}>
          {busy ? 'Saving…' : 'Save'}
        </button>
        <button className={btnSecondary} disabled={!dirty} onClick={onCancel}>
          Cancel
        </button>
        {saved && !dirty && <span className="text-sm text-[var(--moss)]">Saved ✓</span>}
      </div>
      <div className="mt-2">
        <ErrorNote message={error} />
      </div>
    </>
  );
}

type ProfileFields = Pick<Clinic, 'name' | 'address' | 'phone' | 'email' | 'walkInMrnoPrefix' | 'logoPath'>;

function ClinicProfileSection({ onDirtyChange }: { onDirtyChange: (dirty: boolean) => void }) {
  const { clinic, form, set, save, cancel, saveFieldNow, dirty, saved, busy, error, setError } =
    useClinicSectionForm<ProfileFields>(
      (c) => ({ name: c.name, address: c.address, phone: c.phone, email: c.email, walkInMrnoPrefix: c.walkInMrnoPrefix, logoPath: c.logoPath }),
      onDirtyChange
    );

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

  return (
    <SectionCard title="Clinic profile">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <Field label="Clinic name">
          <input className={inputCls} value={form.name} onChange={(e) => set({ name: e.target.value })} />
        </Field>
        <Field
          label={
            <>
              Walk-in patient ID prefix
              <InfoTip text="Used for auto-generated Patient IDs when a walk-in has no existing ID (format: PREFIX-YYMMDD-XXX). Defaults to 'W'." />
            </>
          }
        >
          <input
            className={inputCls}
            placeholder="W"
            value={form.walkInMrnoPrefix ?? ''}
            onChange={(e) => set({ walkInMrnoPrefix: e.target.value.toUpperCase() || null })}
          />
        </Field>
        <Field label="Address">
          <input className={inputCls} value={form.address ?? ''} onChange={(e) => set({ address: e.target.value || null })} />
        </Field>
        <Field label="Phone">
          <input className={inputCls} value={form.phone ?? ''} onChange={(e) => set({ phone: e.target.value || null })} />
        </Field>
        <Field label="Email">
          <input className={inputCls} value={form.email ?? ''} onChange={(e) => set({ email: e.target.value || null })} />
        </Field>
        <Field label="Clinic logo">
          <input
            type="file"
            accept="image/*"
            className={inputCls}
            onChange={(e) => e.target.files?.[0] && void uploadLogo(e.target.files[0])}
          />
        </Field>
      </div>
      <SectionSaveBar dirty={dirty} saved={saved} busy={busy} onSave={() => void save()} onCancel={cancel} error={error} />
    </SectionCard>
  );
}

type BillingFields = Pick<Clinic, 'invoicePrefix' | 'gstNo' | 'fyStartMonth' | 'billingEnabled' | 'invoicingAccess'>;

function BillingSection({ onDirtyChange }: { onDirtyChange: (dirty: boolean) => void }) {
  const { form, set, save, cancel, dirty, saved, busy, error } = useClinicSectionForm<BillingFields>(
    (c) => ({
      invoicePrefix: c.invoicePrefix,
      gstNo: c.gstNo,
      fyStartMonth: c.fyStartMonth,
      billingEnabled: c.billingEnabled ?? true,
      invoicingAccess: c.invoicingAccess ?? 'everyone',
    }),
    onDirtyChange
  );

  return (
    <SectionCard title="Billing & invoicing">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <Field label="Invoice prefix">
          <input
            className={inputCls}
            value={form.invoicePrefix}
            onChange={(e) => set({ invoicePrefix: e.target.value.toUpperCase() })}
          />
        </Field>
        <Field
          label={
            <>
              GST / Tax ID (optional)
              <InfoTip text="Your clinic's tax registration number, printed on invoices. Not the same as the Tax/TDS % under Partner & split, which is a revenue-share percentage." />
            </>
          }
        >
          <input className={inputCls} value={form.gstNo ?? ''} onChange={(e) => set({ gstNo: e.target.value || null })} />
        </Field>
        <Field label="Fiscal year starts in month">
          <input
            type="number"
            min={1}
            max={12}
            className={inputCls}
            value={form.fyStartMonth}
            onChange={(e) => set({ fyStartMonth: Number(e.target.value) })}
          />
        </Field>
        <Field
          label={
            <>
              Billing module
              <InfoTip text="Off for clinics that bill entirely through a partner hospital's own system — hides Invoices everywhere, for everyone, regardless of role." />
            </>
          }
        >
          <select
            className={inputCls}
            value={form.billingEnabled ? 'yes' : 'no'}
            onChange={(e) => set({ billingEnabled: e.target.value === 'yes' })}
          >
            <option value="yes">On</option>
            <option value="no">Off</option>
          </select>
        </Field>
        {form.billingEnabled && (
          <Field
            label={
              <>
                Who can issue invoices
                <InfoTip text="Everyone: any team member can bill a visit. Front desk and admins only: therapists log visits and clinical notes; billing happens separately." />
              </>
            }
          >
            <select
              className={inputCls}
              value={form.invoicingAccess}
              onChange={(e) => set({ invoicingAccess: e.target.value as 'everyone' | 'billing_staff' })}
            >
              <option value="everyone">Everyone</option>
              <option value="billing_staff">Front desk and admins only</option>
            </select>
          </Field>
        )}
      </div>
      <SectionSaveBar dirty={dirty} saved={saved} busy={busy} onSave={() => void save()} onCancel={cancel} error={error} />
    </SectionCard>
  );
}

type PartnerFields = Pick<
  Clinic,
  | 'clinicType'
  | 'hasPartner'
  | 'enableTherapistSplit'
  | 'partnerHospitalName'
  | 'partnerHospitalLogoPath'
  | 'ownShareLabel'
  | 'partnerShareLabel'
  | 'bmSplitPct'
  | 'taxPct'
  | 'tdsBasis'
>;

// These fields are read together by clinicBillingConfig() to determine
// hospitalSplit/therapistSplit — kept in one section/save so they can never
// go out of sync with each other mid-edit.
function PartnerSection({ onDirtyChange }: { onDirtyChange: (dirty: boolean) => void }) {
  const { clinic, form, set, save, cancel, saveFieldNow, dirty, saved, busy, error, setError } =
    useClinicSectionForm<PartnerFields>(
      (c) => ({
        clinicType: c.clinicType,
        hasPartner: c.hasPartner,
        enableTherapistSplit: c.enableTherapistSplit,
        partnerHospitalName: c.partnerHospitalName,
        partnerHospitalLogoPath: c.partnerHospitalLogoPath,
        ownShareLabel: c.ownShareLabel,
        partnerShareLabel: c.partnerShareLabel,
        bmSplitPct: c.bmSplitPct,
        taxPct: c.taxPct,
        tdsBasis: c.tdsBasis,
      }),
      onDirtyChange
    );
  const labels = clinicShareLabels(form);

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
    await saveFieldNow({ partnerHospitalLogoPath: path } as Partial<PartnerFields>);
  }

  return (
    <SectionCard title="Partner & split">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <Field
          label={
            <>
              Therapist setup
              <InfoTip text="Individual: single therapist practice. Multiple: clinic with multiple therapists. This affects billing and reporting." />
            </>
          }
        >
          <select
            className={inputCls}
            value={form.clinicType ?? 'multiple'}
            onChange={(e) => set({ clinicType: e.target.value as Clinic['clinicType'] })}
          >
            <option value="individual">Individual Therapist</option>
            <option value="multiple">Multiple Therapists</option>
          </select>
        </Field>
        <Field
          label={
            <>
              Partner with therapist/external org
              <InfoTip text="Enable if your clinic partners with a therapist or external organization (hospital, etc.) for revenue sharing, tax deduction, or other arrangements." />
            </>
          }
        >
          <select
            className={inputCls}
            value={form.hasPartner ? 'yes' : 'no'}
            onChange={(e) => set({ hasPartner: e.target.value === 'yes' })}
          >
            <option value="no">No</option>
            <option value="yes">Yes</option>
          </select>
        </Field>
        <Field
          label={
            <>
              Track therapist splits
              <InfoTip text="Lets a visit's revenue be credited between two therapists (a Split action + Shared/Net report columns). Turn off if you don't attribute revenue across therapists." />
            </>
          }
        >
          <select
            className={inputCls}
            value={form.enableTherapistSplit === false ? 'no' : 'yes'}
            onChange={(e) => set({ enableTherapistSplit: e.target.value === 'yes' })}
          >
            <option value="no">No</option>
            <option value="yes">Yes</option>
          </select>
        </Field>
        {form.hasPartner && (
          <>
            <Field label="Partner name (prints on invoices if set)">
              <input
                className={inputCls}
                value={form.partnerHospitalName ?? ''}
                onChange={(e) => set({ partnerHospitalName: e.target.value || null })}
              />
            </Field>
            <Field label="Your share label (report column, e.g. BM)">
              <input
                className={inputCls}
                placeholder="BM"
                value={form.ownShareLabel ?? ''}
                onChange={(e) => set({ ownShareLabel: e.target.value || null })}
              />
            </Field>
            <Field label="Partner share label (report column, e.g. HV)">
              <input
                className={inputCls}
                placeholder="HV"
                value={form.partnerShareLabel ?? ''}
                onChange={(e) => set({ partnerShareLabel: e.target.value || null })}
              />
            </Field>
            <Field label={`Your share % (${labels.own} split)`}>
              <input
                type="number"
                className={inputCls}
                value={form.bmSplitPct}
                onChange={(e) => set({ bmSplitPct: Number(e.target.value) })}
              />
            </Field>
            <Field label="Partner logo">
              <input
                type="file"
                accept="image/*"
                className={inputCls}
                onChange={(e) => e.target.files?.[0] && void uploadPartnerLogo(e.target.files[0])}
              />
            </Field>
          </>
        )}
        <Field
          label={
            <>
              Tax / TDS % (optional)
              <InfoTip text="Tax Deducted at Source — the % withheld from payouts. Leave blank if not applicable. When enabled with a partner, TDS is calculated based on the TDS basis below." />
            </>
          }
        >
          <input
            type="number"
            className={inputCls}
            placeholder="0"
            value={form.taxPct ?? ''}
            onChange={(e) => set({ taxPct: e.target.value === '' ? 0 : Number(e.target.value) })}
          />
        </Field>
        {form.hasPartner && form.taxPct > 0 && (
          <Field
            label={
              <>
                TDS basis
                <InfoTip text="Whether the tax % is calculated on the full bill (matches most hospital sheets) or only on the clinic's own share. Both produce the same final clinic payout." />
              </>
            }
          >
            <select
              className={inputCls}
              value={form.tdsBasis}
              onChange={(e) => set({ tdsBasis: e.target.value as TdsBasis })}
            >
              <option value="gross_bill">{form.taxPct}% of gross bill (matches {labels.partner} sheet)</option>
              <option value="bm_share">On clinic share only</option>
            </select>
          </Field>
        )}
      </div>
      <p className="mt-3 text-xs text-[var(--muted)]">
        Split/tax changes apply to NEW visits only — past visits keep the rates they were billed under.
      </p>
      <SectionSaveBar dirty={dirty} saved={saved} busy={busy} onSave={() => void save()} onCancel={cancel} error={error} />
    </SectionCard>
  );
}

type FeaturesFields = Pick<Clinic, 'enableExpectedToday' | 'clinicalDocsEnabled' | 'showTherapistComparison'>;

function FeaturesSection({ onDirtyChange }: { onDirtyChange: (dirty: boolean) => void }) {
  const { form, set, save, cancel, dirty, saved, busy, error } = useClinicSectionForm<FeaturesFields>(
    (c) => ({
      enableExpectedToday: c.enableExpectedToday,
      clinicalDocsEnabled: c.clinicalDocsEnabled,
      showTherapistComparison: c.showTherapistComparison ?? false,
    }),
    onDirtyChange
  );

  return (
    <SectionCard title="Features">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <Field
          label={
            <>
              Expected today
              <InfoTip text="Shows a lightweight 'who's coming in today' list on Workspace, for clinics that track informal walk-in/appointment expectations. Not a booking system — no calendar, no availability checking." />
            </>
          }
        >
          <select
            className={inputCls}
            value={form.enableExpectedToday ? 'yes' : 'no'}
            onChange={(e) => set({ enableExpectedToday: e.target.value === 'yes' })}
          >
            <option value="no">No</option>
            <option value="yes">Yes</option>
          </select>
        </Field>
        <Field
          label={
            <>
              Clinical documentation
              <InfoTip text="When on, new visits are flagged for a clinical note until one is completed — surfaced on Workspace's Needs attention and Documentation lists. Off by default; turn on for clinics that track a note per visit." />
            </>
          }
        >
          <select
            className={inputCls}
            value={form.clinicalDocsEnabled ? 'yes' : 'no'}
            onChange={(e) => set({ clinicalDocsEnabled: e.target.value === 'yes' })}
          >
            <option value="no">No</option>
            <option value="yes">Yes</option>
          </select>
        </Field>
        <Field
          label={
            <>
              Therapist comparison chart
              <InfoTip text="When on, the Revenue and Visits comparison charts on Reports are visible to therapists too, not just admins — for clinics that want that competitive visibility. Off by default." />
            </>
          }
        >
          <select
            className={inputCls}
            value={form.showTherapistComparison ? 'yes' : 'no'}
            onChange={(e) => set({ showTherapistComparison: e.target.value === 'yes' })}
          >
            <option value="no">No</option>
            <option value="yes">Yes</option>
          </select>
        </Field>
      </div>
      <p className="mt-3 text-xs text-[var(--muted)]">
        Which Visits-table columns show is now a per-user choice, in the column picker on the
        Ledger and Workspace tables themselves.
      </p>
      <SectionSaveBar dirty={dirty} saved={saved} busy={busy} onSave={() => void save()} onCancel={cancel} error={error} />
    </SectionCard>
  );
}

function HistoricalData() {
  return (
    <SectionCard title="Historical data">
      <p className="mb-3 text-xs text-[var(--muted)]">
        One-time import of visits logged before go-live in the Excel ledger.
      </p>
      <Link to="/settings/import-visits" className="text-sm text-[var(--teal)] hover:underline">
        Import historical visits from Excel →
      </Link>
    </SectionCard>
  );
}

function DataBackup() {
  const clinic = useClinic();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [summary, setSummary] = useState<RestoreSummary | null>(null);

  async function exportNow() {
    setError(null);
    setBusy(true);
    try {
      await backupService.downloadBackup(clinic.id, clinic.name);
    } catch (e) {
      setError(toFriendlyMessage(e));
    } finally {
      setBusy(false);
    }
  }

  async function importFile(file: File) {
    setError(null);
    setSummary(null);
    setBusy(true);
    try {
      const text = await file.text();
      const bundle = JSON.parse(text) as BackupBundle;
      if (
        !confirm(
          `Restore this backup (exported ${bundle.exportedAt?.slice(0, 10) ?? 'unknown date'})?\n\nThis writes patients, visits, invoices, payments, and settlements back into this clinic. Existing records with the same ID are overwritten; nothing else is deleted.`
        )
      ) {
        return;
      }
      const result = await backupService.restoreBundle(bundle, clinic.id);
      setSummary(result);
    } catch (e) {
      setError(toFriendlyMessage(e));
    } finally {
      setBusy(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  }

  return (
    <SectionCard title="Data backup">
      <p className="mb-3 text-xs text-[var(--muted)]">
        Download a full snapshot of this clinic's data (patients, visits, invoices, payments,
        catalog, therapists) any time — a safety net before a wipe, a device change, or just as a
        habit. Restoring writes back through the same sync path as normal use, so restored data
        reaches the server too.
      </p>
      <div className="flex flex-wrap items-center gap-2">
        <button className={btnSecondary} disabled={busy} onClick={() => void exportNow()}>
          {busy ? 'Working…' : 'Export backup'}
        </button>
        <button className={btnSecondary} disabled={busy} onClick={() => fileInputRef.current?.click()}>
          Import backup…
        </button>
        <input
          ref={fileInputRef}
          type="file"
          accept="application/json"
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) void importFile(file);
          }}
        />
      </div>
      {summary && (
        <p className="mt-3 text-sm text-[var(--moss)]">
          Restored {summary.patients} patients, {summary.visits} visits, {summary.invoices} invoices,{' '}
          {summary.payments + summary.invoicePayments} payment records, {summary.catalog} catalog
          items, {summary.therapists} therapists, and {summary.settlements} settlements.
        </p>
      )}
      <div className="mt-2">
        <ErrorNote message={error} />
      </div>
    </SectionCard>
  );
}

function DangerZone() {
  const clinic = useClinic();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function resetLocalCache() {
    if (
      !confirm(
        "Clear this device's local copy of the data?\n\nNothing on the server is affected — the app reloads and downloads everything fresh. Use this after a wipe, or if this device is showing stale data."
      )
    )
      return;
    setError(null);
    setBusy(true);
    try {
      // db.delete() can hang indefinitely if another connection (another open
      // tab, or this page's own live queries) is holding the database — in
      // which case the browser silently "blocks" the delete. Race it against a
      // timeout so a stuck delete surfaces as an actionable error instead of
      // the button appearing to do nothing.
      await Promise.race([
        db.delete(),
        new Promise<never>((_, reject) => setTimeout(() => reject(new Error('blocked')), 5000)),
      ]);
      location.reload();
    } catch (e) {
      console.error('reset local cache failed', e);
      setError(
        'Could not clear the local data automatically. Close any other Thera.Net tabs or windows, then reload this page and try again.'
      );
      setBusy(false);
    }
  }

  async function wipeAll() {
    setError(null);
    const supabase = getSupabase();
    if (!supabase || !navigator.onLine) {
      setError('Wiping needs a connection — try again when online.');
      return;
    }
    const typed = prompt(
      'This permanently deletes ALL patients, visits, invoices, payments and settlements for this clinic, and resets invoice numbering to 0001. The catalog, therapists, and logins are kept.\n\nThis cannot be undone. Type WIPE to confirm:'
    );
    if (typed !== 'WIPE') return;
    setBusy(true);
    try {
      const { data, error: rpcError } = await supabase.rpc('admin_wipe_clinic_data', {
        p_clinic_id: clinic.id,
      });
      if (rpcError) throw new Error(rpcError.message);
      const counts = data as { patients: number; visits: number; invoices: number };
      alert(
        `Wiped ${counts.patients} patients, ${counts.visits} visits, and ${counts.invoices} invoices. The app will now reload with a clean slate.\n\nOn any OTHER device that was already signed in, use "Reset local cache" once.`
      );
      await db.delete();
      location.reload();
    } catch (e) {
      setError(toFriendlyMessage(e));
      setBusy(false);
    }
  }

  return (
    <SectionCard title="Danger zone">
      <p className="mb-3 text-xs text-[var(--muted)]">
        For test-data cleanup and troubleshooting. Wiping is admin-only and enforced by the server.
      </p>
      <div className="flex flex-wrap gap-2">
        <button className={btnSecondary} disabled={busy} onClick={() => void resetLocalCache()}>
          {busy ? 'Working…' : 'Reset local cache on this device'}
        </button>
        <button
          className="rounded-md border border-[var(--rust)] bg-[var(--surface)] px-4 py-2 text-sm font-medium text-[var(--rust)] hover:bg-[var(--rust-light)] disabled:opacity-50"
          disabled={busy}
          onClick={() => void wipeAll()}
        >
          {busy ? 'Wiping…' : 'Wipe ALL clinic data…'}
        </button>
      </div>
      <div className="mt-2">
        <ErrorNote message={error} />
      </div>
    </SectionCard>
  );
}

function Catalog() {
  const clinic = useClinic();
  const items = useLiveQuery(() => repos.catalog.list(clinic.id, true), [clinic.id]);
  const [draft, setDraft] = useState({ category: '', name: '', sessionCount: '1' });
  const [draftPrice, setDraftPrice] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function addItem() {
    setError(null);
    if (!draft.category.trim() || !draft.name.trim() || draftPrice == null) {
      setError('Category, name, and price are required');
      return;
    }
    const item: CatalogItem = {
      id: crypto.randomUUID(),
      clinicId: clinic.id,
      category: draft.category.trim(),
      name: draft.name.trim(),
      sessionCount: Math.max(1, Number(draft.sessionCount) || 1),
      basePricePaise: draftPrice,
      active: true,
      updatedAt: new Date().toISOString(),
    };
    await repos.catalog.put(item);
    setDraft({ category: draft.category, name: '', sessionCount: '1' });
    setDraftPrice(null);
  }

  async function toggleActive(item: CatalogItem) {
    await repos.catalog.put({ ...item, active: !item.active, updatedAt: new Date().toISOString() });
  }

  async function updatePrice(item: CatalogItem, pricePaise: number | null) {
    if (pricePaise == null) return;
    await repos.catalog.put({
      ...item,
      basePricePaise: pricePaise,
      updatedAt: new Date().toISOString(),
    });
  }

  return (
    <SectionCard title="Service catalog">
      <p className="mb-3 text-xs text-[var(--muted)]">
        Price changes affect FUTURE visits only — logged visits keep their price snapshot.
        Deactivate instead of deleting so history keeps resolving; per-session price is always
        derived (price ÷ sessions), never stored.
      </p>
      <div className="overflow-x-auto">
        <table className="min-w-full divide-y divide-[var(--border)]">
          <thead className="bg-[var(--paper)]">
            <tr>
              <th className={th}>Category</th>
              <th className={th}>Package</th>
              <th className={thNum}>Sessions</th>
              <th className={thNum}>Price</th>
              <th className={thNum}>Per session</th>
              <th className={th}>Status</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[var(--border)]">
            {(items ?? []).map((item) => (
              <tr key={item.id} className={item.active ? '' : 'opacity-50'}>
                <td className={td}>{item.category}</td>
                <td className={td}>{item.name}</td>
                <td className={tdNum}>{item.sessionCount}</td>
                <td className={`${tdNum} w-32`}>
                  <RupeeInput
                    valuePaise={item.basePricePaise}
                    onChange={(p) => void updatePrice(item, p)}
                  />
                </td>
                <td className={tdNum}>{formatINR(effectivePricePerSession(item))}</td>
                <td className={td}>
                  <button
                    className="text-xs text-[var(--teal)] hover:underline"
                    onClick={() => void toggleActive(item)}
                  >
                    {item.active ? 'Deactivate' : 'Reactivate'}
                  </button>
                </td>
              </tr>
            ))}
            <tr className="bg-[var(--paper)]/50">
              <td className={td}>
                <input
                  className={inputCls}
                  placeholder="Category"
                  list="catalog-categories"
                  value={draft.category}
                  onChange={(e) => setDraft({ ...draft, category: e.target.value })}
                />
                <datalist id="catalog-categories">
                  {[...new Set((items ?? []).map((i) => i.category))].map((c) => (
                    <option key={c} value={c} />
                  ))}
                </datalist>
              </td>
              <td className={td}>
                <input
                  className={inputCls}
                  placeholder="Package name"
                  value={draft.name}
                  onChange={(e) => setDraft({ ...draft, name: e.target.value })}
                />
              </td>
              <td className={`${td} w-24`}>
                <input
                  type="number"
                  min={1}
                  className={inputCls}
                  value={draft.sessionCount}
                  onChange={(e) => setDraft({ ...draft, sessionCount: e.target.value })}
                />
              </td>
              <td className={`${td} w-32`}>
                <RupeeInput valuePaise={draftPrice} onChange={setDraftPrice} />
              </td>
              <td className={td} colSpan={2}>
                <button className={btnSecondary} onClick={() => void addItem()}>
                  + Add
                </button>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
      <div className="mt-2">
        <ErrorNote message={error} />
      </div>
    </SectionCard>
  );
}

interface ClinicMember {
  userId: string;
  email: string;
  role: string;
}

const MEMBER_ROLE_LABELS: Record<string, string> = {
  admin: 'Admin',
  therapist: 'Therapist',
  front_desk: 'Front desk',
};

function Therapists() {
  const clinic = useClinic();
  const therapists = useLiveQuery(() => repos.therapists.list(clinic.id, true), [clinic.id]);
  const [name, setName] = useState('');
  const [rosterError, setRosterError] = useState<string | null>(null);
  const [members, setMembers] = useState<ClinicMember[] | null>(null);
  const [membersError, setMembersError] = useState<string | null>(null);
  const [revokeInProgress, setRevokeInProgress] = useState<string | null>(null);
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteName, setInviteName] = useState('');
  const [inviteRole, setInviteRole] = useState<'admin' | 'therapist' | 'front_desk'>('therapist');
  const [inviteBusy, setInviteBusy] = useState(false);
  const [inviteError, setInviteError] = useState<string | null>(null);
  const [inviteSuccess, setInviteSuccess] = useState<string | null>(null);

  useEffect(() => {
    const supabase = getSupabase();
    if (!supabase) return;
    (async () => {
      const { data, error } = await supabase.rpc('list_clinic_members_with_email', {
        p_clinic_id: clinic.id,
      });
      if (error) {
        setMembersError(toFriendlyMessage(new Error(error.message)));
        return;
      }
      setMembers(
        (data as { user_id: string; email: string; role: string }[]).map((m) => ({
          userId: m.user_id,
          email: m.email,
          role: m.role,
        }))
      );
    })();
  }, [clinic.id]);

  async function add() {
    if (!name.trim()) return;
    await repos.therapists.put({
      id: crypto.randomUUID(),
      clinicId: clinic.id,
      name: name.trim(),
      active: true,
      updatedAt: new Date().toISOString(),
    });
    setName('');
  }

  async function deleteTherapist(t: Therapist) {
    setRosterError(null);
    try {
      // Mirrors hard_delete_therapist()'s exact check (20260815000006) so a
      // therapist that looks deletable here doesn't just fail server-side
      // with a less specific error after the confirm prompt: visits where
      // they're the primary OR shared therapist, plus consultation notes
      // and invoices attributed to them.
      const [allVisits, allNotes, allInvoices] = await Promise.all([
        repos.visits.list({ clinicId: clinic.id }),
        repos.consultationNotes.listByClinic(clinic.id),
        repos.invoices.list(clinic.id),
      ]);
      const linkedVisits = allVisits.filter((v) => v.therapistId === t.id || v.sharedTherapistId === t.id).length;
      const linkedNotes = allNotes.filter((n) => n.therapistId === t.id).length;
      const linkedInvoices = allInvoices.filter((i) => i.therapistId === t.id).length;
      const linked = linkedVisits + linkedNotes + linkedInvoices;
      if (linked > 0) {
        alert(
          `${t.name} has ${linked} linked record(s) (visits, notes, or invoices), so they can't be permanently deleted — deactivate instead.`
        );
        return;
      }
      const typed = prompt(
        `Permanently delete ${t.name} from the roster? This cannot be undone.\n\nType their name to confirm:`
      );
      if (typed === null) return;
      if (typed.trim().toLowerCase() !== t.name.trim().toLowerCase()) {
        alert('Name did not match — nothing was deleted.');
        return;
      }
      await therapistService.hardDelete(t.id);
    } catch (e) {
      setRosterError(toFriendlyMessage(e));
    }
  }

  async function inviteTherapist() {
    if (!inviteEmail.trim()) return;
    if (inviteRole === 'therapist' && !inviteName.trim()) {
      setInviteError('Enter their name');
      return;
    }
    setInviteError(null);
    setInviteSuccess(null);
    setInviteBusy(true);
    try {
      const supabase = getSupabase();
      if (!supabase) throw new Error('No Supabase connection');

      const session = await supabase.auth.getSession();
      if (!session.data.session?.access_token) {
        throw new Error('Not authenticated');
      }

      const response = await fetch(
        `${SUPABASE_URL}/functions/v1/invite-therapist`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${session.data.session.access_token}`,
          },
          body: JSON.stringify({
            clinicId: clinic.id,
            email: inviteEmail.trim(),
            role: inviteRole,
            ...(inviteRole === 'therapist' ? { name: inviteName.trim() } : {}),
          }),
        }
      );

      const result = (await response.json()) as {
        success?: boolean;
        message?: string;
        warning?: string;
        error?: string;
      };

      if (!response.ok || result.error) {
        throw new Error(result.error || `Request failed with status ${response.status}`);
      }

      setInviteSuccess(result.warning ? `Invitation sent to ${inviteEmail}. ${result.warning}` : `Invitation sent to ${inviteEmail}`);
      setInviteEmail('');
      setInviteName('');
      setInviteRole('therapist');
    } catch (e) {
      setInviteError(toFriendlyMessage(e));
    } finally {
      setInviteBusy(false);
    }
  }

  async function revokeMember(userId: string, email: string) {
    if (!confirm(`Revoke ${email}'s access to this clinic?`)) return;
    setMembersError(null);
    setRevokeInProgress(userId);
    try {
      const supabase = getSupabase();
      if (!supabase) throw new Error('No Supabase connection');

      const { error } = await supabase
        .from('clinic_members')
        .delete()
        .eq('clinic_id', clinic.id)
        .eq('user_id', userId);

      if (error) throw error;

      setMembers((prev) => prev?.filter((m) => m.userId !== userId) ?? null);
    } catch (e) {
      setMembersError(toFriendlyMessage(e));
    } finally {
      setRevokeInProgress(null);
    }
  }

  return (
    <SectionCard title="Therapists & team">
      <div className="mb-6 space-y-3">
        <h3 className="text-sm font-semibold text-[var(--ink)]">Invite a team member</h3>
        <div className="flex max-w-sm flex-col gap-2">
          <label className="flex items-center gap-2 text-xs text-[var(--muted)]">
            Role
            <select
              className={inputCls}
              value={inviteRole}
              onChange={(e) => setInviteRole(e.target.value as 'admin' | 'therapist' | 'front_desk')}
              disabled={inviteBusy}
            >
              <option value="therapist">Therapist</option>
              <option value="front_desk">Front desk</option>
              <option value="admin">Admin</option>
            </select>
          </label>
          {inviteRole === 'therapist' && (
            <input
              className={inputCls}
              placeholder="Their name — shows in the therapist picker on visits"
              value={inviteName}
              onChange={(e) => setInviteName(e.target.value)}
              disabled={inviteBusy}
            />
          )}
          <input
            className={inputCls}
            type="email"
            placeholder="Email address"
            value={inviteEmail}
            onChange={(e) => setInviteEmail(e.target.value)}
            disabled={inviteBusy}
          />
          <button className={btnSecondary} disabled={inviteBusy} onClick={() => void inviteTherapist()}>
            {inviteBusy ? 'Sending…' : 'Send invitation'}
          </button>
        </div>
        {inviteRole === 'therapist' && (
          <p className="text-xs text-[var(--muted)]">
            Automatically added to the service roster below and linked to their login — no separate
            setup step needed.
          </p>
        )}
        {inviteSuccess && <p className="text-sm text-[var(--moss)]">{inviteSuccess}</p>}
        {inviteError && <ErrorNote message={inviteError} />}
      </div>

      <div className="border-t border-[var(--border)] pt-6">
        <h3 className="mb-3 text-sm font-semibold text-[var(--ink)]">Team members</h3>
        {members && members.length > 0 ? (
          <ul className="space-y-2">
            {members.map((m) => (
              <li key={m.userId} className="flex items-center justify-between gap-3 text-sm">
                <div>
                  <p className="text-[var(--ink)]">{m.email}</p>
                  <p className="text-xs text-[var(--muted)]">{MEMBER_ROLE_LABELS[m.role] ?? m.role}</p>
                </div>
                <button
                  className="text-xs text-[var(--rust)] hover:underline disabled:opacity-50"
                  disabled={revokeInProgress === m.userId}
                  onClick={() => void revokeMember(m.userId, m.email)}
                >
                  {revokeInProgress === m.userId ? 'Revoking…' : 'Revoke'}
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-xs text-[var(--muted)]">No team members yet.</p>
        )}
        <ErrorNote message={membersError} />
      </div>

      <div className="border-t border-[var(--border)] pt-6">
        <h3 className="mb-3 text-sm font-semibold text-[var(--ink)]">Service roster</h3>
        <ul className="mb-3 space-y-2">
          {(therapists ?? []).map((t) => (
            <li key={t.id} className="flex flex-wrap items-center gap-3 text-sm">
              <span className={`min-w-32 ${t.active ? '' : 'text-[var(--muted)] line-through'}`}>{t.name}</span>
              <button
                className="text-xs text-[var(--teal)] hover:underline"
                onClick={() =>
                  void repos.therapists.put({
                    ...t,
                    active: !t.active,
                    updatedAt: new Date().toISOString(),
                  })
                }
              >
                {t.active ? 'Deactivate' : 'Reactivate'}
              </button>
              <button
                className="text-xs text-[var(--rust)] hover:underline"
                onClick={() => void deleteTherapist(t)}
              >
                Delete
              </button>
              {members && members.length > 0 && (
                <label className="ml-auto flex items-center gap-2 text-xs text-[var(--muted)]">
                  Linked login
                  <select
                    className={inputCls}
                    value={t.userId ?? ''}
                    onChange={(e) =>
                      void repos.therapists.put({
                        ...t,
                        userId: e.target.value || null,
                        updatedAt: new Date().toISOString(),
                      })
                    }
                  >
                    <option value="">— None —</option>
                    {members.map((m) => (
                      <option key={m.userId} value={m.userId}>
                        {m.email}
                      </option>
                    ))}
                  </select>
                </label>
              )}
            </li>
          ))}
        </ul>
        <div className="flex max-w-sm gap-2">
          <input
            className={inputCls}
            placeholder="New therapist name"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
          <button className={btnSecondary} onClick={() => void add()}>
            + Add
          </button>
        </div>
        <p className="mt-2 text-xs text-[var(--muted)]">
          Deactivating keeps history intact — past visits still show the therapist. Delete only
          works for someone with zero visits, notes, or invoices on record (added by mistake, or
          left before seeing a patient) — anyone with real history can only be deactivated.
          {members && members.length > 0 && (
            <>
              {' '}
              Inviting a therapist above links their login automatically; the login dropdown here
              is for linking one after the fact, or for a roster entry added manually.
            </>
          )}
        </p>
        <div className="mt-2">
          <ErrorNote message={rosterError} />
        </div>
      </div>
    </SectionCard>
  );
}
