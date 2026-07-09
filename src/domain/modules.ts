import type { ClinicModuleSetting, MemberRole, ModuleType } from './types';

/**
 * Pure mirror of the server-side can_use_module() SQL function
 * (supabase/migrations/20260718000001_module_registry.sql). Both sides must
 * agree: this gates what the UI renders; the database function gates what
 * RLS actually allows. No configured row for a module means it is off by
 * default (fail closed) — a clinic must explicitly enable a module.
 */
export function canUseModule(
  settings: ClinicModuleSetting[] | undefined,
  moduleKey: ModuleType,
  role: MemberRole | null
): boolean {
  if (!role) return false;
  const setting = settings?.find((s) => s.moduleKey === moduleKey);
  if (!setting || !setting.enabled) return false;
  return setting.allowedRoles.includes(role);
}

export const MODULE_LABELS: Record<ModuleType, string> = {
  gut_screening: 'Gut Screening',
  return_to_sport: 'Return to Sport',
  scoliosis_screening: 'Scoliosis Screening',
  face_scale: 'FaCE Scale',
  facial_palsy: 'Facial Palsy (HB/Sunnybrook)',
};
