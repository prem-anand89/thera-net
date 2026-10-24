import type { VisitLineInput } from '@/services/visitService';
import type { BillAdjustmentMode, BillAdjustmentValueType } from '@/domain/billAdjustment';
import type { UUID } from '@/domain/types';
import { continuationLine, emptyDraftLine, hasService, type DraftLine, type OpenPackage } from './ServiceRows';

export const PACKAGE_NOT_OPEN =
  'That package is no longer open for this patient. Remove it or pick another service.';

/**
 * The rows as `NewVisitInput.lines`. Every package session is checked against the patient's CURRENT open
 * packages (not the snapshot the row carries): the same package must still be open, and the session
 * number comes from the fresh entry. Returns the lines, or the problem per row index.
 */
export function draftLinesToVisitLines(
  rows: DraftLine[],
  openPackages: OpenPackage[]
): { lines: VisitLineInput[] } | { errors: Map<number, string> } {
  const errors = new Map<number, string>();
  const lines: VisitLineInput[] = [];
  rows.forEach((r, i) => {
    if (r.continuation) {
      const fresh = openPackages.find((p) => p.packageGroupId === r.continuation!.packageGroupId);
      if (!fresh) {
        errors.set(i, PACKAGE_NOT_OPEN);
        return;
      }
      lines.push({
        serviceCatalogId: fresh.serviceCatalogId,
        assistingTherapistId: r.assistingTherapistId,
        ...(r.sessionShare ? { sessionShare: r.sessionShare } : {}),
        packageContinuation: {
          packageGroupId: fresh.packageGroupId,
          sessionIndex: fresh.logged + 1,
          packageTotal: fresh.packageTotal,
        },
      });
      return;
    }
    if (!hasService(r)) {
      errors.set(i, 'Pick a service.');
      return;
    }
    lines.push({
      serviceCatalogId: r.serviceCatalogId!,
      assistingTherapistId: r.assistingTherapistId,
      ...(r.sessionShare ? { sessionShare: r.sessionShare } : {}),
    });
  });
  return errors.size > 0 ? { errors } : { lines };
}

/** Whether the discount / extra the user typed still makes sense for a new subtotal (false = clear it). */
export function adjustmentSurvives(
  subtotalPaise: number,
  mode: BillAdjustmentMode,
  valueType: BillAdjustmentValueType,
  value: string
): boolean {
  if (mode === 'none') return true;
  if (subtotalPaise <= 0) return false;
  return !(mode === 'discount' && valueType === 'amount' && Math.round(Number(value || 0) * 100) > subtotalPaise);
}

/** A patient's starting rows: their one open package is continued automatically; otherwise one empty row. */
export function initialRowsForPatient(openPackages: OpenPackage[]): DraftLine[] {
  return openPackages.length === 1 ? [continuationLine(openPackages[0])] : [emptyDraftLine()];
}

/**
 * The rows once a patient is chosen. Rows belonging to a different, previous patient start over. With no
 * previous patient (the first pick, or after the patient was cleared) the services already chosen are kept
 * and the one open package, if any, is added in front — unless a kept row is already a package. Continuation rows only ever come from
 * a patient's own packages, so rows chosen before any patient never include one.
 */
export function rowsForNewPatient(
  prevRows: DraftLine[],
  openPackages: OpenPackage[],
  previousPatientId: UUID | null,
  isPackageRow: (row: DraftLine) => boolean = (r) => Boolean(r.continuation)
): DraftLine[] {
  if (previousPatientId !== null) return initialRowsForPatient(openPackages);
  const kept = prevRows.filter((r) => hasService(r) && !r.continuation);
  const lead = openPackages.length === 1 && !kept.some(isPackageRow) ? [continuationLine(openPackages[0])] : [];
  const rows = [...lead, ...kept];
  return rows.length > 0 ? rows : [emptyDraftLine()];
}

/**
 * "Change patient" is offered only when the patient was chosen on this page:
 * not when the link named one (?patientId) and not in the repeat-visit flow
 * (?repeatVisitId), where the repeated patient is re-selected immediately.
 */
export function canChangePatient(search: { patientId?: string; repeatVisitId?: string }): boolean {
  return !search.patientId && !search.repeatVisitId;
}
