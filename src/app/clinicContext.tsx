import { createContext, useContext } from 'react';
import type { Clinic } from '@/domain/types';

export const ClinicContext = createContext<Clinic | null>(null);

export function useClinic(): Clinic {
  const clinic = useContext(ClinicContext);
  if (!clinic) throw new Error('useClinic must be used inside ClinicContext');
  return clinic;
}
