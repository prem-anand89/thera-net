import type {
  Invoice,
  InvoiceLineItem,
  PaymentMode,
  UUID,
  Visit,
} from '@/domain/types';
import { fiscalYearOf } from '@/domain/fiscalYear';
import type { Repos } from '@/repositories/types';
import { getSupabase } from '@/lib/supabase';
import { rowToDomain } from '@/repositories/rowMapping';

/**
 * Invoice issuance is ONLINE-ONLY by design: gap-free sequential numbers per
 * clinic per fiscal year come from a row-locked counter inside the
 * issue_invoice() Postgres function. Minting numbers offline would risk
 * duplicates — the one thing an invoice book must never have.
 */
export function createInvoiceService(repos: Repos) {
  const isAvailable = (v: Visit, allowInvoiceId?: UUID) =>
    !v.invoiceId || v.invoiceId === allowInvoiceId;

  async function collectVisits(visit: Visit, allowInvoiceId?: UUID): Promise<Visit[]> {
    if (!visit.packageGroupId) return [visit];
    const group = await repos.visits.listByPackageGroup(visit.packageGroupId);
    return group.filter((v) => isAvailable(v, allowInvoiceId));
  }

  /**
   * Group visits by package/service for multi-line-item invoicing.
   * Each group becomes one line item on a combined invoice. `allowInvoiceId`
   * lets an amendment re-include visits already on the invoice being
   * amended, in addition to previously-uninvoiced ones.
   */
  async function groupVisitsForInvoicing(
    visitIds: UUID[],
    allowInvoiceId?: UUID
  ): Promise<Map<string, Visit[]>> {
    const visits = await Promise.all(visitIds.map((id) => repos.visits.get(id)));
    const valid = visits.filter((v): v is Visit => v !== undefined);

    const groups = new Map<string, Visit[]>();
    for (const visit of valid) {
      if (!isAvailable(visit, allowInvoiceId)) {
        throw new Error(`Visit ${visit.id} is already invoiced`);
      }

      // Collect full package group if this is a package visit
      let fullGroup: Visit[];
      if (visit.packageGroupId) {
        fullGroup = await collectVisits(visit, allowInvoiceId);
      } else {
        fullGroup = [visit];
      }

      // Group key = packageGroupId (or visitId for standalone visits)
      const key = visit.packageGroupId || visit.id;
      const existing = groups.get(key) ?? [];
      const merged = [...existing, ...fullGroup].filter(
        (v, i, a) => a.findIndex((x) => x.id === v.id) === i
      );
      groups.set(key, merged);
    }
    return groups;
  }

  /**
   * Shared by issueForVisits and amendInvoice: groups visits into line
   * items and computes the total, but doesn't call the server — the two
   * callers differ only in which RPC they call and whether previously-
   * invoiced visits are allowed in the input set.
   */
  async function buildLineItems(
    visitIds: UUID[],
    allowInvoiceId?: UUID
  ): Promise<{
    allVisits: Visit[];
    lineItems: InvoiceLineItem[];
    totalPaise: number;
    therapistId: UUID;
  }> {
    const groups = await groupVisitsForInvoicing(visitIds, allowInvoiceId);
    const allVisits: Visit[] = [];
    const lineItems: InvoiceLineItem[] = [];
    let totalPaise = 0;
    let therapistId: UUID = visitIds[0];

    for (const groupVisits of groups.values()) {
      const groupBilled = groupVisits.find((v) => v.actualBillPaise > 0) ?? groupVisits[0];
      const catalogItem = await repos.catalog.get(groupBilled.serviceCatalogId);
      if (!catalogItem) throw new Error('Service not found');

      const groupTotal = groupVisits.reduce((sum, v) => sum + v.actualBillPaise, 0);
      allVisits.push(...groupVisits);
      totalPaise += groupTotal;
      therapistId = groupBilled.therapistId;

      lineItems.push({
        serviceName: catalogItem.name,
        sessionCount: groupBilled.packageTotal ?? catalogItem.sessionCount,
        sessionDates: groupVisits.map((v) => v.visitDate).sort(),
        catalogPricePaise: groupBilled.catalogPricePaise,
        adjustmentPaise: groupVisits.reduce((sum, v) => sum + v.adjustmentPaise, 0),
        adjustmentReason: groupBilled.adjustmentReason,
        totalPaise: groupTotal,
      });
    }
    return { allVisits, lineItems, totalPaise, therapistId };
  }

  return {
    /**
     * Issues an invoice for a visit — for package visits, every uninvoiced
     * session in the package group goes on it, so the receipt lists all
     * session dates even though usually only session 1 carried the charge.
     */
    async issueForVisit(visitId: UUID, paymentMode: PaymentMode): Promise<Invoice> {
      return this.issueForVisits([visitId], paymentMode);
    },

    /**
     * Issues a single invoice for multiple visits/packages. Groups visits by
     * package and creates one line item per group, combining them into a
     * single invoice. All visits must belong to the same patient.
     */
    async issueForVisits(visitIds: UUID[], paymentMode: PaymentMode): Promise<Invoice> {
      const supabase = getSupabase();
      if (!supabase) throw new Error('Supabase is not configured');
      if (!navigator.onLine) {
        throw new Error(
          'Invoice numbers are issued by the server to stay gap-free — reconnect and try again.'
        );
      }

      if (visitIds.length === 0) throw new Error('No visits selected');

      // Fetch first visit to get clinic/patient
      const firstVisit = await repos.visits.get(visitIds[0]);
      if (!firstVisit) throw new Error('Visit not found');

      const [clinic, patient] = await Promise.all([
        repos.clinics.get(firstVisit.clinicId),
        repos.patients.get(firstVisit.patientId),
      ]);
      if (!clinic || !patient) throw new Error('Missing clinic/patient data');

      const { allVisits, lineItems, totalPaise, therapistId } = await buildLineItems(visitIds);

      const fy = fiscalYearOf(new Date(), clinic.fyStartMonth);
      const { data, error } = await supabase.rpc('issue_invoice', {
        p_clinic_id: clinic.id,
        p_fy_label: fy.label,
        p_patient_snapshot: {
          mrno: patient.mrno,
          name: patient.name,
          age: patient.age,
          sex: patient.sex,
        },
        p_line_items: lineItems,
        p_total_paise: totalPaise,
        p_payment_mode: paymentMode,
        p_therapist_id: therapistId,
        p_visit_ids: allVisits.map((v) => v.id),
      });
      if (error) throw new Error(`Could not issue invoice: ${error.message}`);

      const invoice = rowToDomain<Invoice>(data as Record<string, unknown>);
      await repos.invoices.putLocal(invoice);
      await repos.visits.markInvoiced(
        allVisits.map((v) => v.id),
        invoice.id
      );
      return invoice;
    },

    /**
     * Amends an already-issued invoice — for a TPA/insurance correction
     * (e.g. added visit dates) — by issuing a NEW invoice that supersedes
     * it, rather than editing the original (invoices are immutable).
     * `visitIds` may include visits already on `originalInvoiceId` (they
     * get re-pointed to the new invoice) plus any newly-added, previously
     * uninvoiced visits. The original invoice row itself is never touched.
     */
    async amendInvoice(
      originalInvoiceId: UUID,
      visitIds: UUID[],
      paymentMode: PaymentMode
    ): Promise<Invoice> {
      const supabase = getSupabase();
      if (!supabase) throw new Error('Supabase is not configured');
      if (!navigator.onLine) {
        throw new Error(
          'Invoice numbers are issued by the server to stay gap-free — reconnect and try again.'
        );
      }

      if (visitIds.length === 0) throw new Error('No visits selected');

      const original = await repos.invoices.get(originalInvoiceId);
      if (!original) throw new Error('Original invoice not found');

      const [clinic, firstVisit] = await Promise.all([
        repos.clinics.get(original.clinicId),
        repos.visits.get(visitIds[0]),
      ]);
      if (!clinic || !firstVisit) throw new Error('Missing clinic/visit data');

      const { allVisits, lineItems, totalPaise, therapistId } = await buildLineItems(
        visitIds,
        originalInvoiceId
      );

      const { data, error } = await supabase.rpc('amend_invoice', {
        p_original_invoice_id: originalInvoiceId,
        p_clinic_id: clinic.id,
        p_fy_label: original.fyLabel,
        p_patient_snapshot: original.patientSnapshot,
        p_line_items: lineItems,
        p_total_paise: totalPaise,
        p_payment_mode: paymentMode,
        p_therapist_id: therapistId,
        p_visit_ids: allVisits.map((v) => v.id),
      });
      if (error) throw new Error(`Could not amend invoice: ${error.message}`);

      const invoice = rowToDomain<Invoice>(data as Record<string, unknown>);
      await repos.invoices.putLocal(invoice);
      await repos.visits.markInvoiced(
        allVisits.map((v) => v.id),
        invoice.id
      );
      return invoice;
    },
  };
}
