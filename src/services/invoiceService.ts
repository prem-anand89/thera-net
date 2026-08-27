import type { Invoice, InvoiceClinicalSnapshot, PaymentMode, UUID, Visit } from '@/domain/types';
import { fiscalYearOf } from '@/domain/fiscalYear';
import {
  buildLineItems as buildLineItemsPure,
  groupVisitsForInvoicing,
} from '@/domain/invoiceLine';
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
   * Fetches and expands the requested visits into a flat list — every
   * uninvoiced sibling of a package visit gets pulled in too — but does no
   * grouping itself; that's `invoiceLine.ts`'s pure `groupVisitsForInvoicing`,
   * called separately by `buildLineItems` below. This half needs `repos`
   * (fetching by id and by package group), so it can't move into the pure
   * module; the grouping-key logic that follows it can and does.
   */
  async function resolveVisits(visitIds: UUID[], allowInvoiceId?: UUID): Promise<Visit[]> {
    const visits = await Promise.all(visitIds.map((id) => repos.visits.get(id)));
    const valid = visits.filter((v): v is Visit => v !== undefined);

    const allVisits: Visit[] = [];
    for (const visit of valid) {
      if (!isAvailable(visit, allowInvoiceId)) {
        throw new Error(`Visit ${visit.id} is already invoiced`);
      }
      allVisits.push(...(await collectVisits(visit, allowInvoiceId)));
    }
    // De-duplicated by invoiceLine.ts's groupVisitsForInvoicing, but this
    // flat list is also what's returned to the caller for markInvoiced/
    // p_visit_ids, so dedupe it here too rather than relying on the pure
    // function's side effect for a value used outside it.
    const seen = new Set<UUID>();
    return allVisits.filter((v) => (seen.has(v.id) ? false : (seen.add(v.id), true)));
  }

  /**
   * Shared by issueForVisits and amendInvoice: resolves visits, groups and
   * builds line items via invoiceLine.ts's pure functions, and totals them
   * — but doesn't call the server. The two callers differ only in which
   * RPC they call and whether previously-invoiced visits are allowed in.
   */
  async function buildLineItems(
    visitIds: UUID[],
    allowInvoiceId?: UUID
  ): Promise<{
    allVisits: Visit[];
    lineItems: ReturnType<typeof buildLineItemsPure>['lineItems'];
    totalPaise: number;
    therapistId: UUID;
  }> {
    const allVisits = await resolveVisits(visitIds, allowInvoiceId);
    const groups = groupVisitsForInvoicing(allVisits);

    const serviceIds = new Set(allVisits.map((v) => v.serviceCatalogId));
    const catalogItems = await Promise.all(
      Array.from(serviceIds).map((id) => repos.catalog.get(id))
    );
    const serviceNameById = new Map(
      catalogItems
        .filter((c): c is NonNullable<typeof c> => c !== undefined)
        .map((c) => [c.id, c.name])
    );

    const { lineItems, totalPaise, therapistId } = buildLineItemsPure(groups, serviceNameById);
    return { allVisits, lineItems, totalPaise, therapistId };
  }

  return {
    /**
     * Issues an invoice for a visit — for package visits, every uninvoiced
     * session in the package group goes on it, so the receipt lists all
     * session dates even though usually only session 1 carried the charge.
     */
    async issueForVisit(
      visitId: UUID,
      paymentMode: PaymentMode,
      clinicalSnapshot?: InvoiceClinicalSnapshot | null
    ): Promise<Invoice> {
      return this.issueForVisits([visitId], paymentMode, clinicalSnapshot);
    },

    /**
     * Issues a single invoice for multiple visits/packages. Groups visits by
     * service (packages by packageGroupId, everything else by service+price
     * — see invoiceLine.ts) into one line item per group, combining them
     * into a single invoice. All visits must belong to the same patient.
     *
     * `clinicalSnapshot` is optional and defaults to none — the direct
     * bulk-issue path from Patient Profile (`handleBulkIssueInvoice`)
     * deliberately doesn't collect one; only `IssueInvoiceDialog` does. See
     * the Billing & Notes Rebuild Phase 1 plan's 1.4 section for why that
     * gap is accepted rather than built out in this phase.
     */
    async issueForVisits(
      visitIds: UUID[],
      paymentMode: PaymentMode,
      clinicalSnapshot?: InvoiceClinicalSnapshot | null
    ): Promise<Invoice> {
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
        p_clinical_snapshot: clinicalSnapshot ?? null,
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
     *
     * `clinicalSnapshot` defaults to carrying the original invoice's own
     * snapshot forward unchanged — editing it during an amendment is a
     * deliberate future follow-up, not this phase (Phase 1 plan, 1.4).
     */
    async amendInvoice(
      originalInvoiceId: UUID,
      visitIds: UUID[],
      paymentMode: PaymentMode,
      clinicalSnapshot?: InvoiceClinicalSnapshot | null
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
        p_clinical_snapshot:
          clinicalSnapshot !== undefined ? clinicalSnapshot : (original.clinicalSnapshot ?? null),
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

    /**
     * Computes what issuing an invoice for these visits WOULD produce —
     * same line-item build `issueForVisits` itself calls, just without the
     * `issue_invoice` RPC — so `IssueInvoiceDialog`'s preview step is
     * guaranteed to match the real thing rather than an approximation of
     * it. Read-only: touches no visit/invoice state.
     */
    async previewLineItems(visitIds: UUID[]): Promise<{
      lineItems: ReturnType<typeof buildLineItemsPure>['lineItems'];
      totalPaise: number;
    }> {
      const { lineItems, totalPaise } = await buildLineItems(visitIds);
      return { lineItems, totalPaise };
    },

    /**
     * Edits an already-issued invoice's clinical-context snapshot in place
     * — the one thing on an invoice that isn't the financial record itself
     * (diagnosis/referring physician/place of service/treatment performed).
     * Everything else stays immutable; a correction to the amount or line
     * items still goes through amendInvoice above. See migration
     * 20260827000004 for the server-side enforcement of that split.
     */
    async updateClinicalDetails(
      invoiceId: UUID,
      clinicId: UUID,
      clinicalSnapshot: InvoiceClinicalSnapshot | null
    ): Promise<Invoice> {
      const supabase = getSupabase();
      if (!supabase) throw new Error('Supabase is not configured');
      if (!navigator.onLine) {
        throw new Error('Editing an invoice needs a connection — reconnect and try again.');
      }

      const { data, error } = await supabase.rpc('update_invoice_clinical_details', {
        p_invoice_id: invoiceId,
        p_clinic_id: clinicId,
        p_clinical_snapshot: clinicalSnapshot,
      });
      if (error) throw new Error(`Could not update invoice details: ${error.message}`);

      const invoice = rowToDomain<Invoice>(data as Record<string, unknown>);
      await repos.invoices.putLocal(invoice);
      return invoice;
    },
  };
}
