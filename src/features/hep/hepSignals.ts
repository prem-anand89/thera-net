// Lightweight clinic-wide HEP nav signal: true while at least one non-completed program in the clinic has an
// unreviewed pain 7+ report. Computed once per page load (plus when 'hep:pain-reviewed' fires) only for roles that
// can use HEP and only when online. Kept separate from HepPage/ProgramsTab so Shell stays slim.
import { useEffect, useState } from 'react';
import { hepService } from '@/services/hepService';
import { hasClinicPainAlert } from './programRows';
import { useOnline } from './useHepData';

const PAIN_REVIEWED_EVENT = 'hep:pain-reviewed';

export function useHepPainDot(clinicId: string | undefined, enabled: boolean): boolean {
  const online = useOnline();
  const [dot, setDot] = useState(false);
  const [version, setVersion] = useState(0);

  useEffect(() => {
    const onReviewed = () => setVersion((v) => v + 1);
    window.addEventListener(PAIN_REVIEWED_EVENT, onReviewed);
    return () => window.removeEventListener(PAIN_REVIEWED_EVENT, onReviewed);
  }, []);

  useEffect(() => {
    if (!enabled || !online || !clinicId) {
      setDot(false);
      return;
    }
    let live = true;
    Promise.resolve()
      .then(() => hepService.listPainAlerts(clinicId))
      .then((list) => {
        if (live) setDot(hasClinicPainAlert(list));
      })
      .catch(() => {
        if (live) setDot(false);
      });
    return () => {
      live = false;
    };
  }, [clinicId, enabled, online, version]);

  return dot;
}
