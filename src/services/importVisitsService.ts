import type { UUID } from '@/domain/types';
import type { Paise } from '@/domain/money';
import {
  buildCatalogName,
  canonicalizePatientName,
  groupPackageSessions,
  parseAgeSex,
  parseHistoricalDate,
  parseServiceName,
  rupeesToPaiseSafe,
  type PackageSessionInput,
} from '@/domain/importParsing';
import type { Repos } from '@/repositories/types';
import { createPatientService } from './patientService';
import { createVisitService } from './visitService';
import type { RawImportRow } from './import/xlsxReader';

const HISTORICAL_ADJUSTMENT_REASON = 'Historical import — see original ledger';

export type BlockingIssue = 'bad-date' | 'unknown-therapist' | 'unmatched-service' | 'package-anomaly';

export interface PreviewRow {
  key: string; // `${sheet}#${sheetRowIndex}` — stable identifier for resolutions
  raw: RawImportRow;
  mrno: string;
  patientNameCanonical: string;
  patientNameVariants: string[];
  patientNameAmbiguous: boolean;
  existingPatientId: UUID | null;
  therapistId: UUID | null;
  visitDate: string | null;
  catalogItemId: UUID | null;
  attemptedCatalogName: string;
  billAmountPaise: Paise;
  isPackage: boolean;
  packageGroupId: string | null;
  sessionIndex: number | null;
  packageTotal: number | null;
  isAnchor: boolean;
  packageAnomaly: 'no-anchor' | 'multiple-anchors' | null;
  blockingIssues: BlockingIssue[];
}

export interface ImportPreview {
  rows: PreviewRow[];
  summary: {
    totalRows: number;
    distinctPatients: number;
    newPatients: number;
    packagesDetected: number;
    flaggedRows: number;
  };
}

export interface RowResolution {
  skip?: boolean;
  catalogItemId?: UUID;
  visitDate?: string;
  /** Resolves a package-anomaly group by naming this row the billed session */
  setAsAnchor?: boolean;
  /** Paired with setAsAnchor when the sheet's own amount for that row was 0/wrong */
  manualBillPaise?: Paise;
  patientNameOverride?: string;
}

export type Resolutions = Record<string, RowResolution>;

export interface ImportProgress {
  done: number;
  total: number;
}

export interface ImportSummary {
  patientsCreated: number;
  patientsReused: number;
  visitsCreated: number;
  rowsSkipped: number;
}

function rowKey(raw: RawImportRow): string {
  return `${raw.sheet}#${raw.sheetRowIndex}`;
}

export function createImportVisitsService(repos: Repos) {
  const patientService = createPatientService(repos);
  const visitService = createVisitService(repos);

  async function preview(rawRows: RawImportRow[], clinicId: UUID): Promise<ImportPreview> {
    const [therapists, catalogItems] = await Promise.all([
      repos.therapists.list(clinicId, true),
      repos.catalog.list(clinicId, true),
    ]);
    const therapistIdByName = new Map(therapists.map((t) => [t.name.trim().toLowerCase(), t.id]));
    const catalogByName = new Map(catalogItems.map((c) => [c.name.trim().toLowerCase(), c]));

    const namesByMrno = new Map<string, string[]>();
    for (const raw of rawRows) {
      if (!namesByMrno.has(raw.mrno)) namesByMrno.set(raw.mrno, []);
      namesByMrno.get(raw.mrno)!.push(raw.patientName);
    }
    const canonicalByMrno = new Map(
      [...namesByMrno.entries()].map(([mrno, names]) => [mrno, canonicalizePatientName(names)])
    );
    const existingPatientIdByMrno = new Map<string, UUID | null>();
    for (const mrno of namesByMrno.keys()) {
      const existing = await repos.patients.getByMrno(clinicId, mrno);
      existingPatientIdByMrno.set(mrno, existing?.id ?? null);
    }

    const rows: PreviewRow[] = rawRows.map((raw) => {
      const visitDate = parseHistoricalDate(raw.dateRaw);
      const therapistId = therapistIdByName.get(raw.therapistName.trim().toLowerCase()) ?? null;
      const parsedService = parseServiceName(raw.serviceNameRaw);
      const attemptedCatalogName = buildCatalogName(parsedService);
      const catalogItem = catalogByName.get(attemptedCatalogName.trim().toLowerCase());
      const billAmountPaise = rupeesToPaiseSafe(raw.billAmountRupees);
      const canon = canonicalByMrno.get(raw.mrno)!;

      const blockingIssues: BlockingIssue[] = [];
      if (!visitDate) blockingIssues.push('bad-date');
      if (!therapistId) blockingIssues.push('unknown-therapist');
      if (!catalogItem) blockingIssues.push('unmatched-service');

      const isPackage =
        parsedService.denominator != null && parsedService.denominator > 1 && !!catalogItem;

      return {
        key: rowKey(raw),
        raw,
        mrno: raw.mrno,
        patientNameCanonical: canon.canonical,
        patientNameVariants: canon.variants,
        patientNameAmbiguous: canon.ambiguous,
        existingPatientId: existingPatientIdByMrno.get(raw.mrno) ?? null,
        therapistId,
        visitDate,
        catalogItemId: catalogItem?.id ?? null,
        attemptedCatalogName,
        billAmountPaise,
        isPackage,
        // filled in below for package rows; single-session rows have no group
        packageGroupId: null,
        sessionIndex: null,
        packageTotal: null,
        isAnchor: !isPackage,
        packageAnomaly: null,
        blockingIssues,
      };
    });

    // Group package sessions per (mrno, catalogItemId) — only rows that
    // resolved cleanly and carry a session fraction participate.
    const groupInputs: PackageSessionInput[] = [];
    for (const row of rows) {
      if (!row.isPackage || !row.catalogItemId) continue;
      const parsed = parseServiceName(row.raw.serviceNameRaw);
      if (parsed.numerator == null) continue;
      const catalogItem = catalogItems.find((c) => c.id === row.catalogItemId)!;
      groupInputs.push({
        key: row.key,
        groupKey: `${row.mrno}::${row.catalogItemId}`,
        sortKey: `${row.visitDate ?? '9999-99-99'}#${row.raw.sheet}-${String(row.raw.sheetRowIndex).padStart(4, '0')}`,
        numerator: parsed.numerator,
        packageTotal: catalogItem.sessionCount,
        billAmountPaise: row.billAmountPaise,
      });
    }
    const grouped = new Map(groupPackageSessions(groupInputs).map((g) => [g.key, g]));
    for (const row of rows) {
      const g = grouped.get(row.key);
      if (!g) continue;
      row.packageGroupId = g.packageGroupId;
      row.sessionIndex = g.sessionIndex;
      row.packageTotal = g.packageTotal;
      row.isAnchor = g.isAnchor;
      row.packageAnomaly = g.anomaly;
      if (g.anomaly) row.blockingIssues.push('package-anomaly');
    }

    const distinctPatients = namesByMrno.size;
    const newPatients = [...existingPatientIdByMrno.values()].filter((id) => id === null).length;
    const packagesDetected = new Set(rows.map((r) => r.packageGroupId).filter(Boolean)).size;
    const flaggedRows = rows.filter((r) => r.blockingIssues.length > 0).length;

    return {
      rows,
      summary: { totalRows: rows.length, distinctPatients, newPatients, packagesDetected, flaggedRows },
    };
  }

  async function commit(
    preview: ImportPreview,
    resolutions: Resolutions,
    clinicId: UUID,
    onProgress?: (progress: ImportProgress) => void
  ): Promise<ImportSummary> {
    const catalogItems = await repos.catalog.list(clinicId, true);
    const catalogById = new Map(catalogItems.map((c) => [c.id, c]));

    const toCommit = preview.rows.filter((r) => !resolutions[r.key]?.skip);
    const rowsSkipped = preview.rows.length - toCommit.length;

    const unresolved = toCommit.filter((r) => {
      const res = resolutions[r.key];
      const catalogItemId = res?.catalogItemId ?? r.catalogItemId;
      const visitDate = res?.visitDate ?? r.visitDate;
      const anomalyResolved = !r.packageAnomaly || res?.setAsAnchor !== undefined;
      return !catalogItemId || !visitDate || !r.therapistId || !anomalyResolved;
    });
    if (unresolved.length > 0) {
      throw new Error(
        `${unresolved.length} row(s) still have unresolved issues (bad date, unmatched service, unknown therapist, or an unresolved package anomaly) — resolve or skip them before importing.`
      );
    }

    // Sort chronologically so package continuations are written after their
    // anchor and progress reads sensibly; linkage itself doesn't depend on
    // order since packageGroupId is assigned up front.
    const ordered = [...toCommit].sort((a, b) => {
      const dateA = resolutions[a.key]?.visitDate ?? a.visitDate!;
      const dateB = resolutions[b.key]?.visitDate ?? b.visitDate!;
      if (dateA !== dateB) return dateA.localeCompare(dateB);
      return a.raw.sheetRowIndex - b.raw.sheetRowIndex;
    });

    const patientIdByMrno = new Map<string, UUID>();
    let patientsCreated = 0;
    let patientsReused = 0;
    for (const row of ordered) {
      if (patientIdByMrno.has(row.mrno)) continue;
      if (row.existingPatientId) {
        patientIdByMrno.set(row.mrno, row.existingPatientId);
        patientsReused++;
        continue;
      }
      const name = resolutions[row.key]?.patientNameOverride ?? row.patientNameCanonical;
      const { age, sex } = parseAgeSex(row.raw.ageSex);
      const created = await patientService.create({
        clinicId,
        mrno: row.mrno,
        name,
        age,
        sex,
        primaryCondition: row.raw.condition,
      });
      patientIdByMrno.set(row.mrno, created.id);
      patientsCreated++;
    }

    let visitsCreated = 0;
    for (const row of ordered) {
      const res = resolutions[row.key];
      const catalogItemId = res?.catalogItemId ?? row.catalogItemId!;
      const catalogItem = catalogById.get(catalogItemId)!;
      const visitDate = res?.visitDate ?? row.visitDate!;
      const isAnchor = res?.setAsAnchor ?? row.isAnchor;
      const isContinuation = row.isPackage && !isAnchor;
      const actualBillPaise = isContinuation
        ? undefined
        : (res?.manualBillPaise ?? row.billAmountPaise);

      const catalogPriceForRow = isContinuation ? 0 : catalogItem.basePricePaise;
      const willAdjust = actualBillPaise != null && actualBillPaise !== catalogPriceForRow;

      await visitService.create({
        clinicId,
        patientId: patientIdByMrno.get(row.mrno)!,
        therapistId: row.therapistId!,
        visitDate,
        serviceCatalogId: catalogItemId,
        condition: row.raw.condition,
        treatmentNotes: row.raw.treatmentNotes,
        actualBillPaise,
        adjustmentReason: willAdjust ? HISTORICAL_ADJUSTMENT_REASON : undefined,
        ...(row.isPackage
          ? {
              isContinuation,
              sessionIndex: row.sessionIndex,
              packageTotal: row.packageTotal,
              packageGroupId: row.packageGroupId,
            }
          : {}),
      });
      visitsCreated++;
      onProgress?.({ done: visitsCreated, total: ordered.length });
    }

    return { patientsCreated, patientsReused, visitsCreated, rowsSkipped };
  }

  return { preview, commit };
}
