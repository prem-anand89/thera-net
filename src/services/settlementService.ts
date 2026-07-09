import type { Settlement, UUID } from '@/domain/types';
import type { Paise } from '@/domain/money';
import type { Repos } from '@/repositories/types';

export interface SettlementInput {
  amountReceivedPaise: Paise;
  receivedDate: string | null;
  notes: string | null;
}

export function createSettlementService(repos: Repos) {
  return {
    get(clinicId: UUID, year: number, month: number): Promise<Settlement | undefined> {
      return repos.settlements.getByPeriod(clinicId, year, month);
    },

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
  };
}
