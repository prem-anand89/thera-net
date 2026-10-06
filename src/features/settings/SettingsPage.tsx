import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from 'react';
import { Link, useBlocker, useNavigate, useSearch } from '@tanstack/react-router';
import { useLiveQuery } from 'dexie-react-hooks';
import {
  repos,
  backupService,
  therapistService,
  visitService,
  whatsappBusinessService,
} from '@/services';
import type { BackupBundle, RestoreSummary } from '@/services/backupService';
import { therapistColor } from '@/components/schedule/scheduleColors';
import { useClinic } from '@/app/clinicContext';
import { usePermissions } from '@/app/usePermissions';
import { useEntitlements } from '@/app/useEntitlements';
import { CLINIC_ROLE_LABELS, type ClinicRole } from '@/app/useClinicRole';
import { PLAN_TIER_LABELS, minimumTierFor, type PlanFeature } from '@/domain/plans';
import { getSupabase, publicTherapistPhotoUrl, publicLogoUrl } from '@/lib/supabase';
import { resizeImageToBlob } from '@/lib/resizeImage';
import { db } from '@/lib/db';
import { MONTH_NAMES, formatDateDM } from '@/domain/fiscalYear';
import { clinicShareLabels, type Clinic, type InvoicePolicy, type Therapist, type UUID } from '@/domain/types';
import {
  memberOnboardingStatus,
  MEMBER_ONBOARDING_LABELS,
  type MemberOnboardingStatus,
} from '@/domain/memberOnboarding';
import type { TdsBasis } from '@/domain/split';
import {
  Field,
  inputCls,
  btnPrimary,
  btnSecondary,
  ErrorNote,
  SectionCard,
  ConfirmDialog,
  InfoTip,
  Pill,
  StatTile,
} from '@/components/ui';
import { CatalogSection, type CatalogView } from './CatalogSection';
import { LetterheadPreview } from './LetterheadPreview';
import {
  SETTINGS_TABS,
  SETTINGS_TAB_META,
  matchSettingsCards,
  type SettingsCard,
  type SettingsTab,
} from './sections';
import { toFriendlyMessage } from '@/lib/errors';
import { lastBackupMetaKey } from '@/domain/setupGuide';
import { SetupProgressBar } from '@/features/setup/SetupProgressBar';
import { isValidUpiVpa } from '@/domain/upiPay';

/** Accent hues used by the Danger zone, team cards and other in-section badges. */
type Accent = 'teal' | 'amber' | 'rust' | 'moss' | 'slate';

const ACCENT_VARS: Record<Accent, { color: string; light: string }> = {
  teal: { color: 'var(--teal)', light: 'var(--teal-light)' },
  amber: { color: 'var(--amber)', light: 'var(--amber-light)' },
  rust: { color: 'var(--rust)', light: 'var(--rust-light)' },
  moss: { color: 'var(--moss)', light: 'var(--moss-light)' },
  slate: { color: 'var(--slate)', light: 'var(--slate-light)' },
};

/** Sections that edit a slice of the clinic row and report unsaved edits.
 *  A tab can hold more than one (Billing holds billing + partner). */
type FormKey = 'profile' | 'billing' | 'partner' | 'patientComms';

const FORM_TAB: Record<FormKey, SettingsTab> = {
  profile: 'general',
  billing: 'billing',
  partner: 'billing',
  patientComms: 'booking',
};

const TAB_ICON_PATHS: Record<SettingsTab, string> = {
  general: 'M2.5 3h11v10h-11zM5.5 6h5M5.5 8.3h5M5.5 10.6h3',
  team: 'M2.3 13c.4-2.5 2-3.9 3.9-3.9s3.5 1.4 3.9 3.9M9.9 9.5c1.6.2 2.8 1.4 3.1 3.5',
  services: 'M3 4h10M3 8h10M3 12h6',
  booking: 'M2.5 4.5h11v6.5h-6.2L4.5 13.5V11h-2zM5 7h6M5 9h4',
  billing: 'M2.5 6.5L8 2.8l5.5 3.7M3.7 5.8V12a1 1 0 001 1h6.6a1 1 0 001-1V5.8',
  account: 'M3 5c0-1.1 2.2-2 5-2s5 .9 5 2-2.2 2-5 2-5-.9-5-2zM3 5v6c0 1.1 2.2 2 5 2s5-.9 5-2V5M3 8c0 1.1 2.2 2 5 2s5-.9 5-2',
};

function TabIcon({ tab }: { tab: SettingsTab }) {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden className="shrink-0">
      {tab === 'team' && <circle cx="6" cy="5.3" r="2" stroke="currentColor" strokeWidth="1.4" />}
      <path
        d={TAB_ICON_PATHS[tab]}
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function SettingsTabButton({
  tab,
  active,
  dirty,
  onSelect,
  variant,
}: {
  tab: SettingsTab;
  active: boolean;
  dirty: boolean;
  onSelect: () => void;
  variant: 'chip' | 'rail';
}) {
  const label = SETTINGS_TAB_META[tab].label;
  const base =
    variant === 'chip'
      ? 'flex min-h-11 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full border px-3.5 text-sm font-medium'
      : 'flex min-h-10 w-full items-center gap-2.5 rounded-lg px-3 text-left text-sm font-medium';
  const state = active
    ? variant === 'chip'
      ? 'border-[var(--teal)] bg-[var(--teal-light)] text-[var(--teal-strong)]'
      : 'bg-[var(--teal-light)] text-[var(--teal-strong)]'
    : variant === 'chip'
      ? 'border-[var(--border)] bg-[var(--surface)] text-[var(--muted)] hover:text-[var(--ink)]'
      : 'text-[var(--muted)] hover:bg-[var(--paper)] hover:text-[var(--ink)]';
  return (
    <button
      type="button"
      data-section={tab}
      aria-current={active ? 'page' : undefined}
      onClick={onSelect}
      className={`${base} ${state}`}
    >
      <TabIcon tab={tab} />
      <span className={variant === 'rail' ? 'flex-1' : undefined}>{label}</span>
      {dirty && (
        <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-[var(--rust)]" aria-label="Unsaved changes" />
      )}
    </button>
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

/**
 * Settings search. A pill with a magnifier; results float over the page in a
 * dropdown, so they never push content down. `compact` sits above the chips
 * on phones and iPads, `rail` at the top of the desktop sidebar.
 */
function SettingsSearch({
  variant,
  className,
  query,
  onQueryChange,
  onPick,
}: {
  variant: 'compact' | 'rail';
  className?: string;
  query: string;
  onQueryChange: (q: string) => void;
  onPick: (card: SettingsCard) => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const results = matchSettingsCards(query);
  const listId = `settings-search-results-${variant}`;

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open]);

  const height = variant === 'rail' ? 'h-9 text-[13px]' : 'h-10 text-sm';

  return (
    <div ref={ref} className={`relative ${className ?? ''}`}>
      <label className="sr-only" htmlFor={`settings-search-${variant}`}>
        Search settings
      </label>
      <svg
        aria-hidden
        viewBox="0 0 16 16"
        fill="none"
        className="pointer-events-none absolute left-3.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[var(--muted)]"
      >
        <circle cx="7" cy="7" r="4.5" stroke="currentColor" strokeWidth="1.5" />
        <path d="M10.5 10.5L14 14" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      </svg>
      <input
        id={`settings-search-${variant}`}
        type="search"
        role="combobox"
        aria-expanded={open && query.trim() !== ''}
        aria-controls={listId}
        aria-autocomplete="list"
        autoComplete="off"
        value={query}
        placeholder="Search settings"
        onFocus={() => setOpen(true)}
        onChange={(e) => {
          onQueryChange(e.target.value);
          setOpen(true);
        }}
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            onQueryChange('');
            setOpen(false);
          } else if (e.key === 'Enter' && results[0]) {
            e.preventDefault();
            onPick(results[0]);
          }
        }}
        className={`${height} w-full rounded-full border border-[var(--border)] bg-[var(--surface)] pl-9 pr-3.5 text-[var(--ink)] placeholder:text-[var(--muted)] focus:border-[var(--teal)] focus:outline-none focus:ring-2 focus:ring-[var(--teal)]/20`}
      />
      {open && query.trim() && (
        <ul
          id={listId}
          role="listbox"
          className="absolute left-0 right-0 top-full z-30 mt-1.5 max-h-[60vh] min-w-56 overflow-y-auto rounded-xl border border-[var(--border)] bg-[var(--surface)] py-1 shadow-lg"
        >
          {results.map((card) => (
            <li key={card.id} role="option" aria-selected={false}>
              <button
                type="button"
                className="flex min-h-10 w-full items-center justify-between gap-3 px-3 py-1.5 text-left hover:bg-[var(--paper)]"
                onClick={() => {
                  setOpen(false);
                  onPick(card);
                }}
              >
                <span className="min-w-0 truncate text-sm font-medium text-[var(--ink)]">{card.title}</span>
                <span className="shrink-0 text-[11px] text-[var(--muted)]">{SETTINGS_TAB_META[card.tab].label}</span>
              </button>
            </li>
          ))}
          {results.length === 0 && (
            <li className="px-3 py-2.5 text-sm text-[var(--muted)]">No settings match “{query.trim()}”.</li>
          )}
        </ul>
      )}
    </div>
  );
}

export function SettingsPage() {
  const clinic = useClinic();
  const { canEditSettings } = usePermissions();
  const search = useSearch({ from: '/settings' });
  const navigate = useNavigate({ from: '/settings' });
  const [activeTab, setActiveTabState] = useState<SettingsTab>(search.tab ?? 'general');
  const catalogView: CatalogView = search.catalogView ?? 'packages';
  const [, startTransition] = useTransition();
  const [dirtyForms, setDirtyForms] = useState<Set<FormKey>>(new Set());
  // A jump target: the tab (plus Services sub-view) and optionally the card to
  // scroll to. Used for tab clicks, search results and the discard dialog.
  type Target = { tab: SettingsTab; catalogView?: CatalogView; anchor?: string };
  const [pendingTarget, setPendingTarget] = useState<Target | null>(null);
  const [anchor, setAnchor] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const mobileNavRef = useRef<HTMLDivElement>(null);
  const therapists = useLiveQuery(() => repos.therapists.list(clinic.id, true), [clinic.id]);
  const unlinkedCount = (therapists ?? []).filter((t) => t.active && !t.userId).length;
  const catalog = useLiveQuery(() => repos.catalog.list(clinic.id), [clinic.id]);
  const catalogEmpty = catalog !== undefined && catalog.length === 0;
  const entitlements = useEntitlements(clinic.id);
  // Partner is hidden (not locked) below the Clinic tier — a Lite/Solo
  // clinic can't have a partner split under its plan, so offering it as an
  // upsell would mislead. Billing stays visible but locked: hiding a paid
  // feature is how you get zero upgrades.
  const canSeePartner = entitlements.can('revenueSplit');
  const canSeeBilling = entitlements.can('invoicing');

  const tabDirty = (tab: SettingsTab) => [...dirtyForms].some((k) => FORM_TAB[k] === tab);
  const anyDirtyRef = useRef(false);
  anyDirtyRef.current = dirtyForms.size > 0;

  // Leaving Settings entirely (another page, reload, closing the tab) with
  // unsaved edits. Switching tabs inside Settings has its own dialog below.
  useBlocker({
    shouldBlockFn: ({ next }) => {
      if (!anyDirtyRef.current || next.pathname === '/settings') return false;
      return !confirm('You have unsaved changes in Settings. Leave without saving?');
    },
    enableBeforeUnload: () => anyDirtyRef.current,
  });

  function setCatalogView(view: CatalogView) {
    void navigate({
      search: (prev) => ({ ...prev, tab: 'services', catalogView: view }),
      replace: true,
    });
  }

  // `replace` so switching tabs doesn't fill browser history. The state
  // update runs in a transition: a tab swap renders a whole heavy section in
  // one commit, which otherwise shows up as a slow-input (INP) warning on
  // the nav click.
  function setActiveTab(tab: SettingsTab, view?: CatalogView) {
    startTransition(() => {
      setActiveTabState(tab);
    });
    void navigate({
      search: (prev) => {
        const next = tab === 'services' && view ? { tab, catalogView: view } : { tab };
        return prev.fromSetup ? { ...next, fromSetup: true } : next;
      },
      replace: true,
    });
  }

  function goTo(target: Target) {
    if (target.tab !== activeTab && tabDirty(activeTab)) {
      setPendingTarget(target);
      return;
    }
    setAnchor(target.anchor ?? null);
    setActiveTab(target.tab, target.catalogView);
  }

  // After a card jump, the target tab may still be loading its data, so the
  // card can appear a few frames late. Retry briefly, then highlight it.
  useEffect(() => {
    if (!anchor) return;
    let tries = 0;
    let frame = 0;
    const attempt = () => {
      const el = document.getElementById(anchor);
      if (el) {
        el.scrollIntoView({ behavior: 'smooth', block: 'start' });
        el.classList.add('settings-card-highlight');
        window.setTimeout(() => el.classList.remove('settings-card-highlight'), 1600);
        setAnchor(null);
        return;
      }
      if (tries++ < 60) frame = requestAnimationFrame(attempt);
      else setAnchor(null);
    };
    frame = requestAnimationFrame(attempt);
    return () => cancelAnimationFrame(frame);
  }, [anchor, activeTab, catalogView]);



  // Default landing when no ?tab= was given: Team if anyone is unlinked,
  // Services while the catalog is empty (the week-one blocker), else General.
  const [landedOnDefault, setLandedOnDefault] = useState(!!search.tab);
  useEffect(() => {
    if (landedOnDefault || therapists === undefined || catalog === undefined) return;
    setActiveTab(unlinkedCount > 0 ? 'team' : catalogEmpty ? 'services' : 'general');
    setLandedOnDefault(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [landedOnDefault, therapists, catalog, unlinkedCount, catalogEmpty]);

  // A link (setup step, closed-days sheet) can change ?tab= while Settings is
  // already open; follow it.
  useEffect(() => {
    if (search.tab && search.tab !== activeTab) setActiveTabState(search.tab);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search.tab]);

  // Keep the active chip visible in the horizontal strip.
  useEffect(() => {
    const el = mobileNavRef.current?.querySelector(`[data-section="${activeTab}"]`);
    el?.scrollIntoView({ inline: 'nearest', block: 'nearest', behavior: 'smooth' });
  }, [activeTab]);


  // Sections that edit the clinic row report unsaved state up here, so
  // switching tabs or leaving can warn before discarding it. Team, Services
  // and Account act immediately per row or button and never report dirty.
  const setProfileDirty = useCallback((d: boolean) => setDirtyForms((s) => toggleSet(s, 'profile', d)), []);
  const setBillingDirty = useCallback((d: boolean) => setDirtyForms((s) => toggleSet(s, 'billing', d)), []);
  const setPartnerDirty = useCallback((d: boolean) => setDirtyForms((s) => toggleSet(s, 'partner', d)), []);
  const setPatientCommsDirty = useCallback(
    (d: boolean) => setDirtyForms((s) => toggleSet(s, 'patientComms', d)),
    []
  );

  function selectTab(tab: SettingsTab) {
    if (tab === activeTab) return;
    goTo({ tab });
  }

  function pickCard(card: SettingsCard) {
    setQuery('');
    goTo({ tab: card.tab, catalogView: card.catalogView, anchor: card.id });
  }

  // Nav already hides Settings for non-admins; this covers a direct URL hit.
  // The real boundary is RLS on clinics/therapists/service_catalog.
  if (!canEditSettings) {
    return (
      <div className="space-y-4">
        <h1 className="font-display text-lg font-semibold text-[var(--ink)]">Settings</h1>
        <p className="text-sm text-[var(--muted)]">
          Settings are managed by your clinic admin. Your own profile and notifications are in the account menu.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="font-display text-lg font-semibold text-[var(--ink)]">Settings</h1>
        {search.fromSetup && (
          <Link
            to="/setup"
            className="inline-flex items-center gap-1.5 rounded-full bg-[var(--teal-light)] px-3 py-1 text-sm font-medium text-[var(--teal-strong)] hover:bg-[var(--teal)]/20"
          >
            ← Back to setup
          </Link>
        )}
      </div>

      <SetupProgressBar clinicId={clinic.id} />

      <SettingsSearch
        variant="compact"
        className="desktop:hidden"
        query={query}
        onQueryChange={setQuery}
        onPick={pickCard}
      />

      <div className="desktop:flex desktop:items-start desktop:gap-6">
        {/* Chips on phones and through iPad portrait; the side rail only once
            there's laptop width to spare (a `tab:` rail left iPad portrait
            with a ~500px content column). */}
        <nav
          ref={mobileNavRef}
          aria-label="Settings sections"
          className="-mx-4 mb-4 flex gap-2 overflow-x-auto px-4 pb-1 [scrollbar-width:none] desktop:hidden"
        >
          {SETTINGS_TABS.map((tab) => (
            <SettingsTabButton
              key={tab}
              tab={tab}
              active={activeTab === tab}
              dirty={tabDirty(tab)}
              onSelect={() => selectTab(tab)}
              variant="chip"
            />
          ))}
        </nav>
        <div className="hidden desktop:sticky desktop:top-20 desktop:block desktop:w-52 desktop:shrink-0">
          <SettingsSearch
            variant="rail"
            className="mb-3"
            query={query}
            onQueryChange={setQuery}
            onPick={pickCard}
          />
          <nav
            aria-label="Settings sections"
            className="flex flex-col gap-0.5"
          >
          {SETTINGS_TABS.map((tab) => (
            <SettingsTabButton
              key={tab}
              tab={tab}
              active={activeTab === tab}
              dirty={tabDirty(tab)}
              onSelect={() => selectTab(tab)}
              variant="rail"
            />
          ))}
          </nav>
        </div>

        <div className="mx-auto min-w-0 max-w-2xl flex-1 space-y-6 desktop:mx-0 desktop:max-w-none">
          <div>
            <h2 className="font-display text-xl font-semibold text-[var(--ink)]">
              {SETTINGS_TAB_META[activeTab].label}
            </h2>
            <p className="mt-0.5 text-sm text-[var(--muted)]">{SETTINGS_TAB_META[activeTab].description}</p>
          </div>
          {activeTab === 'general' && <ClinicProfileSection onDirtyChange={setProfileDirty} />}
          {activeTab === 'team' && (
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
          {activeTab === 'services' && <CatalogSection view={catalogView} onViewChange={setCatalogView} />}
          {activeTab === 'booking' && <PatientCommsSection onDirtyChange={setPatientCommsDirty} />}
          {activeTab === 'billing' && (
            <>
              {canSeeBilling ? (
                <BillingSection onDirtyChange={setBillingDirty} />
              ) : (
                <LockedSectionNotice feature="invoicing" sectionLabel="Billing & invoicing" />
              )}
              {canSeePartner && <PartnerSection onDirtyChange={setPartnerDirty} />}
            </>
          )}
          {activeTab === 'account' && (
            <>
              <PlanSection />
              <HistoricalData />
              <DataBackup />
              <DangerZone />
            </>
          )}
        </div>
      </div>

      <ConfirmDialog
        open={pendingTarget !== null}
        title="Discard unsaved changes?"
        message="This section has unsaved changes. Discard them and switch?"
        confirmLabel="Discard and switch"
        destructive
        onCancel={() => setPendingTarget(null)}
        onConfirm={() => {
          if (pendingTarget) {
            setAnchor(pendingTarget.anchor ?? null);
            setActiveTab(pendingTarget.tab, pendingTarget.catalogView);
          }
          setPendingTarget(null);
        }}
      />
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
  // Hydrate once per mount, not on every `initial` change. `clinic` (from
  // useClinic()) is a new object reference on any write to the clinics row
  // — another admin saving a different section, or this section's own save
  // landing back via the sync pull — and without this guard the effect
  // below would silently overwrite whatever the user is mid-typing here.
  // Not needed for the post-save case: `initial` catching up to match the
  // just-saved `form` already makes `dirty` false via the comparison below,
  // with no need to reassign `form` itself. Each section unmounts on tab
  // switch (SettingsPage's `activeKey === 'x' &&` rendering), so returning
  // to this tab later re-mounts fresh and re-hydrates correctly.
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    if (loaded) return;
    setForm(initial);
    setLoaded(true);
  }, [initial, loaded]);

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

  async function save(): Promise<boolean> {
    setError(null);
    setBusy(true);
    try {
      const current = await repos.clinics.get(clinic.id);
      if (!current) throw new Error('Clinic not found');
      await repos.clinics.put({ ...current, ...form, updatedAt: new Date().toISOString() });
      setSaved(true);
      return true;
    } catch (e) {
      setError(toFriendlyMessage(e));
      return false;
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
  saveDisabled,
}: {
  dirty: boolean;
  saved: boolean;
  busy: boolean;
  onSave: () => void;
  onCancel: () => void;
  error: string | null;
  saveDisabled?: boolean;
}) {
  return (
    <>
      <div className="mt-4 flex items-center gap-3">
        <button
          type="button"
          className={btnPrimary}
          disabled={busy || !dirty || saveDisabled}
          onClick={onSave}
        >
          {busy ? 'Saving…' : 'Save'}
        </button>
        <button type="button" className={btnSecondary} disabled={!dirty} onClick={onCancel}>
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

const PLAN_STATUS_LABELS: Record<'active' | 'past_due' | 'read_only', string> = {
  active: 'Active',
  past_due: 'Past due',
  read_only: 'Read-only',
};

/**
 * Placeholder shown instead of a section's real content once it's above the
 * clinic's plan tier. Informational only, no CTA — there's no self-serve
 * upgrade flow yet (tier changes are still a manual update, see
 * FEATURES_AND_SCHEMA.md's clinic_plans section); a real "Upgrade" button
 * would go nowhere. Revisit once one exists.
 */
function LockedSectionNotice({
  feature,
  sectionLabel,
}: {
  feature: PlanFeature;
  sectionLabel: string;
}) {
  return (
    <div className="rounded-2xl border border-[var(--border)] bg-[var(--paper)] p-8 text-center">
      <p className="text-sm font-medium text-[var(--ink)]">
        {sectionLabel} isn’t included in your plan.
      </p>
      <p className="mt-1 text-xs text-[var(--muted)]">
        Included in {PLAN_TIER_LABELS[minimumTierFor(feature)]} and above.
      </p>
    </div>
  );
}

/** Read-only — nothing here is admin-editable, matching the server model
 *  (clinic_plans has no write policy at all; see Phase 0 of the tier plan). */
function PlanSection() {
  const clinic = useClinic();
  const entitlements = useEntitlements(clinic.id);
  const {
    tier,
    status,
    maxMembers,
    visitCapPerMonth,
    seatsUsed,
    visitsThisMonth,
    loading,
    enforcementEnabled,
  } = entitlements;
  const statusTone = status === 'active' ? 'green' : status === 'read_only' ? 'amber' : 'slate';
  const features: { key: PlanFeature; label: string }[] = [
    { key: 'invoicing', label: 'Billing & invoicing' },
    { key: 'team', label: 'Multiple team logins' },
    { key: 'revenueSplit', label: 'Hospital revenue split & attribution audit' },
    { key: 'advancedModules', label: 'Advanced assessment modules' },
  ];

  return (
    <div className="space-y-4">
      <SectionCard id="settings-card-account-plan" title="Your plan">
        <div className="flex flex-wrap items-center gap-3">
          <span className="font-display text-lg font-semibold text-[var(--ink)]">
            {loading ? '…' : PLAN_TIER_LABELS[tier]}
          </span>
          {!loading && <Pill tone={statusTone}>{PLAN_STATUS_LABELS[status]}</Pill>}
        </div>
        {!loading && !enforcementEnabled && (
          <p className="mt-2 text-xs text-[var(--muted)]">
            Tier limits are paused for pilot testing — every plan currently has full access
            regardless of what's shown below.
          </p>
        )}
        {status === 'read_only' && (
          <p className="mt-2 text-xs text-[var(--rust)]">
            New visits, invoices, and patients are on hold until payment resumes. Existing records
            stay fully visible.
          </p>
        )}
        <div className="mt-4 grid grid-cols-2 gap-3 sm:w-fit sm:grid-cols-2">
          <StatTile
            label="Seats"
            value={seatsUsed == null ? `— / ${maxMembers}` : `${seatsUsed} / ${maxMembers}`}
          />
          <StatTile
            label="Visits this month"
            value={
              visitCapPerMonth == null
                ? `${visitsThisMonth}`
                : `${visitsThisMonth} / ${visitCapPerMonth}`
            }
          />
        </div>
      </SectionCard>
      <SectionCard id="settings-card-account-included" title="What's included">
        <ul className="divide-y divide-[var(--border)]">
          {features.map((f) => (
            <li
              key={f.key}
              className="flex items-center justify-between gap-3 py-2 text-sm first:pt-0 last:pb-0"
            >
              <span className="text-[var(--ink)]">{f.label}</span>
              {entitlements.can(f.key) ? (
                <Pill tone="green">Included</Pill>
              ) : (
                <span className="text-right text-xs text-[var(--muted)]">
                  Included in {PLAN_TIER_LABELS[minimumTierFor(f.key)]} and above
                </span>
              )}
            </li>
          ))}
        </ul>
      </SectionCard>
    </div>
  );
}

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

/** Opens a set-once card for editing. Reads and writes stay the same; this
 *  only unlocks the fields until the save goes through. */
function SetOnceEditButton({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button 
      type="button" 
      aria-label={label} 
      className="flex items-center gap-1.5 min-h-[36px] rounded-lg bg-[var(--paper)] px-3.5 py-1.5 text-sm font-semibold text-[var(--ink)] hover:bg-[var(--border)] transition-colors border border-[var(--border)] shadow-sm" 
      onClick={onClick}
    >
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path></svg>
      Edit
    </button>
  );
}

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
    <div className="desktop:flex desktop:items-start desktop:gap-6">
      <div className="flex-1 min-w-0 space-y-6">
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
                        <input 
                          className={inputCls} 
                          value={form.phone ?? ''} 
                          onChange={(e) => set({ phone: e.target.value || null })} 
                          placeholder="Phone number" 
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
        
        {/* On mobile, stack the letterhead preview cleanly rather than burying in a details tag */}
        <div className="desktop:hidden">
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
      
      <div className="hidden desktop:sticky desktop:top-20 desktop:block desktop:w-[16rem] desktop:shrink-0">
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

type BillingFields = Pick<
  Clinic,
  | 'invoicePrefix'
  | 'gstNo'
  | 'fyStartMonth'
  | 'clinicalDocsEnabled'
  | 'billingEnabled'
  | 'invoicingAccess'
  | 'invoicePolicy'
  | 'upiVpa'
  | 'upiPayeeName'
  | 'upiQrPath'
  | 'upiQrEnabled'
>;

function BillingSection({ onDirtyChange }: { onDirtyChange: (dirty: boolean) => void }) {
  const { clinic, form, set, save, cancel, saveFieldNow, dirty, saved, busy, error, setError } =
    useClinicSectionForm<BillingFields>(
      (c) => ({
        invoicePrefix: c.invoicePrefix,
        gstNo: c.gstNo,
        fyStartMonth: c.fyStartMonth,
        clinicalDocsEnabled: c.clinicalDocsEnabled ?? false,
        billingEnabled: c.billingEnabled ?? true,
        invoicingAccess: c.invoicingAccess ?? 'everyone',
        invoicePolicy: c.invoicePolicy ?? 'on_request',
        upiVpa: c.upiVpa ?? '',
        upiPayeeName: c.upiPayeeName ?? '',
        upiQrPath: c.upiQrPath ?? null,
        upiQrEnabled: c.upiQrEnabled ?? false,
      }),
      onDirtyChange
    );
  const [editing, setEditing] = useState(false);
  useEffect(() => {
    if (editing && saved && !dirty) setEditing(false);
  }, [editing, saved, dirty]);
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
    await saveFieldNow({ upiQrPath: path } as Partial<BillingFields>);
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
    <SectionCard
      id="settings-card-billing-invoicing"
      title="Modules & invoicing"
      action={editing ? undefined : <SetOnceEditButton label="Edit modules & invoicing" onClick={() => setEditing(true)} />}
    >
      <fieldset disabled={!editing} className="contents">
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
          <input
            className={inputCls}
            value={form.gstNo ?? ''}
            onChange={(e) => set({ gstNo: e.target.value || null })}
          />
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
              Clinical documentation module
              <InfoTip text="Enables clinical notes for visits. When off, therapists can still access notes from a patient's profile, but visit workflows won't prompt for them." />
            </>
          }
        >
          <BoolToggle
            value={form.clinicalDocsEnabled ?? false}
            onChange={(v) => set({ clinicalDocsEnabled: v })}
          />
        </Field>
        <Field
          label={
            <>
              Billing module
              <InfoTip text="Off for clinics that bill entirely through a partner's own system — hides Invoices everywhere, for everyone, regardless of role." />
            </>
          }
        >
          <BoolToggle
            value={form.billingEnabled ?? true}
            onChange={(v) => set({ billingEnabled: v })}
          />
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
              onChange={(e) =>
                set({ invoicingAccess: e.target.value as 'everyone' | 'billing_staff' })
              }
            >
              <option value="everyone">Everyone</option>
              <option value="billing_staff">Front desk and admins only</option>
            </select>
          </Field>
        )}
        {form.billingEnabled && (
          <Field
            label={
              <>
                Bills after a visit
                <InfoTip text="Payments are always recorded. A bill (invoice) is a separate numbered document that can't be edited once given — so it's your call when to offer it." />
              </>
            }
          >
            <select
              className={inputCls}
              value={form.invoicePolicy ?? 'on_request'}
              onChange={(e) => set({ invoicePolicy: e.target.value as InvoicePolicy })}
            >
              <option value="on_request">On request — a "Give bill" button after each visit</option>
              <option value="always">Always — open the bill step after a paid visit</option>
              <option value="never_nag">Never remind — hide the Needs receipt list</option>
            </select>
          </Field>
        )}
      </div>

      <h3 className="font-display mt-6 mb-3 text-sm font-semibold text-[var(--ink)]">
        UPI collection
      </h3>
      <p className="mb-3 text-xs text-[var(--muted)]">
        One clinic UPI for the front desk. When collection method is UPI, staff can show a QR the
        patient scans. A UPI ID builds a QR with the visit amount and Patient ID in the note; an
        uploaded image is the fallback.
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
          <BoolToggle
            value={form.upiQrEnabled ?? false}
            onChange={(v) => set({ upiQrEnabled: v })}
          />
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
                <img
                  src={qrPreviewUrl}
                  alt="Uploaded clinic UPI QR"
                  className="mt-2 h-24 w-24 object-contain"
                />
              )}
            </Field>
          </>
        )}
      </div>


      </fieldset>
      {editing && (
        <p className="mt-3 rounded-lg bg-[var(--amber-light)] px-3 py-2 text-xs text-[var(--ink)]">
          The invoice prefix, fiscal year and tax apply to invoices issued from now on. Invoices already issued keep their numbers and rates.
        </p>
      )}
      {editing && (
      <SectionSaveBar
        dirty={dirty}
        saved={saved}
        busy={busy}
        onSave={() => void saveBilling()}
        onCancel={() => {
          cancel();
          setEditing(false);
        }}
        error={error}
      />
      )}
    </SectionCard>
  );
}

type PartnerFields = Pick<
  Clinic,
  | 'enableTherapistSplit'
  | 'ownShareLabel'
  | 'partnerShareLabel'
  | 'clinicSplitPct'
  | 'taxPct'
  | 'tdsBasis'
  | 'lastSplitChangeAt'
>;

// These fields are read together by clinicBillingConfig() to determine
// partnerSplit/therapistSplit — kept in one section/save so they can never
// go out of sync with each other mid-edit.
function PartnerSection({ onDirtyChange }: { onDirtyChange: (dirty: boolean) => void }) {
  const clinic_ctx = useClinic();
  const { clinic, form, set, save, cancel, saveFieldNow, dirty, saved, busy, error, setError } =
    useClinicSectionForm<PartnerFields>(
      (c) => ({
        enableTherapistSplit: c.enableTherapistSplit,
        ownShareLabel: c.ownShareLabel,
        partnerShareLabel: c.partnerShareLabel,
        clinicSplitPct: c.clinicSplitPct,
        taxPct: c.taxPct,
        tdsBasis: c.tdsBasis,
      }),
      onDirtyChange
    );
  const [editing, setEditing] = useState(false);
  useEffect(() => {
    if (editing && saved && !dirty) setEditing(false);
  }, [editing, saved, dirty]);
  const labels = clinicShareLabels(form);
  const [recomputeMsg, setRecomputeMsg] = useState<string | null>(null);

  if (!clinic_ctx.hasPartner) return null;

  // hasPartner/clinicSplitPct/taxPct/tdsBasis all feed clinicBillingConfig() and
  // computeVisitSplit() — a change to any of them means visits already
  // logged (but not yet invoiced) are now showing a stale split, since
  // updateBilling deliberately keeps a visit's ORIGINAL rate snapshot on
  // edit. Catch those up here, right where the rate actually changed,
  // instead of leaving it to silently only affect visits logged from now on.
  async function savePartner() {
    setRecomputeMsg(null);
    const splitAffected =
      form.clinicSplitPct !== clinic.clinicSplitPct ||
      form.taxPct !== clinic.taxPct ||
      form.tdsBasis !== clinic.tdsBasis;
    const ok = await save();
    if (ok && splitAffected) {
      await saveFieldNow({ lastSplitChangeAt: new Date().toISOString() });
      try {
        const { updated } = await visitService.recomputeUninvoicedSplits(clinic.id);
        setRecomputeMsg(
          updated > 0
            ? `Applied the new split to ${updated} already-logged, not-yet-invoiced visit${updated === 1 ? '' : 's'}.`
            : 'No not-yet-invoiced visits needed updating.'
        );
      } catch (e) {
        setError(toFriendlyMessage(e));
      }
    }
  }



  return (
    <SectionCard
      id="settings-card-billing-partner"
      title="Partner & split"
      action={editing ? undefined : <SetOnceEditButton label="Edit partner & split" onClick={() => setEditing(true)} />}
    >
      <fieldset disabled={!editing} className="contents">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
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
            value={form.clinicSplitPct}
            onChange={(e) => set({ clinicSplitPct: Number(e.target.value) })}
          />
        </Field>
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
        {form.taxPct > 0 && (
          <Field
            label={
              <>
                TDS basis
                <InfoTip text="Whether the tax % is calculated on the full bill (standard format) or only on the clinic's own share. Both produce the same final clinic payout." />
              </>
            }
          >
            <select
              className={inputCls}
              value={form.tdsBasis}
              onChange={(e) => set({ tdsBasis: e.target.value as TdsBasis })}
            >
              <option value="gross_bill">
                {form.taxPct}% of gross bill (matches {labels.partner} sheet)
              </option>
              <option value="clinic_share">On clinic share only</option>
            </select>
          </Field>
        )}
      </div>
      <p className="mt-3 text-xs text-[var(--muted)]">
        Split/tax changes apply going forward automatically, and — on Save — also to any
        already-logged visit that hasn't been invoiced yet. Invoiced visits keep the rates they were
        billed under.
      </p>
      {recomputeMsg && <p className="mt-1 text-xs text-[var(--moss)]">{recomputeMsg}</p>}
      </fieldset>
      {editing && (
      <SectionSaveBar
        dirty={dirty}
        saved={saved}
        busy={busy}
        onSave={() => void savePartner()}
        onCancel={() => {
          cancel();
          setEditing(false);
        }}
        error={error}
      />
      )}
    </SectionCard>
  );
}

type PatientCommsFields = Pick<Clinic, 'enablePatientComms' | 'googleReviewUrl' | 'bookingSlug' | 'bookingStartHour' | 'bookingEndHour' | 'closedWeekdays' | 'slotDurationMinutes'>;

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
function PatientCommsSection({ onDirtyChange: _onDirtyChange }: { onDirtyChange: (dirty: boolean) => void }) {
  const clinic = useClinic();
  const { form, set, save, cancel, dirty, saved, busy, error } =
    useClinicSectionForm<PatientCommsFields>(
      (c) => ({
        enablePatientComms: c.enablePatientComms ?? false,
        googleReviewUrl: c.googleReviewUrl ?? null,
        bookingSlug: c.bookingSlug ?? null,
        bookingStartHour: c.bookingStartHour ?? 9,
        bookingEndHour: c.bookingEndHour ?? 17,
        closedWeekdays: c.closedWeekdays ?? [],
        slotDurationMinutes: c.slotDurationMinutes ?? 30,
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
    <SectionCard id="settings-card-booking-hours" title="Hours & closures">
      <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2 pt-4 border-t border-[var(--border)]">
        <Field
          label={
            <>
              Booking hours
              <InfoTip text="The earliest and latest times patients can request an appointment." />
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
            <span className="text-[var(--muted)]">to</span>
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
              Appointment duration
              <InfoTip text="The length of a standard appointment. This controls the time blocks shown on the schedule and public booking page." />
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
              Closed days
              <InfoTip text="Select the days of the week your clinic is regularly closed." />
            </>
          }
        >
          <div className="flex flex-wrap gap-2">
            {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((day, idx) => {
              const isClosed = form.closedWeekdays?.includes(idx);
              return (
                <button
                  key={idx}
                  type="button"
                  className={`rounded-full border px-3 py-1 text-xs font-medium transition-colors ${
                    isClosed
                      ? 'bg-[var(--rust)] border-[var(--rust)] text-white'
                      : 'bg-white border-[var(--border)] text-[var(--ink)] hover:border-[var(--rust)]'
                  }`}
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
        <p className="text-xs text-[var(--muted)]">
          Holidays and one-off closures, and each therapist’s hours, are set in Schedule.
        </p>
      </div>
      <SectionSaveBar
        dirty={dirty}
        saved={saved}
        busy={busy}
        onSave={() => void save()}
        onCancel={cancel}
        error={slugInvalid ? 'Fix the booking link before saving.' : error}
        saveDisabled={slugInvalid}
      />
      <WhatsAppBusinessSubsection clinicId={clinic.id} />
    </SectionCard>
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
function WhatsAppBusinessSubsection({ clinicId }: { clinicId: UUID }) {
  // HIDDEN: The Meta API integration is currently too complex for average users to setup (requires Meta Business Verification). 
  // We are hiding this UI to prevent confusion and sticking to wa.me deep links.
  return null;
  
  const [expanded, setExpanded] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [enabled, setEnabled] = useState(false);
  const [phoneNumberId, setPhoneNumberId] = useState('');
  const [hasToken, setHasToken] = useState(false);
  const [accessTokenInput, setAccessTokenInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!expanded || loaded) return;
    void whatsappBusinessService
      .getConfigStatus(clinicId)
      .then((status) => {
        if (status) {
          setEnabled(status.enabled);
          setPhoneNumberId(status.phoneNumberId ?? '');
          setHasToken(status.hasToken);
        }
        setLoaded(true);
      })
      .catch((e) => setError(toFriendlyMessage(e)));
  }, [expanded, loaded, clinicId]);

  async function onSave() {
    setBusy(true);
    setError(null);
    try {
      await whatsappBusinessService.setConfig(
        clinicId,
        phoneNumberId.trim() || null,
        accessTokenInput.trim() || null,
        enabled
      );
      if (accessTokenInput.trim()) setHasToken(true);
      setAccessTokenInput('');
      setSaved(true);
      setTimeout(() => setSaved(false), 1500);
    } catch (e) {
      setError(toFriendlyMessage(e));
    }
    setBusy(false);
  }

  return (
    <div className="mt-4 border-t border-[var(--border)] pt-4">
      <button
        type="button"
        className="text-sm font-medium text-[var(--muted)] hover:text-[var(--ink)]"
        onClick={() => setExpanded((v) => !v)}
      >
        {expanded ? '▾' : '▸'} WhatsApp Business API (advanced)
      </button>
      {expanded && (
        <div className="mt-3 space-y-3">
          <p className="text-xs text-[var(--muted)]">
            Reserved for future automated sends from the clinic&rsquo;s WhatsApp Business number.
            Feedback, booking confirmations, and bill reminders always open the staff
            member&rsquo;s WhatsApp via wa.me today — this toggle does not change those actions
            yet.
          </p>
          {!loaded ? (
            <p className="text-xs text-[var(--muted)]">Loading…</p>
          ) : (
            <>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <Field label="Enable">
                  <BoolToggle value={enabled} onChange={setEnabled} />
                </Field>
                <Field label="Status">
                  <span className="text-xs text-[var(--muted)]">
                    {hasToken ? 'Connected ✓' : 'Not connected'}
                  </span>
                </Field>
                <Field label="Phone number ID">
                  <input
                    type="text"
                    className={inputCls}
                    placeholder="Meta phone_number_id"
                    value={phoneNumberId}
                    onChange={(e) => setPhoneNumberId(e.target.value)}
                  />
                </Field>
                <Field label="Access token">
                  <input
                    type="password"
                    className={inputCls}
                    placeholder={
                      hasToken ? '•••• (leave blank to keep the current one)' : 'Meta access token'
                    }
                    value={accessTokenInput}
                    onChange={(e) => setAccessTokenInput(e.target.value)}
                  />
                </Field>
              </div>
              <div className="flex items-center gap-3">
                <button
                  type="button"
                  disabled={busy}
                  className="rounded-full bg-[var(--teal)] px-3 py-1.5 text-xs font-medium text-white hover:bg-[var(--teal-strong)]"
                  onClick={() => void onSave()}
                >
                  {busy ? 'Saving…' : saved ? 'Saved!' : 'Save'}
                </button>
                {error && <p className="text-xs text-[var(--rust)]">{error}</p>}
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}



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
            className="flex-1 rounded-lg border px-2 py-1.5 text-center text-xs font-semibold disabled:opacity-60 disabled:cursor-not-allowed transition-opacity"
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

function HistoricalData() {
  return (
    <SectionCard id="settings-card-account-historical" title="Historical data">
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
  const [pendingRestore, setPendingRestore] = useState<BackupBundle | null>(null);

  async function exportNow() {
    setError(null);
    setBusy(true);
    try {
      await backupService.downloadBackup(clinic.id, clinic.name);
      await db.meta.put({ key: lastBackupMetaKey(clinic.id), value: new Date().toISOString() });
    } catch (e) {
      setError(toFriendlyMessage(e));
    } finally {
      setBusy(false);
    }
  }

  async function importFile(file: File) {
    setError(null);
    setSummary(null);
    try {
      const text = await file.text();
      const bundle = JSON.parse(text) as BackupBundle;
      setPendingRestore(bundle);
    } catch (e) {
      setError(toFriendlyMessage(e));
    } finally {
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  }

  async function confirmRestore() {
    if (!pendingRestore) return;
    const bundle = pendingRestore;
    setPendingRestore(null);
    setBusy(true);
    try {
      const result = await backupService.restoreBundle(bundle, clinic.id);
      setSummary(result);
    } catch (e) {
      setError(toFriendlyMessage(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <SectionCard id="settings-card-account-backup" title="Data backup">
      <p className="mb-3 text-xs text-[var(--muted)]">
        Download a full snapshot of this clinic's data (patients, visits, invoices, payments,
        catalog, therapists) any time — a safety net before a wipe, a device change, or just as a
        habit. Restoring writes back through the same sync path as normal use, so restored data
        reaches the server too.
      </p>
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          className={btnSecondary}
          disabled={busy}
          onClick={() => void exportNow()}
        >
          {busy ? 'Working…' : 'Export backup'}
        </button>
        <button
          type="button"
          className={btnSecondary}
          disabled={busy}
          onClick={() => fileInputRef.current?.click()}
        >
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
          Restored {summary.patients} patients, {summary.visits} visits, {summary.invoices}{' '}
          invoices, {summary.payments + summary.invoicePayments} payment records, {summary.catalog}{' '}
          catalog items, {summary.therapists} therapists, and {summary.settlements} settlements.
        </p>
      )}
      <div className="mt-2">
        <ErrorNote message={error} />
      </div>

      <ConfirmDialog
        open={pendingRestore !== null}
        title="Restore backup?"
        message={`Restore this backup (exported ${pendingRestore?.exportedAt?.slice(0, 10) ?? 'unknown date'})?\n\nThis writes patients, visits, invoices, payments, and settlements back into this clinic. Existing records with the same ID are overwritten; nothing else is deleted.`}
        confirmLabel="Restore"
        onCancel={() => setPendingRestore(null)}
        onConfirm={() => void confirmRestore()}
      />
    </SectionCard>
  );
}

function DangerZone() {
  const clinic = useClinic();
  const clinics = useLiveQuery(() => db.clinics.toArray(), []);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmingReset, setConfirmingReset] = useState(false);
  const [confirmingWipe, setConfirmingWipe] = useState(false);
  const [confirmingDeleteClinic, setConfirmingDeleteClinic] = useState(false);
  const [wipeResult, setWipeResult] = useState<{
    patients: number;
    visits: number;
    invoices: number;
  } | null>(null);

  async function doResetLocalCache() {
    setConfirmingReset(false);
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

  function wipeAll() {
    setError(null);
    const supabase = getSupabase();
    if (!supabase || !navigator.onLine) {
      setError('Wiping needs a connection — try again when online.');
      return;
    }
    setConfirmingWipe(true);
  }

  async function doWipeAll() {
    setConfirmingWipe(false);
    const supabase = getSupabase();
    if (!supabase) return;
    setBusy(true);
    try {
      const { data, error: rpcError } = await supabase.rpc('admin_wipe_clinic_data', {
        p_clinic_id: clinic.id,
      });
      if (rpcError) throw new Error(rpcError.message);
      setWipeResult(data as { patients: number; visits: number; invoices: number });
    } catch (e) {
      setError(toFriendlyMessage(e));
      setBusy(false);
    }
  }

  async function finishWipeReload() {
    await db.delete();
    location.reload();
  }

  function deleteClinic() {
    setError(null);
    const supabase = getSupabase();
    if (!supabase || !navigator.onLine) {
      setError('Deleting a clinic needs a connection — try again when online.');
      return;
    }
    setConfirmingDeleteClinic(true);
  }

  async function doDeleteClinic() {
    setConfirmingDeleteClinic(false);
    const supabase = getSupabase();
    if (!supabase) return;
    setBusy(true);
    try {
      const { error: rpcError } = await supabase.rpc('admin_delete_clinic', {
        p_clinic_id: clinic.id,
      });
      if (rpcError) throw new Error(rpcError.message);
      await db.delete();
      location.reload();
    } catch (e) {
      setError(toFriendlyMessage(e));
      setBusy(false);
    }
  }

  const otherClinicCount = (clinics ?? []).filter((c) => c.id !== clinic.id).length;

  return (
    <details id="settings-card-account-danger" className="group scroll-mt-24 rounded-2xl border border-[var(--rust-light)] bg-[var(--surface)] open:pb-4">
      <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-3 px-4 py-3 text-sm font-semibold text-[var(--rust)] [&::-webkit-details-marker]:hidden">
        Danger zone
        <span className="text-xs font-medium text-[var(--muted)] group-open:hidden">Show</span>
        <span className="hidden text-xs font-medium text-[var(--muted)] group-open:inline">Hide</span>
      </summary>
      <div className="px-4">
      <p className="mb-3 text-xs text-[var(--muted)]">
        For test-data cleanup and troubleshooting. Wiping is admin-only and enforced by the server.
      </p>
      {wipeResult && (
        <div className="mb-3 rounded-md border border-[var(--moss)] bg-[var(--moss-light)] px-3 py-2.5 text-sm text-[var(--moss-strong)]">
          <p>
            Wiped {wipeResult.patients} patients, {wipeResult.visits} visits, and{' '}
            {wipeResult.invoices} invoices. The app needs to reload to show a clean slate.
          </p>
          <p className="mt-1 text-xs">
            On any OTHER device that was already signed in, use "Reset local cache" once there.
          </p>
          <button
            type="button"
            className={`${btnPrimary} mt-2.5`}
            onClick={() => void finishWipeReload()}
          >
            Reload now
          </button>
        </div>
      )}
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          className={btnSecondary}
          disabled={busy}
          onClick={() => setConfirmingReset(true)}
        >
          {busy ? 'Working…' : 'Reset local cache on this device'}
        </button>
        <button
          type="button"
          className="rounded-md border border-[var(--rust)] bg-[var(--surface)] px-4 py-2 text-sm font-medium text-[var(--rust)] hover:bg-[var(--rust-light)] disabled:opacity-50"
          disabled={busy}
          onClick={wipeAll}
        >
          {busy ? 'Wiping…' : 'Wipe ALL clinic data…'}
        </button>
        <button
          type="button"
          className="rounded-md border border-[var(--rust)] bg-[var(--rust-light)] px-4 py-2 text-sm font-medium text-[var(--rust)] hover:bg-[var(--surface)] disabled:opacity-50"
          disabled={busy}
          onClick={deleteClinic}
        >
          {busy ? 'Working…' : 'Delete clinic entirely…'}
        </button>
      </div>
      <p className="mt-2 text-xs text-[var(--muted)]">
        <strong>Wipe</strong> removes patients, visits, and invoices but keeps this clinic, its
        catalog, therapists, and team logins. <strong>Delete clinic</strong> removes the whole
        clinic permanently — including team access, catalog, and all data. Logo files in storage may
        need manual cleanup.
        {otherClinicCount > 0
          ? ` You have ${otherClinicCount} other clinic${otherClinicCount === 1 ? '' : 's'} — after delete you'll switch to another.`
          : " This is your only clinic — you'll set up a new one afterward."}
      </p>
      <div className="mt-2">
        <ErrorNote message={error} />
      </div>

      <ConfirmDialog
        open={confirmingReset}
        title="Reset local cache?"
        message="Clear this device's local copy of the data?\n\nNothing on the server is affected — the app reloads and downloads everything fresh. Use this after a wipe, or if this device is showing stale data."
        confirmLabel="Clear local data"
        onCancel={() => setConfirmingReset(false)}
        onConfirm={() => void doResetLocalCache()}
      />
      <ConfirmDialog
        open={confirmingWipe}
        title="Wipe ALL clinic data?"
        message={`This permanently deletes ALL patients, visits, invoices, payments and settlements for this clinic, and resets invoice numbering to 0001. The catalog, therapists, and logins are kept.\n\nThis cannot be undone.`}
        confirmLabel="Wipe clinic data"
        destructive
        typeToConfirm={{
          placeholder: `Type "${clinic.name}" to confirm`,
          isMatch: (typed) => typed.trim() === clinic.name,
        }}
        onCancel={() => setConfirmingWipe(false)}
        onConfirm={() => void doWipeAll()}
      />
      <ConfirmDialog
        open={confirmingDeleteClinic}
        title="Delete this clinic permanently?"
        message={`This deletes "${clinic.name}" and everything in it — all patients, visits, invoices, catalog, therapists, and team logins. This cannot be undone.`}
        confirmLabel="Delete clinic"
        destructive
        typeToConfirm={{
          placeholder: `Type "${clinic.name}" to confirm`,
          isMatch: (typed) => typed.trim() === clinic.name,
        }}
        onCancel={() => setConfirmingDeleteClinic(false)}
        onConfirm={() => void doDeleteClinic()}
      />
      </div>
    </details>
  );
}

interface ClinicMember {
  userId: string;
  email: string;
  role: string;
  displayName: string | null;
  status: MemberOnboardingStatus;
  invitedAt: string | null;
  lastSignInAt: string | null;
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

/** Slate (invited, nothing's happened yet) → amber (clicked the invite
 *  link, hasn't chosen a password) → moss (done). Caption dates from
 *  whichever timestamp actually moved for that state — invitedAt for the
 *  first, lastSignInAt (the moment the link was clicked) for the second —
 *  so the badge always answers "since when," not just "which state." */
function OnboardingBadge({ member }: { member: ClinicMember }) {
  const accent: Accent =
    member.status === 'active' ? 'moss' : member.status === 'link_opened' ? 'amber' : 'slate';
  const { color, light } = ACCENT_VARS[accent];
  const dateSuffix =
    member.status === 'invited' && member.invitedAt
      ? ` ${formatDateDM(member.invitedAt)}`
      : member.status === 'link_opened' && member.lastSignInAt
        ? ` ${formatDateDM(member.lastSignInAt)}`
        : '';
  return (
    <span
      className="inline-block self-start rounded-full px-2.5 py-0.5 text-[10.5px] font-semibold"
      style={{ background: light, color }}
    >
      {MEMBER_ONBOARDING_LABELS[member.status]}
      {dateSuffix}
    </span>
  );
}

/** Same split-on-whitespace, first-two-initials logic already duplicated
 *  across the patient avatar spots (PatientsPage/PatientProfilePage/
 *  NoteEditorPage) — matched here rather than introducing a shared helper
 *  for a one-line computation. */
function therapistInitials(name: string): string {
  let text = name;
  if (text.includes('@')) {
    text = text.split('@')[0];
  }
  const parts = text.split(/[^a-zA-Z0-9]+/).filter(Boolean);
  if (parts.length >= 2) {
    return (parts[0][0] + parts[1][0]).toUpperCase();
  }
  if (parts.length === 1) {
    return parts[0].slice(0, 2).toUpperCase();
  }
  return '';
}

interface TeamPerson {
  key: string;
  member: ClinicMember | null;
  therapist: Therapist | null;
}

function buildTeamList(members: ClinicMember[] | null, therapists: Therapist[] | null): TeamPerson[] {
  const map = new Map<string, TeamPerson>();
  
  if (members) {
    for (const m of members) {
      map.set(m.userId, { key: m.userId, member: m, therapist: null });
    }
  }
  
  if (therapists) {
    for (const t of therapists) {
      if (t.userId && map.has(t.userId)) {
        map.get(t.userId)!.therapist = t;
      } else {
        const key = t.userId ? t.userId : `t-${t.id}`;
        if (!map.has(key)) {
          map.set(key, { key, member: null, therapist: t });
        } else {
          map.get(key)!.therapist = t;
        }
      }
    }
  }
  
  return Array.from(map.values()).sort((a, b) => {
    const nameA = (a.member?.displayName || a.therapist?.name || a.member?.email || '').toLowerCase();
    const nameB = (b.member?.displayName || b.therapist?.name || b.member?.email || '').toLowerCase();
    return nameA.localeCompare(nameB);
  });
}

function TeamMemberCard({
  person,
  clinicId,
  isLastAdmin,
  revoking,
  resending,
  onRevoke,
  onResend,
  onSaved,
  onDelete,
  onPhotoUpload,
  onDeactivate
}: {
  person: TeamPerson;
  clinicId: string;
  isLastAdmin: boolean;
  revoking: boolean;
  resending: boolean;
  onRevoke: () => void;
  onResend: () => void;
  onSaved: () => void;
  onDelete: () => void;
  onPhotoUpload: (file: File) => void;
  onDeactivate: () => void;
}) {
  const { member, therapist } = person;
  const displayName = member?.displayName || therapist?.name || member?.email || 'Unknown';
  const role = member ? ((member.role as Exclude<ClinicRole, 'unknown'>) ?? 'therapist') : 'therapist';
  const { color, light } = ACCENT_VARS[ROLE_ACCENT[role] ?? 'slate'];

  const [editing, setEditing] = useState(false);
  
  const [nameDraft, setNameDraft] = useState(displayName);
  const [roleDraft, setRoleDraft] = useState<ClinicRole>(role);
  const [emailDraft, setEmailDraft] = useState('');
  const [regDraft, setRegDraft] = useState(therapist?.registrationNo ?? '');
  const [phoneDraft, setPhoneDraft] = useState(therapist?.phone ?? '');
  const [colorDraft, setColorDraft] = useState(therapist?.color ?? '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    if (isLastAdmin && roleDraft !== 'admin') {
      setError('This clinic must keep at least one admin — make someone else admin first.');
      return;
    }
    setSaving(true);
    setError(null);
    try {
      if (!member && therapist && emailDraft.trim()) {
        const supabase = getSupabase();
        if (!supabase) throw new Error('No Supabase connection');
        const { data: result, error: invokeError } = await supabase.functions.invoke(
          'invite-therapist',
          {
            body: {
              action: 'invite',
              clinicId,
              email: emailDraft.trim(),
              name: nameDraft.trim(),
              role: roleDraft,
              redirectOrigin: window.location.origin,
            },
          }
        );
        if (invokeError) throw new Error(invokeError.message);
        const payload = result as { error?: string; success?: boolean } | null;
        if (payload?.error) throw new Error(payload.error);
      } else if (member) {
        const supabase = getSupabase();
        if (!supabase) throw new Error('No Supabase connection');
        const { error: updateError } = await supabase
          .from('clinic_members')
          .update({
            display_name: nameDraft.trim() || null,
            // Only touch role when the admin actually changed it; a stale
            // draft must never silently demote/promote a member.
            ...(roleDraft !== role ? { role: roleDraft } : {}),
          })
          .eq('clinic_id', clinicId)
          .eq('user_id', member.userId);
        if (updateError) throw updateError;
      }

      if (therapist) {
        await repos.therapists.put({
          ...therapist,
          name: nameDraft.trim() || therapist.name,
          registrationNo: regDraft.trim() || null,
          phone: phoneDraft.trim() || null,
          color: colorDraft.trim() || null,
          updatedAt: new Date().toISOString(),
        });
      }
      
      setEditing(false);
      onSaved();
    } catch (e) {
      setError(toFriendlyMessage(e));
    } finally {
      setSaving(false);
    }
  }

  const renderPhoto = (sizeClass: string) => (
    <label
      className={`block shrink-0 cursor-pointer overflow-hidden rounded-full border border-[var(--border)] bg-[var(--paper)] ${sizeClass}`}
      title={therapist ? "Change photo" : "No photo available"}
      onClick={(e) => { if (!therapist) e.preventDefault(); }}
    >
      {therapist?.photoPath ? (
        <img
          src={publicTherapistPhotoUrl(therapist.photoPath) ?? ''}
          alt=""
          className="h-full w-full object-cover"
        />
      ) : (
        <span
          className="flex h-full w-full items-center justify-center font-display text-sm font-semibold text-white"
          style={{ background: color, boxShadow: `0 0 0 3px ${light}` }}
        >
          {therapistInitials(displayName)}
        </span>
      )}
      {therapist && (
        <input
          type="file"
          accept="image/*"
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) onPhotoUpload(file);
            e.target.value = '';
          }}
        />
      )}
    </label>
  );



  const isUnlinkedTherapist = !member && therapist;
  const isBookable = !!therapist;

  return (
    <div className={`flex h-full flex-col gap-3 rounded-2xl border ${therapist && therapist.active === false ? 'border-dashed border-[var(--border)] bg-[var(--paper)] opacity-80' : 'border-[var(--border)] bg-[var(--surface)] shadow-sm'} p-4 transition-all`}>
      {/* Header section */}
      <div className="flex items-start gap-3">
        <div className="shrink-0">{renderPhoto('h-10 w-10')}</div>
        
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center justify-between gap-x-2 gap-y-1">
            <h3 className="truncate text-base font-bold text-[var(--ink)] tracking-tight">{displayName}</h3>
            
            <div className="flex flex-wrap items-center gap-1.5">
              {member && <RolePill role={role} />}
              {member && member.status !== 'active' && <OnboardingBadge member={member} />}
              {isBookable && (
                <span className="inline-block rounded-full bg-[var(--sky-light)] px-2.5 py-0.5 text-[10px] font-semibold text-[var(--sky)]">
                  Bookable
                </span>
              )}
              {!member && therapist && (
                <span className="inline-block rounded-full bg-[var(--amber-light)] px-2.5 py-0.5 text-[10px] font-semibold text-[var(--amber-strong)]">
                  No login
                </span>
              )}
            </div>
          </div>
          
          <div className="flex items-start gap-1.5 mt-1.5 text-xs text-[var(--muted)]">
            <div className={`mt-[5px] h-1.5 w-1.5 shrink-0 rounded-full ${(!therapist || therapist.active) ? 'bg-[var(--moss-strong)]' : 'bg-[var(--muted)]'}`} />
            <span className="leading-tight">
              {(!therapist || therapist.active) ? 'Active' : 'Inactive roster'}
              {member?.lastSignInAt && ` · Last seen ${new Date(member.lastSignInAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}`}
            </span>
          </div>
        </div>
      </div>

      <div className="space-y-2.5 text-xs text-[var(--ink)] mt-2">
        {member && (
            <div className="flex items-center gap-2.5">
                <svg className="h-3.5 w-3.5 shrink-0 text-[var(--muted)]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
                </svg>
                <span className="truncate">{member.email}</span>
              </div>
            )}
            
            {therapist && (
              <>
                <div className="flex items-center gap-2.5">
                  <svg className="h-3.5 w-3.5 shrink-0 text-[var(--muted)]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-3 7h3m-3 4h3m-6-4h.01M9 16h.01" />
                  </svg>
                  <span className="truncate">
                    {therapist.registrationNo ? `Reg. ${therapist.registrationNo}` : 'No registration no.'}
                  </span>
                </div>
                
                {therapist.workingHours && (
                  <div className="flex items-center gap-2.5">
                    <svg className="h-3.5 w-3.5 shrink-0 text-[var(--muted)]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                    <span className="truncate">Custom schedule</span>
                  </div>
                )}
              </>
            )}
        </div>
        
        <div className="flex-1" />

        {isLastAdmin && (
          <p className="text-[11px] text-[var(--muted)]">Last admin — can't be revoked or demoted.</p>
        )}

        <div className="flex flex-wrap items-center gap-3 pt-3 mt-1 border-t border-[var(--border)]">
          <button
            type="button"
            className="text-xs font-medium text-[var(--teal)] hover:underline"
            onClick={(e) => { e.stopPropagation(); setEditing(true); }}
          >
            Edit
          </button>
          
          {member && member.status !== 'active' && (
            <button
              type="button"
              disabled={resending}
              className="text-xs font-medium text-[var(--teal)] hover:underline"
              onClick={(e) => { e.stopPropagation(); onResend(); }}
            >
              {resending ? 'Sending…' : 'Resend invite'}
            </button>
          )}

          <div className="ml-auto flex flex-wrap gap-3 items-center justify-end">
            {therapist && (
              <button
                type="button"
                className={`text-xs font-medium hover:underline ${therapist.active !== false ? 'text-[var(--rust)]' : 'text-[var(--teal)]'}`}
                onClick={(e) => { e.stopPropagation(); onDeactivate(); }}
              >
                {therapist.active !== false ? 'Deactivate' : 'Reactivate'}
              </button>
            )}
            
            {member && (
              <button
                type="button"
                className={`text-xs font-medium hover:underline ${isLastAdmin ? 'text-[var(--muted)] opacity-70' : 'text-[var(--rust)]'}`}
                disabled={revoking}
                onClick={(e) => { 
                  e.stopPropagation(); 
                  if (isLastAdmin) {
                    alert('This clinic must keep at least one admin — make someone else admin first to unlock this button.');
                    return;
                  }
                  onRevoke(); 
                }}
              >
                {revoking ? 'Revoking…' : 'Revoke access'}
              </button>
            )}
            
            {isUnlinkedTherapist && (
              <button
                type="button"
                className="text-xs font-medium text-[var(--rust)] hover:underline"
                onClick={(e) => { e.stopPropagation(); onDelete(); }}
              >
                Delete record
              </button>
            )}
          </div>
        </div>

        {/* Modal Portal */}
        {editing && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-[var(--ink)]/40 p-4 backdrop-blur-sm">
            <div 
              className="w-full max-w-[500px] rounded-2xl bg-[var(--surface)] p-6 shadow-2xl overflow-hidden flex flex-col sm:flex-row gap-6 relative"
              onClick={(e) => e.stopPropagation()}
            >
              {/* Left Column: Avatar & Quick Info */}
              <div className="flex flex-col items-center gap-2 sm:w-1/3 text-center sm:border-r border-[var(--border)] pr-4">
                {renderPhoto('h-24 w-24 mb-2')}
                <div className="font-semibold text-[var(--ink)] break-words w-full px-2 leading-tight">
                  {nameDraft || 'New Member'}
                </div>
                <div className="text-xs text-[var(--muted)]">
                  {roleDraft !== 'unknown' ? CLINIC_ROLE_LABELS[roleDraft] : 'Therapist'}
                </div>
              </div>

              {/* Right Column: Form Fields */}
              <div className="flex-1 flex flex-col gap-4">
                <Field label={
                  <>
                    Name
                    <InfoTip text="This clinic-wide name is printed on invoices and shown on schedules. The therapist's personal profile name is separate and only visible to them." />
                  </>
                }>
                  <input
                    className={inputCls}
                    value={nameDraft}
                    onChange={(e) => setNameDraft(e.target.value)}
                    autoFocus
                  />
                </Field>
                
                {(member || (!member && therapist)) && (
                  <Field label="Role">
                    <select
                      className={inputCls}
                      value={roleDraft}
                      onChange={(e) => setRoleDraft(e.target.value as Exclude<ClinicRole, 'unknown'>)}
                    >
                      <option value="therapist">Therapist</option>
                      <option value="front_desk">Front desk</option>
                      <option value="admin">Admin</option>
                    </select>
                  </Field>
                )}

                {!member && therapist && (
                  <Field label="Email address (Link to login)">
                    <input
                      type="email"
                      className={inputCls}
                      placeholder="Optional"
                      value={emailDraft}
                      onChange={(e) => setEmailDraft(e.target.value)}
                    />
                  </Field>
                )}

                {therapist && (
                  <>
                    <Field label="Registration no.">
                      <input
                        className={inputCls}
                        placeholder="Printed on invoices"
                        value={regDraft}
                        onChange={(e) => setRegDraft(e.target.value)}
                      />
                    </Field>
                    <Field label="Phone">
                      <input
                        className={inputCls}
                        placeholder="For WhatsApp booking notifications"
                        value={phoneDraft}
                        onChange={(e) => setPhoneDraft(e.target.value)}
                      />
                    </Field>
                    <Field label="Schedule Color">
                      <div className="flex items-center gap-3">
                        <input
                          type="color"
                          className="h-9 w-14 cursor-pointer rounded border border-[var(--border)] bg-transparent p-1"
                          value={colorDraft || therapistColor(therapist.id, therapist.color)}
                          onChange={(e) => setColorDraft(e.target.value)}
                        />
                        <button
                          type="button"
                          className="text-xs text-[var(--muted)] hover:text-[var(--ink)]"
                          onClick={() => setColorDraft('')}
                        >
                          Reset to default
                        </button>
                      </div>
                    </Field>
                  </>
                )}
                
                <ErrorNote message={error} />

                <div className="flex justify-end gap-3 mt-4 pt-4 border-t border-[var(--border)]">
                  <button
                    type="button"
                    className="text-sm font-medium text-[var(--muted)] hover:text-[var(--ink)] px-2"
                    disabled={saving}
                    onClick={() => setEditing(false)}
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    className="rounded-lg bg-[var(--teal)] px-4 py-2 text-sm font-semibold text-white hover:bg-[var(--teal-strong)] disabled:opacity-50"
                    disabled={saving}
                    onClick={() => void save()}
                  >
                    {saving ? 'Saving…' : 'Save changes'}
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}

    </div>
  );
}

function AddTeamMemberForm({
  clinicId,
  onAdded,
}: {
  clinicId: string;
  onAdded: () => void;
}) {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<Exclude<ClinicRole, 'unknown'>>('therapist');
  const [needsLogin, setNeedsLogin] = useState(true);
  const [bookable, setBookable] = useState(true);
  
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Auto-toggle bookable based on role
  useEffect(() => {
    if (role === 'therapist') {
      setBookable(true);
    } else {
      setBookable(false);
    }
  }, [role]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return setError('Name is required');
    if (needsLogin && !email.trim()) return setError('Email is required for login');
    if (!needsLogin && !bookable) return setError('Must either need a login or be bookable');

    setBusy(true);
    setError(null);
    try {
      if (needsLogin) {
        const supabase = getSupabase();
        if (!supabase) throw new Error('No Supabase connection');
        const { data: result, error: invokeError } = await supabase.functions.invoke(
          'invite-therapist',
          {
            body: {
              action: 'invite',
              clinicId,
              email: email.trim(),
              name: name.trim(),
              role,
              redirectOrigin: window.location.origin,
            },
          }
        );
        if (invokeError) throw new Error(invokeError.message);
        const payload = result as { error?: string; success?: boolean } | null;
        if (payload?.error) throw new Error(payload.error);

        // If it's not a therapist role but we want them bookable, we must manually create a roster row
        // because invite-therapist only creates one if role === 'therapist'.
        if (bookable && role !== 'therapist') {
          // Wait, we don't have their new user_id easily unless invite-therapist returns it.
          // It might not. We can just refetch members and handle linking later, or just
          // inform the user.
          // Actually, if we want an admin to be bookable right away, we need their user_id.
          // For now, we can create an unlinked roster row, and the user can link it, or 
          // ideally we just create it. But since invite-therapist doesn't return user_id...
          // Let's create an unlinked roster entry with the same name. They can link it manually if needed,
          // or we can just warn.
          await repos.therapists.put({
            id: crypto.randomUUID(),
            clinicId,
            name: name.trim(),
            active: true,
            userId: null, 
            updatedAt: new Date().toISOString(),
          });
        }
      } else if (bookable) {
        // Just a roster entry
        await repos.therapists.put({
          id: crypto.randomUUID(),
          clinicId,
          name: name.trim(),
          active: true,
          userId: null,
          updatedAt: new Date().toISOString(),
        });
      }

      setName('');
      setEmail('');
      setRole('therapist');
      setNeedsLogin(true);
      onAdded();
    } catch (err) {
      setError(toFriendlyMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-3 rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4 shadow-sm">
      <h4 className="font-semibold text-sm text-[var(--ink)]">Add team member</h4>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <Field label="Name">
          <input
            className={inputCls}
            placeholder="Jane Doe"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </Field>
        {needsLogin && (
          <Field label="Email">
            <input
              type="email"
              className={inputCls}
              placeholder="jane@example.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </Field>
        )}
        {needsLogin && (
          <Field label="Role">
            <select
              className={inputCls}
              value={role}
              onChange={(e) => setRole(e.target.value as Exclude<ClinicRole, 'unknown'>)}
            >
              <option value="therapist">Therapist</option>
              <option value="front_desk">Front desk</option>
              <option value="admin">Admin</option>
            </select>
          </Field>
        )}
      </div>
      
      <div className="flex flex-col gap-2 mt-1 border-t border-[var(--border)] pt-3">
        <label className="flex items-center gap-2 text-sm text-[var(--ink)]">
          <input
            type="checkbox"
            checked={needsLogin}
            onChange={(e) => setNeedsLogin(e.target.checked)}
          />
          Needs login (can sign in to Theranet)
        </label>
        <label className="flex items-center gap-2 text-sm text-[var(--ink)]">
          <input
            type="checkbox"
            checked={bookable}
            onChange={(e) => setBookable(e.target.checked)}
          />
          Bookable (appears in schedule and invoices)
        </label>
      </div>

      <div className="mt-2 flex items-center gap-3">
        <button
          type="submit"
          className={btnPrimary}
          disabled={busy || (!needsLogin && !bookable)}
        >
          {busy ? 'Adding…' : 'Add member'}
        </button>
      </div>
      <ErrorNote message={error} />
    </form>
  );
}

function Therapists() {
  const clinic = useClinic();
  const entitlements = useEntitlements(clinic.id);
  const rawTherapists = useLiveQuery(() => repos.therapists.list(clinic.id, true), [clinic.id]);
  const [members, setMembers] = useState<ClinicMember[] | null>(null);
  const [membersError, setMembersError] = useState<string | null>(null);
  const [rosterError, setRosterError] = useState<string | null>(null);
  const [revokeInProgress, setRevokeInProgress] = useState<string | null>(null);
  const [revokeTarget, setRevokeTarget] = useState<{ userId: string; email: string } | null>(null);
  const [resendInProgress, setResendInProgress] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Therapist | null>(null);
  const [deactivateTarget, setDeactivateTarget] = useState<{ therapist: Therapist; upcoming: number } | null>(null);
  
  // Filter states
  const [filter, setFilter] = useState<'all' | 'bookable' | 'staff' | 'invited' | 'inactive' | 'unlinked'>('all');

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
      (
        data as {
          user_id: string;
          email: string;
          role: string;
          display_name: string | null;
          invited_at: string | null;
          last_sign_in_at: string | null;
          require_password_setup: boolean | null;
        }[]
      ).map((m) => ({
        userId: m.user_id,
        email: m.email,
        role: m.role,
        displayName: m.display_name,
        status: memberOnboardingStatus({
          lastSignInAt: m.last_sign_in_at,
          requirePasswordSetup: m.require_password_setup === true,
        }),
        invitedAt: m.invited_at,
        lastSignInAt: m.last_sign_in_at,
      }))
    );
  }, [clinic.id]);

  useEffect(() => {
    void refetchMembers();
  }, [refetchMembers]);

  const teamList = useMemo(
    () => buildTeamList(members, rawTherapists ?? null),
    [members, rawTherapists]
  );
  
  const filteredTeam = useMemo(() => {
    return teamList.filter(p => {
      if (filter === 'inactive') return p.therapist?.active === false;
      
      // Hide inactive therapists from all other views
      if (p.therapist && p.therapist.active === false) return false;

      if (filter === 'bookable') return !!p.therapist;
      if (filter === 'staff') return p.member && !p.therapist;
      if (filter === 'invited') return p.member?.status !== 'active';
      if (filter === 'unlinked') return p.therapist && !p.member;
      return true;
    });
  }, [teamList, filter]);

  const unlinkedCount = teamList.filter(p => p.therapist && p.therapist.active !== false && !p.member).length;

  const atSeatCap =
    entitlements.enforcementEnabled &&
    !entitlements.loading &&
    members !== null &&
    members.length >= entitlements.maxMembers;

  async function startDeleteTherapist(t: Therapist) {
    setRosterError(null);
    try {
      const [allVisits, allNotes, allInvoices] = await Promise.all([
        repos.visits.list({ clinicId: clinic.id }),
        repos.consultationNotes.listByClinic(clinic.id),
        repos.invoices.list(clinic.id),
      ]);
      const linkedVisits = allVisits.filter(
        (v) => v.therapistId === t.id || v.sharedTherapistId === t.id
      ).length;
      const linkedNotes = allNotes.filter((n) => n.therapistId === t.id).length;
      const linkedInvoices = allInvoices.filter((i) => i.therapistId === t.id).length;
      const linked = linkedVisits + linkedNotes + linkedInvoices;
      if (linked > 0) {
        setRosterError(
          `${t.name} has ${linked} linked record(s) (visits, notes, or invoices), so they can't be permanently deleted — deactivate instead.`
        );
        return;
      }
      setDeleteTarget(t);
    } catch (e) {
      setRosterError(toFriendlyMessage(e));
    }
  }

  async function confirmDeleteTherapist() {
    if (!deleteTarget) return;
    setRosterError(null);
    try {
      await therapistService.hardDelete(deleteTarget.id);
      setDeleteTarget(null);
    } catch (e) {
      setRosterError(toFriendlyMessage(e));
    }
  }

  async function requestToggleActive(t: Therapist) {
    if (t.active === false) {
      await handleToggleActive(t);
      return;
    }
    setRosterError(null);
    try {
      const now = Date.now();
      const rows = await repos.appointments.listByClinic(clinic.id);
      const upcoming = rows.filter(
        (a) =>
          a.therapistId === t.id &&
          a.status !== 'cancelled' &&
          a.status !== 'no_show' &&
          new Date(a.scheduledAt).getTime() >= now
      ).length;
      setDeactivateTarget({ therapist: t, upcoming });
    } catch (e) {
      setRosterError(toFriendlyMessage(e));
    }
  }

  async function handleToggleActive(t: Therapist) {
    setRosterError(null);
    try {
      await repos.therapists.put({
        ...t,
        active: !t.active,
        updatedAt: new Date().toISOString(),
      });
    } catch (e) {
      setRosterError(toFriendlyMessage(e));
    }
  }

  async function uploadPhoto(t: Therapist, file: File) {
    setRosterError(null);
    const supabase = getSupabase();
    if (!supabase || !navigator.onLine) {
      setRosterError('Photo upload needs a connection.');
      return;
    }
    try {
      const resized = await resizeImageToBlob(file, 256);
      const path = `${clinic.id}/therapist-${t.id}-${Date.now()}.jpg`;
      const { error: uploadError } = await supabase.storage
        .from('clinic-assets')
        .upload(path, resized, { contentType: 'image/jpeg' });

      if (uploadError) throw uploadError;

      await repos.therapists.put({ ...t, photoPath: path, updatedAt: new Date().toISOString() });
    } catch (e) {
      setRosterError(toFriendlyMessage(e));
    }
  }

  function revokeMember(userId: string, email: string) {
    const target = members?.find((m) => m.userId === userId);
    const isLastAdmin =
      target?.role === 'admin' && (members?.filter((m) => m.role === 'admin').length ?? 0) <= 1;
    if (isLastAdmin) {
      setMembersError(
        'This clinic must keep at least one admin — revoke or demote another admin first.'
      );
      return;
    }
    setRevokeTarget({ userId, email });
  }

  async function confirmRevokeMember() {
    if (!revokeTarget) return;
    const { userId } = revokeTarget;
    setRevokeTarget(null);
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

      const linked = (rawTherapists ?? []).filter((t) => t.userId === userId);
      for (const t of linked) {
        await repos.therapists.put({
          ...t,
          userId: null,
          updatedAt: new Date().toISOString(),
        });
      }

      setMembers((prev) => prev?.filter((m) => m.userId !== userId) ?? null);
    } catch (e) {
      setMembersError(toFriendlyMessage(e));
    } finally {
      setRevokeInProgress(null);
    }
  }

  async function resendInvite(userId: string) {
    setMembersError(null);
    setResendInProgress(userId);
    try {
      const supabase = getSupabase();
      if (!supabase) throw new Error('No Supabase connection');
      const { data: result, error: invokeError } = await supabase.functions.invoke(
        'invite-therapist',
        {
          body: {
            action: 'resend',
            clinicId: clinic.id,
            userId,
            redirectOrigin: window.location.origin,
          },
        }
      );
      if (invokeError) throw new Error(invokeError.message);
      const payload = result as { error?: string; message?: string } | null;
      if (payload?.error) throw new Error(payload.error);
    } catch (e) {
      setMembersError(toFriendlyMessage(e));
    } finally {
      setResendInProgress(null);
    }
  }

  return (
    <SectionCard id="settings-card-team-therapists" title="Team Directory">
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3 border-b border-[var(--border)] pb-4">
        <div className="flex flex-wrap gap-2">
          {(['all', 'bookable', 'staff', 'invited', 'inactive', 'unlinked'] as const).map((f) => (
            <button
              key={f}
              type="button"
              onClick={() => setFilter(f)}
              className="rounded-full border px-3 py-1 text-xs font-semibold capitalize"
              style={{
                borderColor: filter === f ? 'var(--teal)' : 'var(--border)',
                background: filter === f ? 'var(--teal-light)' : 'var(--surface)',
                color: filter === f ? 'var(--teal)' : 'var(--muted)',
              }}
            >
              {f}
              {f === 'unlinked' && unlinkedCount > 0 && (
                <span className="ml-1.5 rounded-full bg-[var(--rust)] px-1.5 py-0.5 text-[10px] text-white">
                  {unlinkedCount}
                </span>
              )}
            </button>
          ))}
        </div>
        <p className="text-xs text-[var(--muted)]">
          {filteredTeam.length} member{filteredTeam.length === 1 ? '' : 's'}
        </p>
      </div>

      <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2 lg:grid-cols-3 mb-6 items-start">
        {filteredTeam.map((p) => {
          const isLastAdmin =
            p.member?.role === 'admin' &&
            (members?.filter((x) => x.role === 'admin').length ?? 0) <= 1;

          return (
            <TeamMemberCard
              key={p.key}
              person={p}
              clinicId={clinic.id}
              isLastAdmin={isLastAdmin}
              revoking={revokeInProgress === p.member?.userId}
              resending={resendInProgress === p.member?.userId}
              onRevoke={() => {
                if (p.member) revokeMember(p.member.userId, p.member.email);
              }}
              onResend={() => {
                if (p.member) void resendInvite(p.member.userId);
              }}
              onSaved={() => void refetchMembers()}
              onDelete={() => {
                if (p.therapist) void startDeleteTherapist(p.therapist);
              }}
              onPhotoUpload={(file) => {
                if (p.therapist) void uploadPhoto(p.therapist, file);
              }}
              onDeactivate={() => {
                if (p.therapist) void requestToggleActive(p.therapist);
              }}
            />
          );
        })}
      </div>

      {filteredTeam.length === 0 && (
        <p className="mb-6 text-sm text-[var(--muted)]">No team members found for this filter.</p>
      )}

      <ErrorNote message={membersError || rosterError} />

      <div className="border-t border-[var(--border)] pt-6">
        {atSeatCap ? (
          <div className="max-w-md rounded-xl border border-[var(--border)] bg-[var(--paper)] p-4 text-center">
            <p className="text-sm font-medium text-[var(--ink)]">
              This clinic's plan allows up to {entitlements.maxMembers} team login
              {entitlements.maxMembers === 1 ? '' : 's'}.
            </p>
            <p className="mt-1 text-xs text-[var(--muted)]">
              Included in {PLAN_TIER_LABELS[minimumTierFor('team')]} and above.
            </p>
          </div>
        ) : (
          <div className="max-w-xl">
            <AddTeamMemberForm clinicId={clinic.id} onAdded={() => void refetchMembers()} />
          </div>
        )}
      </div>

      {deleteTarget && (
        <ConfirmDialog
          open={true}
          title="Delete service roster record"
          message={`Are you sure you want to delete ${deleteTarget.name} from the service roster? This cannot be undone.`}
          confirmLabel="Delete"
          cancelLabel="Keep record"
          destructive
          onConfirm={() => void confirmDeleteTherapist()}
          onCancel={() => setDeleteTarget(null)}
        />
      )}
      
      {deactivateTarget && (
        <ConfirmDialog
          open={true}
          title="Deactivate therapist"
          message={`${deactivateTarget.therapist.name} will no longer be bookable or shown in schedule filters. Past records stay intact; you can reactivate anytime.${
            deactivateTarget.upcoming > 0
              ? ` They still have ${deactivateTarget.upcoming} upcoming appointment(s) — reassign or cancel those separately.`
              : ''
          }`}
          confirmLabel="Deactivate"
          cancelLabel="Cancel"
          destructive
          onConfirm={() => {
            const t = deactivateTarget.therapist;
            setDeactivateTarget(null);
            void handleToggleActive(t);
          }}
          onCancel={() => setDeactivateTarget(null)}
        />
      )}

      {revokeTarget && (
        <ConfirmDialog
          open={true}
          title="Revoke login access"
          message={`Revoke ${revokeTarget.email}'s access to this clinic?`}
          confirmLabel="Revoke"
          cancelLabel="Cancel"
          destructive
          onConfirm={() => void confirmRevokeMember()}
          onCancel={() => setRevokeTarget(null)}
        />
      )}
    </SectionCard>
  );
}

