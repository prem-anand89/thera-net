// The red dot on the patient's Home program tab: true while any live program of this patient has a pain report of 7 or
// more that nobody has looked at yet. Quietly false while offline or when it cannot be read.
import { useEffect, useState } from 'react';
import { useClinic } from '@/app/clinicContext';
import { addDaysISO } from '@/domain/hep';
import { hepService } from '@/services/hepService';
import { buildProgramRow } from './programRows';
import { clinicToday, useOnline } from './useHepData';

export function useHomeProgramDot(patientId: string, enabled: boolean): boolean {
  const clinic = useClinic();
  const online = useOnline();
  const [dot, setDot] = useState(false);
  useEffect(() => {
    if (!enabled || !online) { setDot(false); return; }
    let live = true;
    const today = clinicToday(clinic);
    const windowStart = addDaysISO(today, -14);
    hepService.listPatientPrograms(patientId, windowStart)
      .then((list) => { if (live) setDot(list.some((b) => b.program.status !== 'completed' && buildProgramRow(b, { today, windowStart }).signals.some((s) => s.key === 'pain'))); })
      .catch(() => { if (live) setDot(false); });
    return () => { live = false; };
  }, [patientId, enabled, online, clinic]);
  return dot;
}
