import type { PatientAdvance, PaymentMethod, Payment, UUID, Visit } from '@/domain/types';
import type { Paise } from '@/domain/money';
import type { Repos } from '@/repositories/types';

/**
 * Slices `amountPaise` across `visits` in date order, each slice capped at
 * that visit's own outstanding bill (`actualBillPaise` minus what
 * `paidByVisit` already shows for it) — shared by
 * `paymentService.recordInvoicePayment` (invoice draw-down) and this
 * module's `applyAdvance` (advance draw-down) so both paths allocate
 * identically instead of maintaining two copies of the same loop.
 */
export async function allocateAcrossVisits(
  visits: Visit[],
  paidByVisit: Map<UUID, Paise>,
  amountPaise: Paise,
  makePayment: (visitId: UUID, slicePaise: Paise) => Promise<void>
): Promise<void> {
  let toAllocate = amountPaise;
  for (const v of visits) {
    if (toAllocate <= 0) break;
    const visitRemaining = v.actualBillPaise - (paidByVisit.get(v.id) ?? 0);
    if (visitRemaining <= 0) continue;
    const slice = Math.min(visitRemaining, toAllocate);
    await makePayment(v.id, slice);
    toAllocate -= slice;
  }
}

/**
 * Money received ahead of treatment. An advance is not a `Payment` row
 * until drawn down against real visits (`applyAdvance`) — until then it's
 * invisible to `computeVisitPaymentState` and everything derived from it,
 * by design.
 */
export function createAdvanceService(repos: Repos) {
  return {
    /** D4: no numbered receipt series yet — identified by date + short id,
     *  same as any other record. A gap-free counter can be added later
     *  with no data migration if it turns out to matter. */
    async recordAdvance(
      clinicId: UUID,
      patientId: UUID,
      amountPaise: Paise,
      method: PaymentMethod,
      receivedDate: string,
      notes: string | null = null
    ): Promise<PatientAdvance> {
      const advance: PatientAdvance = {
        id: crypto.randomUUID(),
        clinicId,
        patientId,
        amountPaise,
        method,
        receivedDate,
        receiptNo: null,
        notes,
        status: 'open',
        deleted: false,
        updatedAt: new Date().toISOString(),
      };
      await repos.patientAdvances.put(advance);
      return advance;
    },

    /** Remaining balance = amount_paise − sum(payments where advance_id = a.id). */
    async advanceBalance(clinicId: UUID, advance: PatientAdvance): Promise<Paise> {
      const payments = await repos.payments.list(clinicId);
      const drawnDown = payments
        .filter((p) => p.advanceId === advance.id)
        .reduce((sum, p) => sum + p.amountPaise, 0);
      return Math.max(0, advance.amountPaise - drawnDown);
    },

    /** Every open advance for a patient, with its live remaining balance. */
    async openAdvancesWithBalance(
      clinicId: UUID,
      patientId: UUID
    ): Promise<{ advance: PatientAdvance; remainingPaise: Paise }[]> {
      const advances = (await repos.patientAdvances.listByPatient(clinicId, patientId)).filter(
        (a) => a.status === 'open'
      );
      const payments = await repos.payments.list(clinicId);
      const drawnDownByAdvance = new Map<UUID, Paise>();
      for (const p of payments) {
        if (!p.advanceId) continue;
        drawnDownByAdvance.set(
          p.advanceId,
          (drawnDownByAdvance.get(p.advanceId) ?? 0) + p.amountPaise
        );
      }
      return advances
        .map((advance) => ({
          advance,
          remainingPaise: Math.max(
            0,
            advance.amountPaise - (drawnDownByAdvance.get(advance.id) ?? 0)
          ),
        }))
        .filter((a) => a.remainingPaise > 0);
    },

    /**
     * Draws down an advance against one or more visits, allocating via the
     * same `allocateAcrossVisits` logic `recordInvoicePayment` uses. Flips
     * the advance to `'exhausted'` once its balance reaches zero. Stamps
     * `advanceId` on each `Payment` row so `advanceBalance` can find them
     * again; `visitId` stays required on `Payment` exactly as for any other
     * payment, so `computeVisitPaymentState` needs no changes at all.
     */
    async applyAdvance(
      clinicId: UUID,
      advance: PatientAdvance,
      visits: Visit[],
      amountPaise: Paise,
      receivedDate: string
    ): Promise<void> {
      const remaining = await this.advanceBalance(clinicId, advance);
      if (amountPaise > remaining) {
        throw new Error("Amount exceeds this advance's remaining balance.");
      }

      const paidByVisit = new Map<UUID, Paise>();
      let visitsOutstandingPaise = 0;
      for (const v of visits) {
        const existing = await repos.payments.listByVisit(v.id);
        const paid = existing.reduce((sum, p) => sum + p.amountPaise, 0);
        paidByVisit.set(v.id, paid);
        visitsOutstandingPaise += Math.max(0, v.actualBillPaise - paid);
      }
      // Without this, allocateAcrossVisits silently stops once every visit's
      // own bill is covered, leaving any excess unrecorded while the advance
      // below is still marked drawn down by the full amountPaise — money
      // that would otherwise vanish from the ledger with no Payment row to
      // show where it went.
      if (amountPaise > visitsOutstandingPaise) {
        throw new Error('Amount exceeds what these visits actually owe.');
      }

      const ordered = [...visits].sort((a, b) => a.visitDate.localeCompare(b.visitDate));
      await allocateAcrossVisits(ordered, paidByVisit, amountPaise, async (visitId, slicePaise) => {
        const payment: Payment = {
          id: crypto.randomUUID(),
          clinicId,
          visitId,
          amountPaise: slicePaise,
          method: advance.method,
          receivedDate,
          notes: `Applied from advance received ${advance.receivedDate}`,
          advanceId: advance.id,
          updatedAt: new Date().toISOString(),
        };
        await repos.payments.put(payment);
      });

      if (remaining - amountPaise <= 0) {
        await repos.patientAdvances.put({
          ...advance,
          status: 'exhausted',
          updatedAt: new Date().toISOString(),
        });
      }
    },
  };
}
