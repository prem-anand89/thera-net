import { departmentOf, type Department } from './departments';

type Located = { location?: string | null };

/** The records (visits, appointments) that belong to a department. A record with no place is OP. */
export function inDepartmentList<T extends Located>(department: Department, records: readonly T[]): T[] {
  return records.filter((r) => departmentOf(r) === department);
}

/**
 * A payment belongs to the department of the visit it paid for, so each department's collections, daybook and dues are
 * its own. A payment whose visit is not known (not on this device) reads as OP, the way a record with no place does.
 */
export function paymentsForDepartment<P extends { visitId?: string | null }>(
  department: Department,
  payments: readonly P[],
  visitsById: ReadonlyMap<string, Located>
): P[] {
  return payments.filter((p) => departmentOf(p.visitId ? visitsById.get(p.visitId) : undefined) === department);
}

type AdvanceItem = {
  department?: string | null;
  advance?: { department?: string | null } | null;
};

/**
 * Advances (deposits) by department. An advance belongs to the department it was recorded in;
 * older rows with no department belong to OP ('clinic'). Works on both raw `PatientAdvance`
 * rows and `{ advance, remainingPaise }` balance entries.
 */
export function advancesForDepartment<A extends AdvanceItem>(department: Department, advances: readonly A[]): A[] {
  return advances.filter((item) => {
    const raw = item.department ?? item.advance?.department;
    const advDept: Department = raw === 'home' || raw === 'ward' ? raw : 'clinic';
    return advDept === department;
  });
}

/**
 * What an inpatient stay has run up and not yet billed: the live ward sessions that are not on a bill. These are not dues
 * (the patient is billed at discharge), so the Workspace shows them as "Running charges", never in Dues.
 */
export function runningCharges(
  visits: readonly (Located & { deleted?: boolean; invoiceId?: string | null; actualBillPaise: number; admissionId?: string | null })[]
): { paise: number; sessions: number; stays: number } {
  const open = visits.filter((v) => departmentOf(v) === 'ward' && !v.deleted && !v.invoiceId);
  return {
    paise: open.reduce((sum, v) => sum + v.actualBillPaise, 0),
    sessions: open.length,
    stays: new Set(open.map((v) => v.admissionId).filter(Boolean)).size,
  };
}

/** Money the hospital counter collected: shown on its own line (Hospital partner clearance), never as cash in a drawer. */
export function isPartnerClearance(method: string): boolean {
  return method === 'partner';
}

/** True when a visit is an inpatient stay / ward session (never collected or invoiced per individual session). */
export function isInpatientVisit(
  visit: { location?: string | null; admissionId?: string | null } | null | undefined
): boolean {
  return departmentOf(visit) === 'ward';
}

/**
 * True when the hospital / partner bills inpatients and therapists only document service names and amounts.
 * Explicit `clinic.ipBilledByPartner` wins when set; otherwise defaults to `Boolean(clinic.hasPartner && clinic.partnerCollects)`.
 */
export function isIpBilledByPartner(
  clinic: { ipBilledByPartner?: boolean | null; hasPartner?: boolean; partnerCollects?: boolean } | null | undefined
): boolean {
  if (!clinic) return false;
  if (typeof clinic.ipBilledByPartner === 'boolean') return clinic.ipBilledByPartner;
  return Boolean(clinic.hasPartner && clinic.partnerCollects);
}

/**
 * True when the clinic / rehab centre issues its own inpatient stay / discharge bills.
 * False when the hospital / partner bills inpatients directly.
 */
export function canBillInpatientStay(
  clinic: { ipBilledByPartner?: boolean | null; hasPartner?: boolean; partnerCollects?: boolean } | null | undefined
): boolean {
  return !isIpBilledByPartner(clinic);
}

/** How an inpatient visit's billing status should be displayed on visit cards/tables, or null for OP/Home visits. */
export function inpatientVisitBillingMode(
  visit: { location?: string | null; admissionId?: string | null } | null | undefined,
  clinic: { ipBilledByPartner?: boolean | null; hasPartner?: boolean; partnerCollects?: boolean } | null | undefined
): 'stay_bill' | 'partner_billed' | null {
  if (!isInpatientVisit(visit)) return null;
  return isIpBilledByPartner(clinic) ? 'partner_billed' : 'stay_bill';
}
