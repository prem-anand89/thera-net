import { clinicBillingConfig, type Visit, type UUID } from '@/domain/types';
import type { Paise } from '@/domain/money';
import { computeVisitSplit } from '@/domain/split';
import type { Repos } from '@/repositories/types';

export interface NewVisitInput {
  clinicId: UUID;
  patientId: UUID;
  therapistId: UUID;
  visitDate: string;
  serviceCatalogId: UUID;
  condition?: string | null;
  treatmentNotes?: string | null;
  /** Omit to bill the catalog price; any difference requires a reason */
  actualBillPaise?: Paise;
  adjustmentReason?: string | null;
  sessionIndex?: number | null;
  packageTotal?: number | null;
  /** Set when logging session 2..N of an existing package */
  packageGroupId?: UUID | null;
  /**
   * ₹0 continuation session of a package billed on an earlier visit. The
   * catalog-price snapshot is 0 here (the package price lives on the billed
   * visit), so a zero bill is recorded as normal — not as a 100% discount.
   */
  isContinuation?: boolean;
  /**
   * Set when the therapist explicitly marks the bill "collect later" at
   * logging time, instead of paying immediately. Optional free-text reason —
   * surfaced on the Workspace pending-work list. Absence of a Payment row
   * (not this field) is what actually drives outstanding calculations.
   */
  pendingPaymentNote?: string | null;
}

export function createVisitService(repos: Repos) {
  async function buildFinancials(
    clinicId: UUID,
    serviceCatalogId: UUID,
    input: Pick<NewVisitInput, 'actualBillPaise' | 'adjustmentReason' | 'isContinuation'>
  ) {
    const clinic = await repos.clinics.get(clinicId);
    if (!clinic) throw new Error('Clinic not found');
    const item = await repos.catalog.get(serviceCatalogId);
    if (!item) throw new Error('Catalog service not found');

    const catalogPricePaise = input.isContinuation ? 0 : item.basePricePaise;
    const actualBillPaise = input.actualBillPaise ?? catalogPricePaise;
    if (actualBillPaise < 0) throw new Error('Bill amount cannot be negative');
    const adjustmentPaise = actualBillPaise - catalogPricePaise;
    if (adjustmentPaise !== 0 && !input.adjustmentReason?.trim()) {
      throw new Error('An adjustment reason is required when the bill differs from the catalog price');
    }
    return { clinic, item, catalogPricePaise, actualBillPaise, adjustmentPaise };
  }

  return {
    async create(input: NewVisitInput): Promise<Visit> {
      const { clinic, item, catalogPricePaise, actualBillPaise, adjustmentPaise } =
        await buildFinancials(input.clinicId, input.serviceCatalogId, input);

      // In simple (non-hospital) mode the split degenerates: the whole bill is
      // the clinic's, no tax withheld. Snapshots stored as 100 / 0 keep the
      // visit self-consistent (share=bill, post-tax=bill, tds=0, hv=0) so
      // reports reconcile and the immutability trigger stays satisfied.
      const { hospitalSplit } = clinicBillingConfig(clinic);
      const splitPct = hospitalSplit ? clinic.bmSplitPct : 100;
      const taxPct = hospitalSplit ? clinic.taxPct : 0;
      const tdsBasis = hospitalSplit ? clinic.tdsBasis : 'gross_bill';
      const split = computeVisitSplit(actualBillPaise, splitPct, taxPct, tdsBasis);

      const isPackage = (input.packageTotal ?? item.sessionCount) > 1;
      const visit: Visit = {
        id: crypto.randomUUID(),
        clinicId: input.clinicId,
        patientId: input.patientId,
        therapistId: input.therapistId,
        visitDate: input.visitDate,
        condition: input.condition?.trim() || null,
        treatmentNotes: input.treatmentNotes?.trim() || null,
        serviceCatalogId: input.serviceCatalogId,
        catalogPricePaise,
        actualBillPaise,
        adjustmentPaise,
        adjustmentReason: adjustmentPaise !== 0 ? (input.adjustmentReason?.trim() ?? null) : null,
        sessionIndex: input.sessionIndex ?? (isPackage ? 1 : null),
        packageTotal: input.packageTotal ?? (isPackage ? item.sessionCount : null),
        packageGroupId: input.packageGroupId ?? (isPackage ? crypto.randomUUID() : null),
        // Rate snapshots: historical visits keep the split that was active
        // when they were billed, even if the clinic renegotiates later.
        bmSplitPct: splitPct,
        taxPct,
        tdsBasis,
        bmSharePaise: split.bmSharePaise,
        postTaxPaise: split.postTaxPaise,
        tdsPaise: split.tdsPaise,
        hvPaise: split.hvPaise,
        invoiceId: null,
        pendingPaymentNote: input.pendingPaymentNote?.trim() || null,
        deleted: false,
        updatedAt: new Date().toISOString(),
      };
      await repos.visits.put(visit);
      return visit;
    },

    /**
     * Edits an uninvoiced visit. Splits are recomputed with the visit's
     * ORIGINAL rate snapshots — editing a bill never silently re-rates it.
     */
    async updateBilling(
      visitId: UUID,
      changes: {
        actualBillPaise?: Paise;
        adjustmentReason?: string | null;
        therapistId?: UUID;
        visitDate?: string;
        condition?: string | null;
        treatmentNotes?: string | null;
      }
    ): Promise<Visit> {
      const visit = await repos.visits.get(visitId);
      if (!visit) throw new Error('Visit not found');
      if (visit.invoiceId) {
        throw new Error('This visit is on an issued invoice; its billing is frozen.');
      }

      const actualBillPaise = changes.actualBillPaise ?? visit.actualBillPaise;
      const adjustmentPaise = actualBillPaise - visit.catalogPricePaise;
      const reason =
        changes.adjustmentReason !== undefined ? changes.adjustmentReason : visit.adjustmentReason;
      if (adjustmentPaise !== 0 && !reason?.trim()) {
        throw new Error('An adjustment reason is required when the bill differs from the catalog price');
      }
      const split = computeVisitSplit(
        actualBillPaise,
        visit.bmSplitPct,
        visit.taxPct,
        visit.tdsBasis
      );

      const updated: Visit = {
        ...visit,
        ...('therapistId' in changes && changes.therapistId ? { therapistId: changes.therapistId } : {}),
        ...('visitDate' in changes && changes.visitDate ? { visitDate: changes.visitDate } : {}),
        ...('condition' in changes ? { condition: changes.condition?.trim() || null } : {}),
        ...('treatmentNotes' in changes
          ? { treatmentNotes: changes.treatmentNotes?.trim() || null }
          : {}),
        actualBillPaise,
        adjustmentPaise,
        adjustmentReason: adjustmentPaise !== 0 ? (reason?.trim() ?? null) : null,
        ...split,
        updatedAt: new Date().toISOString(),
      };
      await repos.visits.put(updated);
      return updated;
    },

    /**
     * Set (or clear) the internal therapist split on a visit. Unlike
     * updateBilling this is allowed on invoiced visits: it never touches the
     * billed amount or primary therapist, only the reporting-side attribution
     * the hospital doesn't reconcile against. Pass sharedTherapistId: null to
     * clear the split.
     */
    async setSplit(
      visitId: UUID,
      split: { sharedTherapistId: UUID | null; sharedPct?: number | null }
    ): Promise<Visit> {
      const visit = await repos.visits.get(visitId);
      if (!visit) throw new Error('Visit not found');

      let sharedTherapistId: UUID | null = null;
      let sharedPct: number | null = null;
      if (split.sharedTherapistId) {
        if (visit.actualBillPaise <= 0) {
          throw new Error('This visit has no billed amount to share.');
        }
        if (split.sharedTherapistId === visit.therapistId) {
          throw new Error('Pick a different therapist to share with.');
        }
        const pct = split.sharedPct ?? 0;
        if (!(pct > 0 && pct <= 100)) {
          throw new Error('Share must be between 0 and 100 percent.');
        }
        sharedTherapistId = split.sharedTherapistId;
        sharedPct = pct;
      }

      const updated: Visit = {
        ...visit,
        sharedTherapistId,
        sharedPct,
        updatedAt: new Date().toISOString(),
      };
      await repos.visits.put(updated);
      return updated;
    },
  };
}
