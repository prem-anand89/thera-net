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

  return {
    /**
     * Issues an invoice for a visit — for package visits, every uninvoiced
     * session in the package group goes on it, so the receipt lists all
     * session dates even though usually only session 1 carried the charge.
     */
    async issueForVisit(visitId: UUID, paymentMode: PaymentMode): Promise<Invoice> {
      const supabase = getSupabase();
      if (!supabase) throw new Error('Supabase is not configured');
      if (!navigator.onLine) {
        throw new Error(
          'Invoice numbers are issued by the server to stay gap-free — reconnect and try again.'
        );
      }

      const visit = await repos.visits.get(visitId);
      if (!visit) throw new Error('Visit not found');
      if (visit.invoiceId) throw new Error('This visit is already invoiced');

      const [clinic, patient, catalogItem] = await Promise.all([
        repos.clinics.get(visit.clinicId),
        repos.patients.get(visit.patientId),
        repos.catalog.get(visit.serviceCatalogId),
      ]);
      if (!clinic || !patient || !catalogItem) throw new Error('Missing clinic/patient/service data');

      const visits = await collectVisits(visit);
      const totalPaise = visits.reduce((sum, v) => sum + v.actualBillPaise, 0);
      const billed = visits.find((v) => v.actualBillPaise > 0) ?? visit;

      const lineItems: InvoiceLineItem[] = [
        {
          serviceName: catalogItem.name,
          sessionCount: visit.packageTotal ?? catalogItem.sessionCount,
          sessionDates: visits.map((v) => v.visitDate).sort(),
          catalogPricePaise: billed.catalogPricePaise,
          adjustmentPaise: visits.reduce((sum, v) => sum + v.adjustmentPaise, 0),
          adjustmentReason: billed.adjustmentReason,
          totalPaise,
        },
      ];

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
        p_therapist_id: billed.therapistId,
        p_visit_ids: visits.map((v) => v.id),
      });
      if (error) throw new Error(`Could not issue invoice: ${error.message}`);

      const invoice = rowToDomain<Invoice>(data as Record<string, unknown>);
      await repos.invoices.putLocal(invoice);
      await repos.visits.markInvoiced(
        visits.map((v) => v.id),
        invoice.id
      );
      return invoice;
    },
  };
}
