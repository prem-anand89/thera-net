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

/**
 * Advances (deposits) by department. Until an advance carries a department of its own (a later step adds the column),
 * every advance belongs to OP, so IP and Home care show none and nothing is counted twice.
 */
export function advancesForDepartment<A>(department: Department, advances: readonly A[]): A[] {
  return department === 'clinic' ? [...advances] : [];
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
