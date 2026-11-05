import { db } from '@/lib/db';
import { rowToDomain } from '@/repositories/rowMapping';
import type { ClinicPlan } from '@/domain/types';

export function planCacheKey(clinicId: string): string {
  return `plan:${clinicId}`;
}

export async function applyPlanChange(row: Record<string, unknown> | null | undefined): Promise<void> {
  if (!row || typeof row.clinic_id !== 'string') return;
  const plan = rowToDomain<ClinicPlan>(row);
  await db.meta.put({
    key: planCacheKey(row.clinic_id),
    value: JSON.stringify(plan),
  });
}

