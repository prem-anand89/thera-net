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
  async function collectVisits(visit: Visit): Promise<Visit[]> {
    if (!visit.packageGroupId) return [visit];
    const group = await repos.visits.listByPackageGroup(visit.packageGroupId);
    return group.filter((v) => !v.invoiceId);
  }

  /**
   * Group visits by package/service for multi-line-item invoicing.
   * Each group becomes one line item on a combined invoice.
   */
  async function groupVisitsForInvoicing(visitIds: UUID[]): Promise<Map<string, Visit[]>> {
    const visits = await Promise.all(visitIds.map((id) => repos.visits.get(id)));
    const valid = visits.filter((v): v is Visit => v !== undefined);

    const groups = new Map<string, Visit[]>();
    for (const visit of valid) {
      if (visit.invoiceId) throw new Error(`Visit ${visit.id} is already invoiced`);

      // Collect full package group if this is a package visit
      let fullGroup: Visit[];
      if (visit.packageGroupId) {
        fullGroup = await collectVisits(visit);
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

      // Group visits by package
      const groups = await groupVisitsForInvoicing(visitIds);
      const allVisits: Visit[] = [];
      const lineItems: InvoiceLineItem[] = [];
      let totalPaise = 0;
      let therapistId: UUID = firstVisit.therapistId;

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
  };
}
