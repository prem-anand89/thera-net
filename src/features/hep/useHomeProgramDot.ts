// The red dot on the patient's Home program tab: true while any live program of this patient has a pain report of 7 or
// more that nobody has looked at yet. Quietly false while offline or when it cannot be read. Read again whenever the
// chart's "Mark reviewed" reports this patient's pain as reviewed (`notifyPainReviewed`).
import { useEffect, useState } from 'react';
import { useClinic } from '@/app/clinicContext';
import { addDaysISO } from '@/domain/hep';
import { hepService } from '@/services/hepService';
import { buildProgramRow } from './programRows';
import { clinicToday, useOnline } from './useHepData';

const PAIN_REVIEWED = 'hep:pain-reviewed';

/** Tells every dot for this patient to read again (called after "Mark reviewed" succeeds). */
export function notifyPainReviewed(patientId: string): void {
  window.dispatchEvent(new CustomEvent<string>(PAIN_REVIEWED, { detail: patientId }));
}

export function useHomeProgramDot(patientId: string, enabled: boolean): boolean {
  const clinic = useClinic();
  const online = useOnline();
  const [dot, setDot] = useState(false);
  const [version, setVersion] = useState(0);
  useEffect(() => {
    const onReviewed = (e: Event) => { if ((e as CustomEvent<string>).detail === patientId) setVersion((v) => v + 1); };
    window.addEventListener(PAIN_REVIEWED, onReviewed);
    return () => window.removeEventListener(PAIN_REVIEWED, onReviewed);
  }, [patientId]);
  useEffect(() => {
    if (!enabled || !online) { setDot(false); return; }
    let live = true;
    const today = clinicToday(clinic);
    const windowStart = addDaysISO(today, -14);
    hepService.listPatientPrograms(patientId, windowStart)
      .then((list) => { if (live) setDot(list.some((b) => b.program.status !== 'completed' && buildProgramRow(b, { today, windowStart }).signals.some((s) => s.key === 'pain'))); })
      .catch(() => { if (live) setDot(false); });
    return () => { live = false; };
  }, [patientId, enabled, online, clinic, version]);
  return dot;
}
