import { useEffect, useState } from 'react';

/**
 * Landing on the Ledger from a therapist's own Dues tile: narrow the therapist
 * filter to them, once. Their role and therapist record both load after the
 * first render, so this waits for them instead of reading them in a useState
 * initializer (which only ever saw them empty). Never applies to clinic-wide
 * roles, whose Dues tile is the whole clinic.
 */
export function useDueLandingScope({
  dueLanding,
  isClinicWideView,
  myTherapistId,
  setTherapistId,
}: {
  dueLanding: boolean;
  isClinicWideView: boolean;
  myTherapistId: string | undefined;
  setTherapistId: (id: string) => void;
}) {
  const [applied, setApplied] = useState(false);
  useEffect(() => {
    if (!dueLanding || applied || isClinicWideView || !myTherapistId) return;
    setTherapistId(myTherapistId);
    setApplied(true);
  }, [dueLanding, applied, isClinicWideView, myTherapistId, setTherapistId]);
}
