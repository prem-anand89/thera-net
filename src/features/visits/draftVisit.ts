import type { VisitLineInput } from '@/services/visitService';
import type { BillAdjustmentMode, BillAdjustmentValueType } from '@/domain/billAdjustment';
import type { UUID } from '@/domain/types';
import type { Visit, VisitItem } from '@/domain/types';
import { continuationLine, emptyDraftLine, hasService, type DraftLine, type OpenPackage } from './ServiceRows';

/** The message an empty service row gets; the page checks for it to word its own summary. */
export const CHOOSE_A_SERVICE = 'Choose a service.';

export const PACKAGE_NOT_OPEN =
  'This package is no longer open for this patient. Remove it or choose another service.';

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
      errors.set(i, CHOOSE_A_SERVICE);
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

/**
 * The share a package's next session starts with: the one on the live package line of the most recent
 * logged session that had one — so a colleague who helps over several sessions is entered once. Null when
 * no session had a share, or that colleague is no longer active.
 */
export function lastPackageShare(
  group: Visit[],
  items: VisitItem[],
  isActive: (therapistId: string) => boolean
): { therapistId: string; pct: number } | null {
  const newestFirst = [...group].sort(
    (a, b) => b.visitDate.localeCompare(a.visitDate) || (b.sessionIndex ?? 0) - (a.sessionIndex ?? 0)
  );
  for (const v of newestFirst) {
    const line = items.find((i) => i.visitId === v.id && !i.deleted && i.isPackageLine);
    if (line?.sessionShareTherapistId && line.sessionSharePct) {
      return isActive(line.sessionShareTherapistId)
        ? { therapistId: line.sessionShareTherapistId, pct: line.sessionSharePct }
        : null;
    }
  }
  return null;
}

/**
 * Why the visit's therapist is who it is, for the small label beside the field ("Booked", "Last visit", "You").
 * Mirrors the order the page fills it in: the appointment's therapist, else the patient's last one, else the
 * logged-in therapist. Null when the person was picked by hand and matches none of them.
 */
export type TherapistReason = 'Booked' | 'Last visit' | 'You';
export function therapistReason(input: {
  therapistId: string;
  appointmentTherapistId?: string | null;
  lastVisitTherapistId?: string | null;
  myTherapistId?: string | null;
}): TherapistReason | null {
  if (!input.therapistId) return null;
  if (input.appointmentTherapistId === input.therapistId) return 'Booked';
  if (input.lastVisitTherapistId === input.therapistId) return 'Last visit';
  if (input.myTherapistId === input.therapistId) return 'You';
  return null;
}

/**
 * Whether the Treatments card should fold itself to its summary line now: a service was just chosen (the count
 * grew), something was ticked or typed, and it has not folded before for this patient. Never on any other change,
 * so it can't jump away while someone is still ticking, and it stays open once they re-open it.
 */
export function shouldFoldTreatments(input: {
  previousServiceCount: number;
  serviceCount: number;
  hasTreatmentInfo: boolean;
  foldedOnce: boolean;
}): boolean {
  return input.serviceCount > input.previousServiceCount && input.hasTreatmentInfo && !input.foldedOnce;
}

/**
 * The treatment chips to show: the first `limit` (most used first) plus anything already ticked, so a ticked
 * treatment is never hidden behind "+ N more". `showAll` shows every one.
 */
export function visibleTreatmentOptions<T extends { id: string }>(
  ordered: T[],
  selectedIds: string[],
  showAll: boolean,
  limit = 6
): T[] {
  if (showAll) return ordered;
  return ordered.filter((t, i) => i < limit || selectedIds.includes(t.id));
}

/**
 * The most recent package this patient used up entirely (every session logged), for the line in the patient card
 * when they have no open package: without it a patient whose package just finished shows nothing about packages
 * at all, and it reads as if the package had never been found.
 */
export function lastFinishedPackage(
  visits: { packageGroupId: string | null; packageTotal: number | null; visitDate: string; serviceCatalogId: string; deleted?: boolean }[]
): { serviceCatalogId: string; total: number; finishedOn: string } | null {
  const groups = new Map<string, typeof visits>();
  for (const v of visits) {
    if (v.deleted || !v.packageGroupId) continue;
    const group = groups.get(v.packageGroupId) ?? [];
    group.push(v);
    groups.set(v.packageGroupId, group);
  }
  let best: { serviceCatalogId: string; total: number; finishedOn: string } | null = null;
  for (const group of groups.values()) {
    const total = Math.max(...group.map((v) => v.packageTotal ?? 0));
    if (total <= 1 || group.length < total) continue;
    const sorted = [...group].sort((a, b) => a.visitDate.localeCompare(b.visitDate));
    const finishedOn = sorted[sorted.length - 1]!.visitDate;
    if (!best || finishedOn > best.finishedOn) best = { serviceCatalogId: sorted[0]!.serviceCatalogId, total, finishedOn };
  }
  return best;
}
