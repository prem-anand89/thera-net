import { useCallback, useEffect, useRef, useState, useTransition } from 'react';
import { Link, useBlocker, useNavigate, useSearch } from '@tanstack/react-router';
import { useLiveQuery } from 'dexie-react-hooks';
import { repos } from '@/services';
import { useClinic } from '@/app/clinicContext';
import { usePermissions } from '@/app/usePermissions';
import { useEntitlements } from '@/app/useEntitlements';
import { ConfirmDialog } from '@/components/ui';
import { CatalogSection, type CatalogView } from './CatalogSection';
import { ShiftTemplatesSection } from './ShiftTemplatesSection';
import { ShiftAssignmentsSection } from './ShiftAssignmentsSection';
import { SETTINGS_TABS, SETTINGS_TAB_META, matchSettingsCards, type SettingsCard, type SettingsTab } from './sections';
import { SetupProgressBar } from '@/features/setup/SetupProgressBar';
import { LockedSectionNotice } from './settingsShared';
import { PlanSection } from './PlanSection';
import { ClinicProfileSection, ClinicRegionSection, ClinicHoursSection } from './ClinicSections';
import { BillingSection, PartnerSection } from './BillingSections';
import { PatientCommsSection } from './BookingSections';
import { HistoricalData, DataBackup, DangerZone } from './DataSections';
import { Therapists } from './TeamSection';

/** Sections that edit a slice of the clinic row and report unsaved edits.
 *  A tab can hold more than one (Billing holds billing + partner). */
type FormKey = 'profile' | 'clinicHours' | 'clinicRegion' | 'billing' | 'partner' | 'patientComms';

const FORM_TAB: Record<FormKey, SettingsTab> = {
  profile: 'general',
  clinicHours: 'general',
  clinicRegion: 'general',
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
  const setClinicHoursDirty = useCallback((d: boolean) => setDirtyForms((s) => toggleSet(s, 'clinicHours', d)), []);
  const setClinicRegionDirty = useCallback((d: boolean) => setDirtyForms((s) => toggleSet(s, 'clinicRegion', d)), []);
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
          {activeTab === 'general' && (
            <>
              <ClinicProfileSection onDirtyChange={setProfileDirty} />
              <ClinicHoursSection onDirtyChange={setClinicHoursDirty} />
              <ClinicRegionSection onDirtyChange={setClinicRegionDirty} />
            </>
          )}
          {activeTab === 'team' && (
            <>
              {unlinkedCount > 0 && (
                <div className="rounded-2xl border border-[var(--amber)] bg-[var(--amber-light)] px-4 py-3 text-sm text-[var(--ink)]">
                  {unlinkedCount} therapist{unlinkedCount === 1 ? '' : 's'} not linked to a login.
                  Set Linked login so their Workspace isn’t empty.
                </div>
              )}
              <Therapists />
              <ShiftAssignmentsSection />
              <ShiftTemplatesSection />
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
