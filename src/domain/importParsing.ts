import type { Paise } from './money';
import { rupeesToPaise } from './money';

/**
 * Historical-ledger service names are freeform ("Physio 3/7", "Manual
 * Therapy", "Exercise Therapy + KT"). This maps the short-hand prefixes
 * seen in the sheet to the catalog's family names; anything not in this
 * map is left as-is, which is deliberate — it means the constructed
 * catalog name below won't match anything and the row surfaces as an
 * "unmatched service" flag rather than silently inventing a product.
 */
const SERVICE_ALIASES: Record<string, string> = {
  physio: 'Physiotherapy',
  physiotherapy: 'Physiotherapy',
  'exercise therapy': 'Exercise Therapy',
  'manual therapy': 'Manual Therapy',
  'advanced therapy': 'Advanced Therapy',
  consultation: 'Consultation',
  'fascia release': 'Fascia Release',
  'kinesio taping': 'Kinesio Taping',
  assessment: 'Assessment',
};

export interface ParsedServiceName {
  /** Family name after alias lookup + whitespace/case normalization */
  aliasBase: string;
  /** Session number from "N/M", or null if the text had no fraction */
  numerator: number | null;
  /** Package size from "N/M", or null if the text had no fraction */
  denominator: number | null;
}

/** Collapses internal whitespace and trims — sheet cells have stray spaces. */
function normalizeWhitespace(s: string): string {
  return s.trim().replace(/\s+/g, ' ');
}

const FRACTION_RE = /^(.*?)\s+(\d+)\s*\/\s*(\d+)$/;

export function parseServiceName(raw: string): ParsedServiceName {
  const cleaned = normalizeWhitespace(raw);
  const match = FRACTION_RE.exec(cleaned);
  const [base, numerator, denominator] = match
    ? [match[1], Number(match[2]), Number(match[3])]
    : [cleaned, null, null];

  const alias = SERVICE_ALIASES[base.toLowerCase()];
  return { aliasBase: alias ?? base, numerator, denominator };
}

/**
 * Reconstructs the catalog entry name a parsed service name should match.
 * Package sizes name their catalog entry "<family> <M> Days"; single
 * sessions use the bare family name (matching supabase/seed.sql).
 */
export function buildCatalogName(parsed: ParsedServiceName): string {
  if (parsed.denominator && parsed.denominator > 1) {
    return `${parsed.aliasBase} ${parsed.denominator} Days`;
  }
  return parsed.aliasBase;
}

/**
 * The sheet stores dates as native Excel dates, except one corrupted cell
 * that reads back as a bare time-of-day fraction (a number, not a Date).
 * Anything that isn't a valid Date instance is treated as unparseable so
 * it surfaces as a flag instead of importing a wrong/blank date.
 */
export function parseHistoricalDate(raw: unknown): string | null {
  if (!(raw instanceof Date) || Number.isNaN(raw.getTime())) return null;
  const y = raw.getFullYear();
  const m = String(raw.getMonth() + 1).padStart(2, '0');
  const d = String(raw.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export interface CanonicalizedName {
  canonical: string;
  variants: string[];
  ambiguous: boolean;
}

/**
 * One MRNO can have several spellings across visits (typos, nicknames).
 * MRNO is the reliable key, so we pick one display name — the most
 * frequently used spelling, ties broken by the longest — and flag the
 * MRNO as ambiguous when there's more than one distinct spelling so the
 * review screen can show it, without blocking the import over it.
 */
export function canonicalizePatientName(names: string[]): CanonicalizedName {
  const counts = new Map<string, number>();
  for (const raw of names) {
    const n = normalizeWhitespace(raw);
    counts.set(n, (counts.get(n) ?? 0) + 1);
  }
  const variants = [...counts.keys()];
  const canonical = variants.reduce((best, candidate) => {
    const bestCount = counts.get(best)!;
    const candidateCount = counts.get(candidate)!;
    if (candidateCount > bestCount) return candidate;
    if (candidateCount === bestCount && candidate.length > best.length) return candidate;
    return best;
  }, variants[0]);
  return { canonical, variants, ambiguous: variants.length > 1 };
}

/** "44/M" -> { age: 44, sex: 'M' }. Tolerates missing/malformed cells. */
export function parseAgeSex(raw: string | null | undefined): {
  age: number | null;
  sex: 'M' | 'F' | 'Other' | null;
} {
  if (!raw) return { age: null, sex: null };
  const match = /^\s*(\d+)\s*\/\s*([A-Za-z]+)\s*$/.exec(raw);
  if (!match) return { age: null, sex: null };
  const sexRaw = match[2].toUpperCase();
  const sex = sexRaw === 'M' || sexRaw === 'F' ? sexRaw : 'Other';
  return { age: Number(match[1]), sex };
}

export interface PackageSessionInput {
  /** Caller's opaque row identifier, echoed back on the result */
  key: string;
  /** Rows are grouped by this — typically `${mrno}::${catalogItemId}` */
  groupKey: string;
  /** Sortable chronological key (e.g. ISO date + zero-padded sheet order) */
  sortKey: string;
  /** Parsed session number from the sheet's "N/M" (must be non-null to call this) */
  numerator: number;
  /** The resolved catalog item's session count */
  packageTotal: number;
  billAmountPaise: Paise;
}

export interface PackageSessionResult {
  key: string;
  packageGroupId: string;
  sessionIndex: number;
  packageTotal: number;
  /** True for the one row in the group that carries the real charge */
  isAnchor: boolean;
  /** Set on every row of a group whose billing doesn't resolve to exactly one anchor */
  anomaly: 'no-anchor' | 'multiple-anchors' | null;
}

/**
 * Groups a patient's package sessions in chronological order. Session
 * numbering restarts (a patient buying the same package type twice) or a
 * group already reaching its package size both start a new group — this
 * is what makes two separate "1/5..5/5" purchases by the same patient
 * resolve to two packageGroupIds instead of one. Exactly one row per group
 * should carry the historical nonzero bill (the front desk didn't always
 * log payment on session 1); that row becomes the anchor and every other
 * row in the group is a ₹0 continuation. Groups with zero or multiple
 * nonzero-bill rows are flagged for manual review rather than guessed at.
 */
export function groupPackageSessions(rows: PackageSessionInput[]): PackageSessionResult[] {
  const byGroupKey = new Map<string, PackageSessionInput[]>();
  for (const row of rows) {
    if (!byGroupKey.has(row.groupKey)) byGroupKey.set(row.groupKey, []);
    byGroupKey.get(row.groupKey)!.push(row);
  }

  const results: PackageSessionResult[] = [];
  for (const groupRows of byGroupKey.values()) {
    const sorted = [...groupRows].sort((a, b) => a.sortKey.localeCompare(b.sortKey));

    let open: PackageSessionInput[] = [];
    let lastNumerator = -Infinity;
    const flush = () => {
      if (open.length) results.push(...finalizeGroup(open));
      open = [];
      lastNumerator = -Infinity;
    };

    for (const row of sorted) {
      const startsNewGroup =
        open.length === 0 || row.numerator <= lastNumerator || open.length >= row.packageTotal;
      if (startsNewGroup) flush();
      open.push(row);
      lastNumerator = row.numerator;
    }
    flush();
  }
  return results;
}

function finalizeGroup(rows: PackageSessionInput[]): PackageSessionResult[] {
  const packageGroupId = crypto.randomUUID();
  const anchors = rows.filter((r) => r.billAmountPaise > 0);
  const anomaly: PackageSessionResult['anomaly'] =
    anchors.length === 0 ? 'no-anchor' : anchors.length > 1 ? 'multiple-anchors' : null;

  return rows.map((row) => ({
    key: row.key,
    packageGroupId,
    sessionIndex: row.numerator,
    packageTotal: row.packageTotal,
    isAnchor: anomaly === null && row === anchors[0],
    anomaly,
  }));
}

export function rupeesToPaiseSafe(rupees: number | null | undefined): Paise {
  if (rupees == null || Number.isNaN(rupees)) return 0;
  return rupeesToPaise(rupees);
}
