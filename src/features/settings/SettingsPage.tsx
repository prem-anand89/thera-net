import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useSearch } from '@tanstack/react-router';
import { useLiveQuery } from 'dexie-react-hooks';
import { repos, backupService, therapistService } from '@/services';
import type { BackupBundle, RestoreSummary } from '@/services/backupService';
import { useClinic } from '@/app/clinicContext';
import { usePermissions } from '@/app/usePermissions';
import { CLINIC_ROLE_LABELS, type ClinicRole } from '@/app/useClinicRole';
import { getSupabase, publicTherapistPhotoUrl, publicLogoUrl } from '@/lib/supabase';
import { resizeImageToBlob } from '@/lib/resizeImage';
import { SUPABASE_URL } from '@/lib/env';
import { db } from '@/lib/db';
import { formatINR } from '@/domain/money';
import { MONTH_NAMES } from '@/domain/fiscalYear';
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
import { FirstWeekChecklist, useFirstWeekChecklistVisible } from './FirstWeekChecklist';
import { isValidUpiVpa } from '@/domain/upiPay';

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

/** One accent color per section, matching the reviewed Team-panel mockup's
 *  rail — an icon badge next to every rail item, colored per section
 *  rather than a single uniform gray. */
type Accent = 'teal' | 'amber' | 'rust' | 'moss' | 'slate';

const SECTIONS: { key: SectionKey; label: string; description: string; accent: Accent }[] = [
  { key: 'profile', label: 'Clinic profile', description: 'Name, address, contact info, logo, walk-in ID prefix.', accent: 'teal' },
  {
    key: 'billing',
    label: 'Billing & invoicing',
    description: 'Invoice numbering, GST, fiscal year, who can bill, UPI QR.',
    accent: 'amber',
  },
  {
    key: 'partner',
    label: 'Partner & split',
    description: 'Revenue share with a partner hospital, therapist splits, TDS.',
    accent: 'rust',
  },
  { key: 'team', label: 'Team', description: 'Invite and manage logins, therapist roster.', accent: 'moss' },
  { key: 'services', label: 'Services', description: 'Catalog of billable services and package prices.', accent: 'teal' },
  {
    key: 'features',
    label: 'Features',
    description: 'Optional modules — Expected today, clinical notes, comparison chart.',
    accent: 'slate',
  },
  {
    key: 'data',
    label: 'Data & maintenance',
    description: 'Import historical visits, back up or restore, reset this device, wipe clinic data.',
    accent: 'slate',
  },
];

// Same two-lists-must-agree guard as the note editor's jump-nav.
if (SECTION_GROUPS.flatMap((g) => g.keys).length !== SECTIONS.length) {
  throw new Error('SECTION_GROUPS is out of sync with SECTIONS');
}

const ACCENT_VARS: Record<Accent, { color: string; light: string }> = {
  teal: { color: 'var(--teal)', light: 'var(--teal-light)' },
  amber: { color: 'var(--amber)', light: 'var(--amber-light)' },
  rust: { color: 'var(--rust)', light: 'var(--rust-light)' },
  moss: { color: 'var(--moss)', light: 'var(--moss-light)' },
  slate: { color: 'var(--slate)', light: 'var(--slate-light)' },
};

const SECTION_ICON_PATHS: Record<SectionKey, string> = {
  profile: 'M2.5 3h11v10h-11zM5.5 6h5M5.5 8.3h5M5.5 10.6h3',
  billing: 'M2.5 6.5L8 2.8l5.5 3.7M3.7 5.8V12a1 1 0 001 1h6.6a1 1 0 001-1V5.8',
  partner: 'M8 2.5l1.4 3.1 3.4.4-2.5 2.3.7 3.4L8 10l-3 1.7.7-3.4-2.5-2.3 3.4-.4L8 2.5z',
  team: 'M2.3 13c.4-2.5 2-3.9 3.9-3.9s3.5 1.4 3.9 3.9M9.9 9.5c1.6.2 2.8 1.4 3.1 3.5',
  services: 'M3 4h10M3 8h10M3 12h6',
  features: 'M8 2.5v1.8M8 11.7v1.8M13.5 8h-1.8M4.3 8H2.5M11.8 4.2l-1.3 1.3M5.5 10.5l-1.3 1.3M11.8 11.8l-1.3-1.3M5.5 5.5L4.2 4.2',
  data: 'M3 5c0-1.1 2.2-2 5-2s5 .9 5 2-2.2 2-5 2-5-.9-5-2zM3 5v6c0 1.1 2.2 2 5 2s5-.9 5-2V5M3 8c0 1.1 2.2 2 5 2s5-.9 5-2',
};

/** Small colored icon badge for a settings section — same 28px rounded
 *  square + accent-tinted background as the rail-nav mockup. `team` and
 *  `partner` need an extra circle for their people/star glyphs since a
 *  single path can't express both. */
function SectionIcon({ sectionKey, accent }: { sectionKey: SectionKey; accent: Accent }) {
  const { color, light } = ACCENT_VARS[accent];
  return (
    <span
      className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md"
      style={{ background: light, color }}
    >
      <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
        {sectionKey === 'team' && <circle cx="6" cy="5.3" r="2" stroke="currentColor" strokeWidth="1.4" />}
        {sectionKey === 'partner' ? (
          <path d={SECTION_ICON_PATHS[sectionKey]} stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round" />
        ) : (
          <path d={SECTION_ICON_PATHS[sectionKey]} stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
        )}
      </svg>
    </span>
  );
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

export function SettingsPage() {
  const clinic = useClinic();
  const { canEditSettings } = usePermissions();
  const search = useSearch({ from: '/settings' });
  const navigate = useNavigate({ from: '/settings' });
  const [activeKey, setActiveKeyState] = useState<SectionKey>(search.tab ?? 'profile');
  const [dirtyKeys, setDirtyKeys] = useState<Set<SectionKey>>(new Set());
  const therapists = useLiveQuery(() => repos.therapists.list(clinic.id, true), [clinic.id]);
  const unlinkedCount = (therapists ?? []).filter((t) => !t.userId).length;
  const catalog = useLiveQuery(() => repos.catalog.list(clinic.id), [clinic.id]);
  const catalogEmpty = catalog !== undefined && catalog.length === 0;

  // `replace` so switching tabs doesn't spam browser history — a `?tab=`
  // link is meant to be bookmarkable/shareable, not a Back-button stepper.
  function setActiveKey(key: SectionKey) {
    setActiveKeyState(key);
    void navigate({ search: (prev) => ({ ...prev, tab: key }), replace: true });
  }

  // Default landing, only when nobody already told us where to go via
  // ?tab=: Team if anyone is unlinked (existing behavior, kept), otherwise
  // Services while the catalog is still empty (that's the actual week-one
  // blocker), otherwise Profile.
  const [landedOnDefault, setLandedOnDefault] = useState(!!search.tab);
  useEffect(() => {
    if (landedOnDefault || therapists === undefined || catalog === undefined) return;
    setActiveKey(unlinkedCount > 0 ? 'team' : catalogEmpty ? 'services' : 'profile');
    setLandedOnDefault(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [landedOnDefault, therapists, catalog, unlinkedCount, catalogEmpty]);

  // First week's own two checkable gates (the rest of its steps are
  // behavioral tips, not something Dexie can confirm) — once both clear,
  // the card auto-hides instead of sitting there until someone notices the
  // Hide button. Held back while either query is still loading so it
  // doesn't flash visible-then-hidden on a fast setup.
  const firstWeekNotDismissed = useFirstWeekChecklistVisible();
  const setupIncomplete = therapists === undefined || catalog === undefined ? undefined : unlinkedCount > 0 || catalogEmpty;
  const showFirstWeek = firstWeekNotDismissed === undefined || setupIncomplete === undefined ? false : firstWeekNotDismissed && setupIncomplete;

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

      {showFirstWeek && <FirstWeekChecklist />}

      <div className="tab:flex tab:items-start tab:gap-6">
        {/* Below tab: (Shell's own bottom tab bar owns the bottom of the
            viewport now — a horizontal chip row down there would compete
            with it), a grouped <select> stands in for the rail: seven flat
            chips with no room for the Clinic/People & services/System
            grouping read as one undifferentiated strip. Vertical rail with
            real group headings at tab: and above, where there's width for
            it. */}
        <select
          value={activeKey}
          onChange={(e) => selectSection(e.target.value as SectionKey)}
          className={`${inputCls} mb-4 tab:hidden`}
        >
          {SECTION_GROUPS.map((group) => (
            <optgroup key={group.label} label={group.label}>
              {group.keys.map((key) => {
                const s = SECTIONS.find((x) => x.key === key)!;
                return (
                  <option key={key} value={key}>
                    {s.label}
                    {dirtyKeys.has(key) ? ' •' : ''}
                  </option>
                );
              })}
            </optgroup>
          ))}
        </select>
        <nav className="mb-4 hidden gap-1 overflow-x-auto tab:mb-0 tab:flex tab:w-48 tab:shrink-0 tab:flex-col tab:gap-0.5 tab:overflow-visible">
          {SECTION_GROUPS.map((group) => (
            <div key={group.label} className="contents tab:mb-1.5 tab:block">
              <p className="hidden px-3 pb-1 pt-1.5 text-[10px] font-bold uppercase tracking-wider text-[var(--muted)]/70 tab:block">
                {group.label}
              </p>
              {group.keys.map((key) => {
                const s = SECTIONS.find((x) => x.key === key)!;
                const active = activeKey === s.key;
                const accent = ACCENT_VARS[s.accent];
                return (
                  <button
                    key={s.key}
                    type="button"
                    onClick={() => selectSection(s.key)}
                    className="flex shrink-0 items-center gap-2 whitespace-nowrap rounded-md px-2 py-1.5 text-left text-sm font-medium tab:w-full"
                    style={active ? { background: accent.light, color: accent.color } : { color: 'var(--muted)' }}
                  >
                    <SectionIcon sectionKey={s.key} accent={s.accent} />
                    {s.label}
                    {dirtyKeys.has(s.key) && <span className="text-[var(--rust)]">•</span>}
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
          {activeKey === 'team' && (
            <>
              {unlinkedCount > 0 && (
                <div className="rounded-2xl border border-[var(--amber)] bg-[var(--amber-light)] px-4 py-3 text-sm text-[var(--ink)]">
                  {unlinkedCount} therapist{unlinkedCount === 1 ? '' : 's'} not linked to a login.
                  Set Linked login so their Workspace isn’t empty.
                </div>
              )}
              <Therapists />
            </>
          )}
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

type ProfileFields = Pick<
  Clinic,
  'name' | 'address' | 'phone' | 'email' | 'walkInMrnoPrefix' | 'logoPath' | 'clinicType'
>;

function ClinicProfileSection({ onDirtyChange }: { onDirtyChange: (dirty: boolean) => void }) {
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
      }),
      onDirtyChange
    );
  const logoPreviewUrl = publicLogoUrl(form.logoPath);

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
              <InfoTip text="Used for auto-generated Patient IDs when a walk-in has no existing ID (format: PREFIXYY-0001, sequential per year). Defaults to 'W'." />
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
        <Field label="Clinic logo">
          <input
            type="file"
            accept="image/*"
            className={inputCls}
            onChange={(e) => e.target.files?.[0] && void uploadLogo(e.target.files[0])}
          />
          {logoPreviewUrl && (
            <img src={logoPreviewUrl} alt="Current clinic logo" className="mt-2 h-14 w-auto object-contain" />
          )}
        </Field>
      </div>
      <SectionSaveBar dirty={dirty} saved={saved} busy={busy} onSave={() => void save()} onCancel={cancel} error={error} />
    </SectionCard>
  );
}

type BillingFields = Pick<
  Clinic,
  | 'invoicePrefix'
  | 'gstNo'
  | 'fyStartMonth'
  | 'billingEnabled'
  | 'invoicingAccess'
  | 'upiVpa'
  | 'upiPayeeName'
  | 'upiQrPath'
  | 'upiQrEnabled'
  | 'signaturePath'
>;

function BillingSection({ onDirtyChange }: { onDirtyChange: (dirty: boolean) => void }) {
  const { clinic, form, set, save, cancel, saveFieldNow, dirty, saved, busy, error, setError } =
    useClinicSectionForm<BillingFields>(
      (c) => ({
        invoicePrefix: c.invoicePrefix,
        gstNo: c.gstNo,
        fyStartMonth: c.fyStartMonth,
        billingEnabled: c.billingEnabled ?? true,
        invoicingAccess: c.invoicingAccess ?? 'everyone',
        upiVpa: c.upiVpa ?? '',
        upiPayeeName: c.upiPayeeName ?? '',
        upiQrPath: c.upiQrPath ?? null,
        upiQrEnabled: c.upiQrEnabled ?? false,
        signaturePath: c.signaturePath ?? null,
      }),
      onDirtyChange
    );
  const qrPreviewUrl = publicLogoUrl(form.upiQrPath);
  const signaturePreviewUrl = publicLogoUrl(form.signaturePath);

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
    await saveFieldNow({ upiQrPath: path } as Partial<BillingFields>);
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
    await saveFieldNow({ signaturePath: path } as Partial<BillingFields>);
  }

  async function saveBilling() {
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
          <select
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
        <Field
          label={
            <>
              Billing module
              <InfoTip text="Off for clinics that bill entirely through a partner hospital's own system — hides Invoices everywhere, for everyone, regardless of role." />
            </>
          }
        >
          <BoolToggle value={form.billingEnabled ?? true} onChange={(v) => set({ billingEnabled: v })} />
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

      <h3 className="font-display mt-6 mb-3 text-sm font-semibold text-[var(--ink)]">UPI collection</h3>
      <p className="mb-3 text-xs text-[var(--muted)]">
        One clinic UPI for the front desk. When collection method is UPI, staff can show a QR the patient scans. A UPI
        ID builds a QR with the visit amount and Patient ID in the note; an uploaded image is the fallback.
      </p>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
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
              {qrPreviewUrl && (
                <img src={qrPreviewUrl} alt="Uploaded clinic UPI QR" className="mt-2 h-24 w-24 object-contain" />
              )}
            </Field>
          </>
        )}
      </div>

      <h3 className="font-display mt-6 mb-3 text-sm font-semibold text-[var(--ink)]">Invoice signature</h3>
      <p className="mb-3 text-xs text-[var(--muted)]">
        A one-time uploaded signature image, printed on every invoice in place of the blank
        "Authorised signature" line. Not a cryptographic e-signature — a photo or scan of a hand
        signature is fine.
      </p>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <Field label="Signature image (optional)">
          <input
            type="file"
            accept="image/*"
            className={inputCls}
            onChange={(e) => e.target.files?.[0] && void uploadSignature(e.target.files[0])}
          />
          {signaturePreviewUrl && (
            <img src={signaturePreviewUrl} alt="Uploaded signature" className="mt-2 h-16 w-40 object-contain" />
          )}
        </Field>
      </div>
      <SectionSaveBar
        dirty={dirty}
        saved={saved}
        busy={busy}
        onSave={() => void saveBilling()}
        onCancel={cancel}
        error={error}
      />
    </SectionCard>
  );
}

type PartnerFields = Pick<
  Clinic,
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
  const partnerLogoPreviewUrl = publicLogoUrl(form.partnerHospitalLogoPath);

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
              Partner with therapist/external org
              <InfoTip text="Enable if your clinic partners with a therapist or external organization (hospital, etc.) for revenue sharing, tax deduction, or other arrangements." />
            </>
          }
        >
          <BoolToggle value={form.hasPartner ?? false} onChange={(v) => set({ hasPartner: v })} />
        </Field>
        {(clinic.clinicType ?? 'multiple') === 'multiple' && (
          <Field
            label={
              <>
                Track therapist splits
                <InfoTip text="Lets a visit's revenue be credited between two therapists (a Split action + Shared/Net report columns). Turn off if you don't attribute revenue across therapists." />
              </>
            }
          >
            <BoolToggle value={form.enableTherapistSplit !== false} onChange={(v) => set({ enableTherapistSplit: v })} />
          </Field>
        )}
        {form.hasPartner && (
          <>
            <Field label="Partner name (prints on invoices if set)">
              <input
                className={inputCls}
                value={form.partnerHospitalName ?? ''}
                onChange={(e) => set({ partnerHospitalName: e.target.value || null })}
              />
            </Field>
            <Field label="Your share label (report column, e.g. Clinic)">
              <input
                className={inputCls}
                placeholder="Clinic"
                value={form.ownShareLabel ?? ''}
                onChange={(e) => set({ ownShareLabel: e.target.value || null })}
              />
            </Field>
            <Field label="Partner share label (report column, e.g. Hospital)">
              <input
                className={inputCls}
                placeholder="Hospital"
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
              {partnerLogoPreviewUrl && (
                <img src={partnerLogoPreviewUrl} alt="Current partner logo" className="mt-2 h-14 w-auto object-contain" />
              )}
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

/** Two-option pill toggle — same selected/unselected visual language as
 *  Team's invite-role picker (border/background/color keyed off a boolean
 *  instead of a 3-way role), so a feature flag reads the same way a role
 *  or status does elsewhere in Settings, instead of as a plain browser
 *  &lt;select&gt;. */
function BoolToggle({ value, onChange }: { value: boolean; onChange: (v: boolean) => void }) {
  return (
    <div className="flex gap-1.5">
      {([false, true] as const).map((v) => {
        const selected = value === v;
        return (
          <button
            key={String(v)}
            type="button"
            onClick={() => onChange(v)}
            className="flex-1 rounded-lg border px-2 py-1.5 text-center text-xs font-semibold"
            style={{
              borderColor: selected ? 'var(--teal)' : 'var(--border)',
              background: selected ? 'var(--teal-light)' : 'var(--surface)',
              color: selected ? 'var(--teal)' : 'var(--muted)',
            }}
          >
            {v ? 'On' : 'Off'}
          </button>
        );
      })}
    </div>
  );
}

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
          <BoolToggle value={form.enableExpectedToday ?? false} onChange={(v) => set({ enableExpectedToday: v })} />
        </Field>
        <Field
          label={
            <>
              Clinical documentation
              <InfoTip text="When on, new visits are flagged for a clinical note until one is completed — surfaced on Workspace's Needs attention and Documentation lists. Off by default; turn on for clinics that track a note per visit." />
            </>
          }
        >
          <BoolToggle value={form.clinicalDocsEnabled ?? false} onChange={(v) => set({ clinicalDocsEnabled: v })} />
        </Field>
        <Field
          label={
            <>
              Therapist comparison chart
              <InfoTip text="When on, the Revenue and Visits comparison charts on Reports are visible to therapists too, not just admins — for clinics that want that competitive visibility. Off by default." />
            </>
          }
        >
          <BoolToggle value={form.showTherapistComparison ?? false} onChange={(v) => set({ showTherapistComparison: v })} />
        </Field>
      </div>
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
      `This permanently deletes ALL patients, visits, invoices, payments and settlements for this clinic, and resets invoice numbering to 0001. The catalog, therapists, and logins are kept.\n\nThis cannot be undone. Type the clinic name (${clinic.name}) to confirm:`
    );
    if (typed?.trim() !== clinic.name) return;
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
                  <div className="flex items-center gap-2">
                    <span
                      className="rounded-full px-2.5 py-0.5 text-[10.5px] font-semibold"
                      style={
                        item.active
                          ? { background: 'var(--moss-light)', color: 'var(--moss-strong)' }
                          : { background: 'var(--paper)', color: 'var(--muted)' }
                      }
                    >
                      {item.active ? 'Active' : 'Inactive'}
                    </span>
                    <button
                      className="text-xs text-[var(--teal)] hover:underline"
                      onClick={() => void toggleActive(item)}
                    >
                      {item.active ? 'Deactivate' : 'Reactivate'}
                    </button>
                  </div>
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
  displayName: string | null;
}

/** Same accent per role everywhere a role shows up as a colored pill or
 *  avatar in Settings → Team — admin teal, therapist moss, front_desk amber. */
const ROLE_ACCENT: Record<Exclude<ClinicRole, 'unknown'>, Accent> = {
  admin: 'teal',
  therapist: 'moss',
  front_desk: 'amber',
};

function RolePill({ role }: { role: Exclude<ClinicRole, 'unknown'> }) {
  const { color, light } = ACCENT_VARS[ROLE_ACCENT[role]];
  return (
    <span
      className="inline-block self-start rounded-full px-2.5 py-0.5 text-[10.5px] font-semibold"
      style={{ background: light, color }}
    >
      {CLINIC_ROLE_LABELS[role]}
    </span>
  );
}

/** Same split-on-whitespace, first-two-initials logic already duplicated
 *  across the patient avatar spots (PatientsPage/PatientProfilePage/
 *  NoteEditorPage) — matched here rather than introducing a shared helper
 *  for a one-line computation. */
function therapistInitials(name: string): string {
  return name
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? '')
    .join('');
}

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

  const refetchMembers = useCallback(async () => {
    const supabase = getSupabase();
    if (!supabase) return;
    const { data, error } = await supabase.rpc('list_clinic_members_with_email', {
      p_clinic_id: clinic.id,
    });
    if (error) {
      setMembersError(toFriendlyMessage(new Error(error.message)));
      return;
    }
    setMembers(
      (data as { user_id: string; email: string; role: string; display_name: string | null }[]).map((m) => ({
        userId: m.user_id,
        email: m.email,
        role: m.role,
        displayName: m.display_name,
      }))
    );
  }, [clinic.id]);

  useEffect(() => {
    void refetchMembers();
  }, [refetchMembers]);

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

  async function uploadTherapistPhoto(t: Therapist, file: File) {
    setRosterError(null);
    const supabase = getSupabase();
    if (!supabase || !navigator.onLine) {
      setRosterError('Photo upload needs a connection.');
      return;
    }
    try {
      // Downscaled client-side first (see resizeImage.ts) — this only ever
      // renders as a small avatar, no reason to store/serve a full-size
      // phone photo for that.
      const resized = await resizeImageToBlob(file, 256);
      const path = `${clinic.id}/therapist-${t.id}-${Date.now()}.jpg`;
      const { error: uploadError } = await supabase.storage
        .from('clinic-assets')
        .upload(path, resized, { contentType: 'image/jpeg' });
      if (uploadError) {
        setRosterError(`Upload failed: ${toFriendlyMessage(uploadError)}`);
        return;
      }
      await repos.therapists.put({ ...t, photoPath: path, updatedAt: new Date().toISOString() });
    } catch (e) {
      setRosterError(toFriendlyMessage(e));
    }
  }

  async function inviteTherapist() {
    if (!inviteEmail.trim()) return;
    if (!inviteName.trim()) {
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
            name: inviteName.trim(),
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

  const inviteRoles: Exclude<ClinicRole, 'unknown'>[] = ['therapist', 'front_desk', 'admin'];

  return (
    <SectionCard title="Therapists & team">
      <div className="mb-6">
        <div className="mb-3 flex items-baseline justify-between gap-2">
          <h3 className="text-sm font-semibold text-[var(--ink)]">Members</h3>
          {members && <span className="rounded-full border border-[var(--border)] bg-[var(--paper)] px-2 py-0.5 font-mono text-[11px] text-[var(--muted)]">{members.length}</span>}
        </div>
        {members && members.length > 0 ? (
          <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2 lg:grid-cols-3">
            {members.map((m) => (
              <MemberCard
                key={m.userId}
                member={m}
                clinicId={clinic.id}
                revoking={revokeInProgress === m.userId}
                onRevoke={() => void revokeMember(m.userId, m.email)}
                onSaved={() => void refetchMembers()}
              />
            ))}
          </div>
        ) : (
          <p className="text-xs text-[var(--muted)]">No team members yet.</p>
        )}
        <ErrorNote message={membersError} />
      </div>

      <div className="border-t border-[var(--border)] pt-6">
        <h3 className="mb-3 text-sm font-semibold text-[var(--ink)]">Invite a team member</h3>
        <div className="max-w-md rounded-xl border border-[var(--border)] bg-[var(--paper)] p-4">
          <div className="mb-3 flex gap-2">
            {inviteRoles.map((r) => {
              const { color, light } = ACCENT_VARS[ROLE_ACCENT[r]];
              const selected = inviteRole === r;
              return (
                <button
                  key={r}
                  type="button"
                  disabled={inviteBusy}
                  onClick={() => setInviteRole(r)}
                  className="flex-1 rounded-lg border px-2 py-2 text-center text-xs font-semibold"
                  style={{
                    borderColor: selected ? color : 'var(--border)',
                    background: selected ? light : 'var(--surface)',
                    color: selected ? color : 'var(--muted)',
                  }}
                >
                  {CLINIC_ROLE_LABELS[r]}
                </button>
              );
            })}
          </div>
          <div className="flex flex-col gap-2">
            <input
              className={inputCls}
              placeholder={
                inviteRole === 'therapist'
                  ? 'Their name — shows in the therapist picker on visits'
                  : 'Their name — shown in the app instead of their email'
              }
              value={inviteName}
              onChange={(e) => setInviteName(e.target.value)}
              disabled={inviteBusy}
            />
            <input
              className={inputCls}
              type="email"
              placeholder="Email address"
              value={inviteEmail}
              onChange={(e) => setInviteEmail(e.target.value)}
              disabled={inviteBusy}
            />
            <button className={btnPrimary} disabled={inviteBusy} onClick={() => void inviteTherapist()}>
              {inviteBusy ? 'Sending…' : 'Send invitation'}
            </button>
          </div>
          <p className="mt-3 text-xs text-[var(--muted)]">
            {inviteRole === 'therapist'
              ? "Automatically added to the service roster below and linked to their login — no separate setup step needed. They can rename themselves from the account menu once they've signed in."
              : "They can rename themselves from the account menu once they've signed in — this is just the starting name."}
          </p>
        </div>
        {inviteSuccess && <p className="mt-2 text-sm text-[var(--moss)]">{inviteSuccess}</p>}
        {inviteError && <ErrorNote message={inviteError} />}
      </div>

      <div className="border-t border-[var(--border)] pt-6">
        <div className="mb-3 flex items-baseline justify-between gap-2">
          <h3 className="text-sm font-semibold text-[var(--ink)]">Service roster</h3>
          <span className="rounded-full border border-[var(--border)] bg-[var(--paper)] px-2 py-0.5 font-mono text-[11px] text-[var(--muted)]">
            {(therapists ?? []).filter((t) => t.active).length} active
          </span>
        </div>
        <p className="mb-3 text-xs text-[var(--muted)]">
          Who patients get billed against and assigned to on a visit — every Member above with the
          "Therapist" role gets a roster entry automatically; add one manually here for a therapist
          who doesn't need a login of their own.
        </p>
        <div className="mb-3 divide-y divide-[var(--border)] rounded-xl border border-[var(--border)] bg-[var(--surface)]">
          {(therapists ?? []).map((t) => (
            <div key={t.id} className="flex flex-wrap items-center gap-3 px-4 py-3 text-sm">
              <label
                className="block h-8 w-8 shrink-0 cursor-pointer overflow-hidden rounded-full border border-[var(--border)] bg-[var(--paper)]"
                title="Change photo"
              >
                {t.photoPath ? (
                  <img src={publicTherapistPhotoUrl(t.photoPath) ?? ''} alt="" className="h-full w-full object-cover" />
                ) : (
                  <span className="flex h-full w-full items-center justify-center text-[10px] font-semibold text-[var(--muted)]">
                    {therapistInitials(t.name)}
                  </span>
                )}
                <input
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={(e) => e.target.files?.[0] && void uploadTherapistPhoto(t, e.target.files[0])}
                />
              </label>
              <span className="min-w-32 text-[var(--ink)]">{t.name}</span>
              <input
                key={t.id}
                className={`${inputCls} w-36 text-xs`}
                placeholder="Reg. no."
                title="Registration/license number — printed on invoices"
                defaultValue={t.registrationNo ?? ''}
                onBlur={(e) => {
                  const value = e.target.value.trim() || null;
                  if (value === (t.registrationNo ?? null)) return;
                  void repos.therapists.put({ ...t, registrationNo: value, updatedAt: new Date().toISOString() });
                }}
              />
              <span
                className="rounded-full px-2.5 py-0.5 text-[10.5px] font-semibold"
                style={
                  t.active
                    ? { background: 'var(--moss-light)', color: 'var(--moss-strong)' }
                    : { background: 'var(--paper)', color: 'var(--muted)' }
                }
              >
                {t.active ? 'Active' : 'Inactive'}
              </span>
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
            </div>
          ))}
        </div>
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

/** One "Members" card — view state shows a role-colored avatar, display
 *  name (falling back to email if the member hasn't set one), and a role
 *  pill; edit state swaps the card body for a small inline form. This is
 *  the admin-side counterpart to the self-service name editor in
 *  Shell.tsx's account menu — a member can always rename themselves, and
 *  now an admin can also rename or reassign anyone. */
function MemberCard({
  member,
  clinicId,
  revoking,
  onRevoke,
  onSaved,
}: {
  member: ClinicMember;
  clinicId: string;
  revoking: boolean;
  onRevoke: () => void;
  onSaved: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [nameDraft, setNameDraft] = useState(member.displayName ?? '');
  const [roleDraft, setRoleDraft] = useState<ClinicRole>(member.role as Exclude<ClinicRole, 'unknown'>);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const role = (member.role as Exclude<ClinicRole, 'unknown'>) ?? 'therapist';
  const { color, light } = ACCENT_VARS[ROLE_ACCENT[role] ?? 'slate'];

  async function save() {
    setSaving(true);
    setError(null);
    try {
      const supabase = getSupabase();
      if (!supabase) throw new Error('No Supabase connection');
      const { error: updateError } = await supabase
        .from('clinic_members')
        .update({ display_name: nameDraft.trim() || null, role: roleDraft })
        .eq('clinic_id', clinicId)
        .eq('user_id', member.userId);
      if (updateError) throw updateError;
      setEditing(false);
      onSaved();
    } catch (e) {
      setError(toFriendlyMessage(e));
    } finally {
      setSaving(false);
    }
  }

  if (editing) {
    return (
      <div className="space-y-2 rounded-xl border border-[var(--border)] bg-[var(--surface)] p-3.5 shadow-sm">
        <input
          className={inputCls}
          placeholder="Display name"
          value={nameDraft}
          onChange={(e) => setNameDraft(e.target.value)}
          autoFocus
        />
        <select className={inputCls} value={roleDraft} onChange={(e) => setRoleDraft(e.target.value as ClinicRole)}>
          <option value="therapist">Therapist</option>
          <option value="front_desk">Front desk</option>
          <option value="admin">Admin</option>
        </select>
        <div className="flex gap-2">
          <button className={btnPrimary} disabled={saving} onClick={() => void save()}>
            {saving ? 'Saving…' : 'Save'}
          </button>
          <button className={btnSecondary} disabled={saving} onClick={() => setEditing(false)}>
            Cancel
          </button>
        </div>
        <ErrorNote message={error} />
      </div>
    );
  }

  const displayName = member.displayName ?? member.email;

  return (
    <div className="flex flex-col gap-2.5 rounded-xl border border-[var(--border)] bg-[var(--surface)] p-3.5 shadow-sm">
      <div className="flex items-center gap-2.5">
        <span
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full font-display text-sm font-semibold"
          style={{ background: color, color: '#fff', boxShadow: `0 0 0 3px ${light}` }}
        >
          {therapistInitials(displayName)}
        </span>
        <div className="min-w-0">
          <p className="truncate text-sm font-medium text-[var(--ink)]">{displayName}</p>
          <p className="truncate text-[11.5px] text-[var(--muted)]">{member.email}</p>
        </div>
      </div>
      <RolePill role={role} />
      <div className="flex gap-3.5 border-t border-[var(--border)] pt-2.5 text-xs font-medium">
        <button type="button" className="text-[var(--teal)] hover:underline" onClick={() => setEditing(true)}>
          Edit
        </button>
        <button
          type="button"
          className="ml-auto text-[var(--rust)] hover:underline disabled:opacity-50"
          disabled={revoking}
          onClick={onRevoke}
        >
          {revoking ? 'Revoking…' : 'Revoke'}
        </button>
      </div>
    </div>
  );
}
