import type { DatePreset } from '@/components/DatePresetBar';
import { currentWeekRange } from '@/domain/fiscalYear';

// Mirrors LEDGER_TABS in the router (kept local so this module doesn't import the router).
const TABS = ['visits', 'patients', 'invoices', 'daybook'] as const;
export type LedgerTab = (typeof TABS)[number];

const PRESETS: readonly DatePreset[] = ['today', 'yesterday', 'week', 'month', 'lastMonth', 'all', 'custom'];

/** What the Ledger remembers per clinic on this device: the last tab and Visits filters. */
export type LedgerPrefs = {
  tab?: LedgerTab;
  datePreset?: DatePreset;
  /** Only meaningful for the 'custom' preset; the others are recomputed on load. */
  from?: string;
  to?: string;
  therapistId?: string;
  onlyCollectedNoReceipt?: boolean;
  onlyNotCollected?: boolean;
  onlyNotDocumented?: boolean;
};

const key = (clinicId: string) => `ledger:prefs:${clinicId}`;
const isoDate = /^\d{4}-\d{2}-\d{2}$/;

/** Reads defensively: storage can be blocked, cleared, or hold an older shape. */
export function loadLedgerPrefs(clinicId: string): LedgerPrefs {
  try {
    const raw = localStorage.getItem(key(clinicId));
    if (!raw) return {};
    const p = JSON.parse(raw) as Record<string, unknown>;
    const out: LedgerPrefs = {};
    if ((TABS as readonly unknown[]).includes(p.tab)) out.tab = p.tab as LedgerTab;
    if (PRESETS.includes(p.datePreset as DatePreset)) out.datePreset = p.datePreset as DatePreset;
    if (typeof p.from === 'string' && isoDate.test(p.from)) out.from = p.from;
    if (typeof p.to === 'string' && isoDate.test(p.to)) out.to = p.to;
    if (typeof p.therapistId === 'string') out.therapistId = p.therapistId;
    for (const k of ['onlyCollectedNoReceipt', 'onlyNotCollected', 'onlyNotDocumented'] as const) {
      if (typeof p[k] === 'boolean') out[k] = p[k] as boolean;
    }
    return out;
  } catch {
    return {};
  }
}

export function saveLedgerPrefs(clinicId: string, prefs: LedgerPrefs): void {
  try {
    localStorage.setItem(key(clinicId), JSON.stringify(prefs));
  } catch {
    /* storage unavailable — filters just aren't remembered */
  }
}

const iso = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

/** The date range a preset means today. `custom` has no range of its own (null). */
export function presetRange(
  preset: DatePreset,
  now: Date = new Date()
): { from: string; to: string } | null {
  switch (preset) {
    case 'today':
      return { from: iso(now), to: iso(now) };
    case 'yesterday': {
      const y = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1);
      return { from: iso(y), to: iso(y) };
    }
    case 'week':
      return currentWeekRange(now);
    case 'month':
      return { from: iso(new Date(now.getFullYear(), now.getMonth(), 1)), to: iso(now) };
    case 'lastMonth':
      return {
        from: iso(new Date(now.getFullYear(), now.getMonth() - 1, 1)),
        to: iso(new Date(now.getFullYear(), now.getMonth(), 0)),
      };
    case 'all':
      return { from: '', to: '' };
    default:
      return null;
  }
}
