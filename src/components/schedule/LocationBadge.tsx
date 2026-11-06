import { useContext } from 'react';
import { ClinicContext } from '@/app/clinicContext';
import { locationOf, offersLocationChoice } from '@/domain/careLocations';

const HOUSE = (
  <>
    <path d="M3 11l9-8 9 8" />
    <path d="M5 10v10h14V10" />
  </>
);

function House({ size }: { size: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {HOUSE}
    </svg>
  );
}

/** True when this record is a home visit AND the clinic has more than one place on, the only time a location mark is shown. */
export function useShowsHome(record: { location?: string | null } | null | undefined): boolean {
  // A grid rendered outside a clinic (a test, a preview) simply shows no mark instead of throwing.
  const clinic = useContext(ClinicContext);
  return offersLocationChoice(clinic) && locationOf(record) === 'home';
}

/** "Home" pill for list rows and the appointment panel. Nothing for a clinic visit or a clinic that only sees patients in one place. */
export function HomeBadge({ record }: { record: { location?: string | null } }) {
  const show = useShowsHome(record);
  if (!show) return null;
  return (
    <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-[var(--teal-light)] px-1.5 text-[10px] font-medium leading-4 text-[var(--teal-strong)]">
      <House size={10} />
      Home
    </span>
  );
}

/** A tiny house for calendar blocks, where a pill would not fit. */
export function HomeGlyph({ record }: { record: { location?: string | null } }) {
  const show = useShowsHome(record);
  if (!show) return null;
  return (
    <span className="mr-0.5 inline-block align-[-1px]" role="img" aria-label="Home visit">
      <House size={11} />
    </span>
  );
}
