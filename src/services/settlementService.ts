import type { Settlement, SettlementPayment, UUID } from '@/domain/types';
import type { Paise } from '@/domain/money';
import type { Repos } from '@/repositories/types';

export interface SettlementInput {
  amountReceivedPaise: Paise;
  receivedDate: string | null;
  notes: string | null;
}

export function createSettlementService(repos: Repos) {
  return {
    /** @deprecated single-entry model — a partner hospital's real payouts
     *  are rarely one lump sum (advance + final tranche is typical). Kept
     *  only so existing callers/tests don't break; new code should use
     *  listPayments/addPayment/totalReceived below. */
    get(clinicId: UUID, year: number, month: number): Promise<Settlement | undefined> {
      return repos.settlements.getByPeriod(clinicId, year, month);
    },

    /** @deprecated see get() above. */
    async save(
      clinicId: UUID,
      year: number,
      month: number,
      input: SettlementInput
    ): Promise<Settlement> {
      const existing = await repos.settlements.getByPeriod(clinicId, year, month);
      const settlement: Settlement = {
        id: existing?.id ?? crypto.randomUUID(),
        clinicId,
        year,
        month,
        amountReceivedPaise: input.amountReceivedPaise,
        receivedDate: input.receivedDate,
        notes: input.notes,
        updatedAt: new Date().toISOString(),
      };
      await repos.settlements.put(settlement);
      return settlement;
    },

    /** Every payment tranche recorded for a period, oldest first. */
    async listPayments(
      clinicId: UUID,
      year: number,
      month: number
    ): Promise<SettlementPayment[]> {
      const rows = await repos.settlementPayments.listByPeriod(clinicId, year, month);
      return rows.sort((a, b) => (a.receivedDate ?? '').localeCompare(b.receivedDate ?? ''));
    },

    /** Sum of every payment tranche recorded for a period — the real
     *  "amount received" figure, now that it's not assumed to be one row. */
    async totalReceived(clinicId: UUID, year: number, month: number): Promise<Paise> {
      const rows = await repos.settlementPayments.listByPeriod(clinicId, year, month);
      return rows.reduce((sum, r) => sum + r.amountReceivedPaise, 0) as Paise;
    },

    /** Records a new tranche — always an insert, never an edit-in-place, so
     *  an advance and a later final payment both stay on record instead of
     *  one overwriting the other. Use editPayment to correct a mistake on
     *  an already-recorded tranche. */
    async addPayment(
      clinicId: UUID,
      year: number,
      month: number,
      input: SettlementInput
    ): Promise<SettlementPayment> {
      const payment: SettlementPayment = {
        id: crypto.randomUUID(),
        clinicId,
        year,
        month,
        amountReceivedPaise: input.amountReceivedPaise,
        receivedDate: input.receivedDate,
        notes: input.notes,
        updatedAt: new Date().toISOString(),
      };
      await repos.settlementPayments.put(payment);
      return payment;
    },

    /** Corrects a tranche already on record (wrong amount typed in, a date
     *  fixed after the fact) — same row id, not a new tranche. */
    async editPayment(
      payment: SettlementPayment,
      input: SettlementInput
    ): Promise<SettlementPayment> {
      const updated: SettlementPayment = {
        ...payment,
        amountReceivedPaise: input.amountReceivedPaise,
        receivedDate: input.receivedDate,
        notes: input.notes,
        updatedAt: new Date().toISOString(),
      };
      await repos.settlementPayments.put(updated);
      return updated;
    },

    deletePayment(id: UUID): Promise<void> {
      return repos.settlementPayments.delete(id);
    },
  };
}
